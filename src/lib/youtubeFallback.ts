import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../envelope.ts';
import {
  readBodyWithLimit,
  safeFetch,
  SafeFetchTimeoutError,
  SsrfBlockedError,
  type DnsLookup,
} from '../security/ssrf.ts';
import { generateOpaqueId } from '../storage/tempStorage.ts';
import type {
  YoutubeDownloadDeps,
  YoutubeDownloadInput,
  YoutubeDownloadResult,
  YoutubeKind,
  YoutubeQuality,
} from './youtube.ts';

const FALLBACK_ENDPOINTS: Record<YoutubeKind, string> = {
  audio: '/api/downloads/youtubemp3',
  video: '/api/downloads/youtubemp4',
};

const FALLBACK_MEDIA: Record<YoutubeKind, { extension: string; mimeType: string; originalName: string }> = {
  audio: { extension: 'mp3', mimeType: 'audio/mpeg', originalName: 'youtube-audio.mp3' },
  video: { extension: 'mp4', mimeType: 'video/mp4', originalName: 'youtube-video.mp4' },
};

const FALLBACK_CODES = new Set([
  'BUNNYFY_TOOL_UNAVAILABLE',
  'BUNNYFY_UNAVAILABLE',
  'BUNNYFY_TIMEOUT',
]);

export interface YoutubeFallbackDeps extends YoutubeDownloadDeps {
  fallbackBaseUrl: string;
  fallbackApiKey: string;
  fallbackMediaHosts: string[];
  fallbackMaxControlBytes: number;
  dnsLookup?: DnsLookup;
  fetchImpl?: typeof fetch;
}

function sanitizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  if (title.length === 0 || title.length > 500) return null;
  if ([...title].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || codePoint === 127;
  })) return null;
  return title;
}

function parseControlResponse(value: unknown): { downloadUrl: string; title: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw AppError.unavailable('O download do YouTube está temporariamente indisponível.');
  }
  const envelope = value as Record<string, unknown>;
  const candidate = envelope.resposta ?? envelope.resultado ?? envelope;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw AppError.unavailable('O download do YouTube está temporariamente indisponível.');
  }
  const data = candidate as Record<string, unknown>;
  const downloadUrl = typeof data.dlurl === 'string'
    ? data.dlurl.trim()
    : typeof data.url === 'string'
      ? data.url.trim()
      : '';
  if (!downloadUrl || downloadUrl.length > 8_192) {
    throw AppError.unavailable('O download do YouTube está temporariamente indisponível.');
  }
  return { downloadUrl, title: sanitizeTitle(data.title ?? data.titulo) };
}

function responseMime(response: Response): string {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function hasExpectedSignature(kind: YoutubeKind, bytes: Buffer): boolean {
  if (kind === 'video') return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  if (bytes.length < 2) return false;
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

async function downloadBoundedMedia(
  kind: YoutubeKind,
  rawUrl: string,
  outputPath: string,
  deps: YoutubeFallbackDeps,
): Promise<void> {
  const mediaSpec = FALLBACK_MEDIA[kind];
  const response = await safeFetch(rawUrl, {
    method: 'GET',
    headers: { accept: mediaSpec.mimeType, 'user-agent': 'BunnyFy/1.0' },
    timeoutMs: deps.timeoutMs,
    maxRedirects: 5,
    allowedProtocols: ['https:'],
    allowedHosts: deps.fallbackMediaHosts,
    dnsLookup: deps.dnsLookup,
    fetchImpl: deps.fetchImpl,
  });

  if (!response.ok || !response.body || responseMime(response) !== mediaSpec.mimeType) {
    await response.body?.cancel('youtube-fallback-media').catch(() => undefined);
    throw AppError.unavailable('O download do YouTube está temporariamente indisponível.');
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && (contentLength <= 0 || contentLength > deps.maxBytes)) {
    await response.body.cancel('youtube-fallback-length').catch(() => undefined);
    throw AppError.payloadTooLarge('A mídia solicitada excede o limite permitido.');
  }

  const body = response.body as ReadableStream<Uint8Array>;
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const handle = await fs.open(outputPath, 'wx', 0o600);
  let total = 0;
  const prefixChunks: Buffer[] = [];
  let prefixBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value) continue;
      total += chunk.value.byteLength;
      if (total > deps.maxBytes) {
        await reader.cancel('youtube-fallback-too-large').catch(() => undefined);
        throw AppError.payloadTooLarge('A mídia solicitada excede o limite permitido.');
      }
      if (prefixBytes < 16) {
        const prefix = Buffer.from(chunk.value).subarray(0, 16 - prefixBytes);
        prefixChunks.push(prefix);
        prefixBytes += prefix.length;
      }
      await handle.writeFile(chunk.value);
    }
  } finally {
    await handle.close().catch(() => undefined);
    reader.releaseLock();
  }

  if (total <= 0 || (Number.isFinite(contentLength) && total !== contentLength)) {
    throw AppError.unavailable('O download do YouTube foi entregue de forma incompleta.');
  }
  if (!hasExpectedSignature(kind, Buffer.concat(prefixChunks, prefixBytes))) {
    throw AppError.unavailable('O download do YouTube retornou um formato inesperado.');
  }
}

export async function downloadYoutubeMediaViaFallback(
  kind: YoutubeKind,
  input: YoutubeDownloadInput,
  quality: YoutubeQuality | undefined,
  deps: YoutubeFallbackDeps,
): Promise<YoutubeDownloadResult> {
  if (input.type !== 'url') {
    throw AppError.toolUnavailable('A busca textual do YouTube está temporariamente indisponível.');
  }
  if (kind === 'audio' && quality !== undefined && quality !== 'best') {
    throw AppError.badRequest('Qualidade de áudio inválida.');
  }

  const controlUrl = new URL(FALLBACK_ENDPOINTS[kind], deps.fallbackBaseUrl);
  controlUrl.searchParams.set('apikey', deps.fallbackApiKey);
  controlUrl.searchParams.set('query', input.value);

  const mediaSpec = FALLBACK_MEDIA[kind];
  const id = generateOpaqueId();
  const outputPath = path.join(deps.mediaDir, `${id}.${mediaSpec.extension}`);
  let registered = false;
  try {
    const controlResponse = await safeFetch(controlUrl.toString(), {
      method: 'GET',
      headers: { accept: '*/*', 'user-agent': 'BunnyFy/1.0' },
      timeoutMs: deps.timeoutMs,
      maxRedirects: 0,
      allowedProtocols: ['https:'],
      allowedHosts: [new URL(deps.fallbackBaseUrl).hostname],
      dnsLookup: deps.dnsLookup,
      fetchImpl: deps.fetchImpl,
    });
    if (!controlResponse.ok) {
      await controlResponse.body?.cancel('youtube-fallback-control').catch(() => undefined);
      throw AppError.unavailable('O download do YouTube está temporariamente indisponível.');
    }
    const controlBytes = await readBodyWithLimit(controlResponse, deps.fallbackMaxControlBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(controlBytes.toString('utf8')) as unknown;
    } catch {
      throw AppError.unavailable('O download do YouTube retornou uma resposta inválida.');
    }
    const control = parseControlResponse(payload);
    await downloadBoundedMedia(kind, control.downloadUrl, outputPath, deps);

    const entry = await deps.tempStorage.registerExisting(id, outputPath, {
      mimeType: mediaSpec.mimeType,
      originalName: mediaSpec.originalName,
      maxBytes: deps.maxBytes,
    });
    registered = true;
    return {
      mediaId: entry.id,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
      title: control.title,
      durationSeconds: 0,
      thumbnailUrl: null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof SafeFetchTimeoutError) {
      throw AppError.upstreamTimeout('O download do YouTube excedeu o tempo limite.');
    }
    if (error instanceof SsrfBlockedError) {
      throw AppError.unavailable('O download do YouTube retornou um destino inválido.');
    }
    const rawCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const failureCode = /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : null;
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'O download do YouTube está temporariamente indisponível.',
      retryable: true,
      internalDetails: {
        source: 'youtube-fallback',
        failureType: error instanceof Error ? error.name : typeof error,
        failureCode,
      },
    });
  } finally {
    if (!registered) await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

export async function downloadYoutubeMediaWithFallback(
  primary: (
    kind: YoutubeKind,
    input: YoutubeDownloadInput,
    quality: YoutubeQuality | undefined,
    deps: YoutubeDownloadDeps,
  ) => Promise<YoutubeDownloadResult>,
  kind: YoutubeKind,
  input: YoutubeDownloadInput,
  quality: YoutubeQuality | undefined,
  deps: YoutubeFallbackDeps,
): Promise<YoutubeDownloadResult> {
  try {
    return await primary(kind, input, quality, deps);
  } catch (error) {
    if (!(error instanceof AppError) || !FALLBACK_CODES.has(error.code)) throw error;
    return downloadYoutubeMediaViaFallback(kind, input, quality, deps);
  }
}
