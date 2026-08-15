import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../envelope.ts';
import { generateOpaqueId } from '../storage/tempStorage.ts';
import {
  YOUTUBE_MAX_DURATION_SECONDS,
  type YoutubeDownloadDeps,
  type YoutubeDownloadInput,
  type YoutubeDownloadResult,
  type YoutubeKind,
  type YoutubeQuality,
} from './youtube.ts';

export interface YoutubeEgressDeps extends YoutubeDownloadDeps {
  workerUrl: string;
  workerToken: string;
  fetchImpl?: typeof fetch;
}

function hasControlChars(value: string): boolean {
  return [...value].some((char) => {
    const code = char.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
}

function decodeTitle(value: string | null): string | null {
  if (!value) return null;
  if (value.length > 1_000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const title = Buffer.from(value, 'base64url').toString('utf8').trim();
    if (title.length === 0 || title.length > 500 || hasControlChars(title)) return null;
    return title;
  } catch {
    return null;
  }
}

function workerInput(input: YoutubeDownloadInput): { inputType: 'url' | 'query'; value: string } {
  if (input.type === 'query') return { inputType: 'query', value: input.value };
  const url = new URL(input.value);
  const videoId = url.searchParams.get('v');
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw AppError.badRequest('URL do YouTube inválida.');
  }
  return { inputType: 'url', value: videoId };
}

export async function downloadYoutubeMediaViaEgress(
  kind: YoutubeKind,
  input: YoutubeDownloadInput,
  quality: YoutubeQuality | undefined,
  deps: YoutubeEgressDeps,
): Promise<YoutubeDownloadResult> {
  if (kind !== 'audio' || (quality !== undefined && quality !== 'best')) {
    throw AppError.toolUnavailable('O worker de egress ainda aceita somente áudio em qualidade best.');
  }

  const endpoint = new URL('/v1/youtube/audio', deps.workerUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let outputPath: string | undefined;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let registered = false;
  try {
    response = await (deps.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.workerToken}`,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify(workerInput(input)),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel('youtube-egress-status').catch(() => undefined);
      throw AppError.unavailable('O worker de download não entregou a mídia.');
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    const contentLength = Number(response.headers.get('content-length'));
    const durationSeconds = Number(response.headers.get('x-bunnyfy-duration-seconds'));
    if (
      contentType !== 'audio/mpeg'
      || !Number.isSafeInteger(contentLength)
      || contentLength <= 0
      || contentLength > deps.maxBytes
      || !Number.isFinite(durationSeconds)
      || durationSeconds <= 0
      || durationSeconds > YOUTUBE_MAX_DURATION_SECONDS
    ) {
      await response.body.cancel('youtube-egress-headers').catch(() => undefined);
      throw AppError.unavailable('O worker de download retornou metadados inválidos.');
    }

    const id = generateOpaqueId();
    outputPath = path.join(deps.mediaDir, `${id}.mp3`);
    reader = response.body.getReader();
    handle = await fs.open(outputPath, 'wx', 0o600);
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value) continue;
      bytes += chunk.value.byteLength;
      if (bytes > deps.maxBytes || bytes > contentLength) {
        await reader.cancel('youtube-egress-too-large').catch(() => undefined);
        throw AppError.payloadTooLarge('Mídia do worker excedeu o limite permitido.');
      }
      await handle.writeFile(chunk.value);
    }
    await handle.close();
    handle = undefined;
    if (bytes !== contentLength) {
      throw AppError.unavailable('O worker de download entregou uma mídia incompleta.');
    }
    const entry = await deps.tempStorage.registerExisting(id, outputPath, {
      mimeType: 'audio/mpeg',
      originalName: 'youtube-audio.mp3',
      maxBytes: deps.maxBytes,
    });
    registered = true;
    return {
      mediaId: entry.id,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
      title: decodeTitle(response.headers.get('x-bunnyfy-title')),
      durationSeconds,
      thumbnailUrl: null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) {
      throw AppError.upstreamTimeout('O worker de download excedeu o tempo limite.');
    }
    throw AppError.unavailable('O worker de download está temporariamente indisponível.');
  } finally {
    clearTimeout(timeout);
    await reader?.cancel('youtube-egress-finalize').catch(() => undefined);
    reader?.releaseLock();
    await handle?.close().catch(() => undefined);
    if (!registered && outputPath) await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}
