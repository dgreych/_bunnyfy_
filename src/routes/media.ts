import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import { sniffImageFile } from '../lib/imageSniff.ts';
import { requireBearerAuth, requireBearerOrSignedAccess, type ApiKeyAuthSource } from '../plugins/auth.ts';
import { signMediaAccess } from '../security/mediaSigning.ts';
import type { StoredEntry, TempStorage } from '../storage/tempStorage.ts';

export interface MediaRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  publicBaseUrl: string;
  mediaTtlSeconds: number;
}

export const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
const mediaIdParamSchema = z.object({ id: z.string().regex(OPAQUE_ID_PATTERN, 'id de mídia inválido') });

/** Código de link curto: 128 bits em base64url, ~22 caracteres. Faixa generosa evita rejeitar por engano. */
const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;
const shortCodeParamSchema = z.object({ code: z.string().regex(SHORT_CODE_PATTERN, 'código inválido') });

/**
 * Monta a URL assinada de leitura, válida por `ttlSeconds` a partir de
 * agora. Caminho relativo (`/v1/media/...`), como no exemplo de
 * `docs/GYOMEI_COMPATIBILITY.md` — quem consome resolve contra o `baseUrl`
 * que já conhece, em vez de depender do `PUBLIC_BASE_URL` configurado aqui
 * (que pode não bater com o host efetivamente usado atrás de proxy/rede
 * interna do container).
 */
export function buildSignedMediaUrl(
  deps: Pick<MediaRouteDeps, 'mediaSigningSecret'>,
  id: string,
  ttlSeconds: number,
): { url: string; expiresAt: string } {
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = signMediaAccess(id, expiresAtEpochSeconds, deps.mediaSigningSecret);
  const url = `/v1/media/${id}?exp=${expiresAtEpochSeconds}&sig=${signature}`;
  return { url, expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString() };
}

export interface MediaDescriptor {
  mediaId: string;
  mediaUrl: string;
  expiresAt: string;
  mime: string;
  bytes: number;
}

/**
 * Monta o descritor de mídia no formato publicado em
 * `docs/GYOMEI_COMPATIBILITY.md` — usado tanto pela resposta de
 * `POST /v1/media` quanto embutido nas respostas dos verticais de download.
 */
export function buildMediaDescriptor(
  deps: Pick<MediaRouteDeps, 'mediaSigningSecret'>,
  entry: Pick<StoredEntry, 'id' | 'mimeType' | 'sizeBytes'>,
  ttlSeconds: number,
): MediaDescriptor {
  const signed = buildSignedMediaUrl(deps, entry.id, ttlSeconds);
  return { mediaId: entry.id, mediaUrl: signed.url, expiresAt: signed.expiresAt, mime: entry.mimeType, bytes: entry.sizeBytes };
}

/**
 * Lê exatamente um arquivo multipart e grava no storage temporário,
 * limpando o parcial se o limite de tamanho estourar no meio do stream.
 * Usa `request.files()` (não `request.file()`) porque só o iterador plural
 * deixa checar, depois de drenar a primeira parte, se veio uma segunda —
 * `request.file()` sozinho devolve a primeira parte e nunca nota a segunda.
 */
async function uploadSingleFile(deps: Pick<MediaRouteDeps, 'tempStorage'>, request: FastifyRequest): Promise<StoredEntry> {
  const iterator = request.files();
  const first = await iterator.next();
  if (first.done || !first.value) {
    throw AppError.badRequest('Envie um arquivo no campo multipart "file".');
  }
  const file = first.value;

  let entry: StoredEntry;
  try {
    entry = await deps.tempStorage.put(file.file, {
      mimeType: file.mimetype || 'application/octet-stream',
      originalName: file.filename,
    });
  } catch (error) {
    // @fastify/multipart sinaliza limite de tamanho truncando o stream;
    // nosso limite próprio no storage também pode disparar primeiro.
    if (file.file.truncated) {
      throw AppError.payloadTooLarge();
    }
    throw error;
  }

  if (file.file.truncated) {
    await deps.tempStorage.delete(entry.id);
    throw AppError.payloadTooLarge();
  }

  const second = await iterator.next();
  if (!second.done) {
    await deps.tempStorage.delete(entry.id);
    second.value.file.resume();
    throw AppError.badRequest('Envie exatamente um arquivo por requisição.');
  }

  return entry;
}

export function registerMediaRoutes(app: FastifyInstance, deps: MediaRouteDeps): void {
  app.post('/v1/media', { preHandler: requireBearerAuth(deps.apiKeys, 'media:write') }, async (request) => {
    const entry = await uploadSingleFile(deps, request);
    const descriptor = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
    return okEnvelope(descriptor, envelopeMeta(request));
  });

  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>(
    '/v1/media/:id',
    { preHandler: requireBearerOrSignedAccess(deps.apiKeys, deps.mediaSigningSecret, 'media:read') },
    async (request, reply) => {
      const parsedParams = mediaIdParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        throw AppError.badRequest('id de mídia inválido.');
      }

      const entry = await deps.tempStorage.get(parsedParams.data.id);
      if (!entry) {
        throw AppError.notFound('Mídia não encontrada ou expirada.');
      }

      reply.header('content-type', entry.mimeType);
      reply.header('content-length', entry.sizeBytes);
      reply.header('cache-control', 'private, max-age=0, no-store');
      return reply.send(createReadStream(entry.filePath));
    },
  );

  app.post('/v1/media/images', { preHandler: requireBearerAuth(deps.apiKeys, 'media:write') }, async (request) => {
    const entry = await uploadSingleFile(deps, request);

    // O MIME e a extensão declarados pelo cliente nunca decidem o formato —
    // só a assinatura real dos bytes. Formato não suportado é removido, não
    // só rejeitado.
    const sniffed = await sniffImageFile(entry.filePath);
    if (!sniffed) {
      await deps.tempStorage.delete(entry.id);
      throw AppError.badRequest('Arquivo não é uma imagem suportada (JPEG, PNG, GIF ou WebP).');
    }
    deps.tempStorage.setMimeType(entry.id, sniffed.mime);

    const shortCode = deps.tempStorage.registerShortLink(entry.id);
    if (!shortCode) {
      throw AppError.internal('Falha ao gerar link curto para a mídia enviada.');
    }

    const descriptor = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
    const shortPath = `/m/${shortCode}`;

    return okEnvelope(
      { ...descriptor, kind: sniffed.format, shortPath, shortUrl: `${deps.publicBaseUrl}${shortPath}` },
      envelopeMeta(request),
    );
  });

  // Sem preHandler de auth: o link curto em si já é a credencial de acesso
  // — só existe pra entradas explicitamente marcadas por `registerShortLink`.
  app.get<{ Params: { code: string } }>('/m/:code', async (request, reply) => {
    const parsedParams = shortCodeParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      throw AppError.badRequest('Código inválido.');
    }

    const entry = await deps.tempStorage.getByShortCode(parsedParams.data.code);
    if (!entry) {
      throw AppError.notFound('Conteúdo não encontrado ou expirado.');
    }

    reply.header('content-type', entry.mimeType);
    reply.header('content-length', entry.sizeBytes);
    reply.header('cache-control', 'no-store');
    return reply.send(createReadStream(entry.filePath));
  });
}
