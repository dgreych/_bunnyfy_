import fs from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import { transcribeAudio, type TranscriptionDeps, type TranscriptionResult } from '../lib/transcription.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import {
  safeFetch,
  SafeFetchTimeoutError,
  SsrfBlockedError,
  type DnsLookup,
} from '../security/ssrf.ts';
import { generateOpaqueId, type TempStorage } from '../storage/tempStorage.ts';
import { OPAQUE_ID_PATTERN } from './media.ts';

export interface TranscriptionRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaDir: string;
  limiter: ConcurrencyLimiter;
  downloadTimeoutMs: number;
  transcriptionMaxInputBytes: number;
  whisperCliPath: string;
  whisperModelPath: string;
  whisperThreads?: number;
  ffmpegPath: string;
  transcriptionTimeoutMs: number;
  /** Injetável em teste, pra validar SSRF sem bater em DNS real. */
  dnsLookup?: DnsLookup;
  /** Injetável em teste, pra buscar a URL sem rede real. */
  fetchImpl?: typeof fetch;
  /** Injetável em teste, pra não chamar whisper-cli/ffmpeg reais. */
  transcribe?: (
    inputPath: string,
    opts: { language?: string },
    deps: TranscriptionDeps,
  ) => Promise<TranscriptionResult>;
}

const languageSchema = z.union([z.literal('auto'), z.string().regex(/^[a-z]{2}$/, 'idioma inválido')]);

const requestBodySchema = z
  .object({
    mediaId: z.string().optional(),
    url: z.string().optional(),
    language: languageSchema.optional(),
  })
  .refine((data) => Boolean(data.mediaId) !== Boolean(data.url), {
    message: 'Informe exatamente um entre "mediaId" e "url".',
  });

type StreamReadResult = {
  done: boolean;
  value?: Uint8Array;
};

/**
 * Grava uma resposta HTTP direto em arquivo com teto durante o stream. Assim a
 * entrada remota nunca precisa existir inteira em RAM antes do ffmpeg.
 */
async function writeResponseToScratchFile(
  response: Response,
  scratchPath: string,
  maxBytes: number,
): Promise<void> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel('content-length-exceeded').catch(() => undefined);
    throw AppError.payloadTooLarge('Áudio obtido pela URL excede o limite permitido.');
  }

  const handle = await fs.open(scratchPath, 'wx', 0o600);
  let total = 0;

  try {
    if (!response.body) return;

    const reader = response.body.getReader();
    try {
      for (;;) {
        const result = (await reader.read()) as StreamReadResult;
        if (result.done) break;
        const chunk = result.value;
        if (!chunk) continue;

        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel('max-bytes-exceeded').catch(() => undefined);
          throw AppError.payloadTooLarge('Áudio obtido pela URL excede o limite permitido.');
        }

        await handle.write(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(scratchPath, { force: true }).catch(() => undefined);
    throw error;
  }

  await handle.close();
}

/**
 * Busca a URL com a política central de SSRF e grava em rascunho opaco. O
 * download é streamado com limite de bytes e nunca reaproveita nome/caminho do
 * cliente.
 */
async function fetchUrlToScratchFile(
  rawUrl: string,
  deps: Pick<
    TranscriptionRouteDeps,
    'mediaDir' | 'downloadTimeoutMs' | 'transcriptionMaxInputBytes' | 'dnsLookup' | 'fetchImpl'
  >,
): Promise<string> {
  let response: Response;
  try {
    response = await safeFetch(rawUrl, {
      timeoutMs: deps.downloadTimeoutMs,
      dnsLookup: deps.dnsLookup,
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw AppError.blockedUrl(error.message);
    }
    if (error instanceof SafeFetchTimeoutError) {
      throw AppError.upstreamTimeout('Download do áudio excedeu o tempo limite.');
    }
    throw error;
  }

  if (!response.ok) {
    await response.body?.cancel('upstream-status').catch(() => undefined);
    throw AppError.badRequest(`Não foi possível obter a URL informada (status ${response.status}).`);
  }

  const scratchPath = path.join(deps.mediaDir, `${generateOpaqueId()}-src`);
  await writeResponseToScratchFile(response, scratchPath, deps.transcriptionMaxInputBytes);
  return scratchPath;
}

export function registerTranscriptionRoutes(app: FastifyInstance, deps: TranscriptionRouteDeps): void {
  app.post('/v1/audio/transcriptions', { preHandler: requireBearerAuth(deps.apiKeys, 'audio:write') }, async (request) => {
    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Limite de transcrições simultâneas atingido, tente novamente em instantes.');
    }

    // Só é apagado no fim se a entrada veio de URL — mídia vinda de
    // `mediaId` pertence ao TempStorage e tem seu próprio ciclo de vida.
    let scratchInputPath: string | undefined;

    try {
      const parsedBody = requestBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        throw AppError.badRequest(
          'Informe exatamente um entre "mediaId" e "url", com "language" válido (ex.: "pt", "en" ou "auto").',
          parsedBody.error.issues,
        );
      }

      const { mediaId, url, language } = parsedBody.data;

      let inputPath: string;
      if (mediaId) {
        if (!OPAQUE_ID_PATTERN.test(mediaId)) {
          throw AppError.badRequest('mediaId inválido.');
        }
        const entry = await deps.tempStorage.get(mediaId);
        if (!entry) {
          throw AppError.notFound('Mídia não encontrada ou expirada.');
        }
        inputPath = entry.filePath;
      } else {
        inputPath = await fetchUrlToScratchFile(url!, deps);
        scratchInputPath = inputPath;
      }

      const transcribe = deps.transcribe ?? transcribeAudio;
      const result = await transcribe(
        inputPath,
        { language },
        {
          whisperCliPath: deps.whisperCliPath,
          whisperModelPath: deps.whisperModelPath,
          threads: deps.whisperThreads,
          ffmpegPath: deps.ffmpegPath,
          timeoutMs: deps.transcriptionTimeoutMs,
        },
      );

      return okEnvelope(
        { text: result.text, language: result.language, durationSeconds: result.durationSeconds },
        envelopeMeta(request),
      );
    } finally {
      deps.limiter.release();
      if (scratchInputPath) {
        await fs.rm(scratchInputPath, { force: true }).catch(() => undefined);
      }
    }
  });
}
