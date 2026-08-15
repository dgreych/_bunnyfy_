import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '../src/envelope.ts';
import {
  downloadYoutubeMediaViaFallback,
  downloadYoutubeMediaWithFallback,
  type YoutubeFallbackDeps,
} from '../src/lib/youtubeFallback.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const API_KEY = 'private-fallback-key-0123456789';
const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

async function withDeps(
  run: (deps: YoutubeFallbackDeps, dir: string) => Promise<void>,
  fetchImpl: typeof fetch,
  maxBytes = 1024 * 1024,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-fallback-'));
  const tempStorage = new TempStorage({ dir, ttlMs: 60_000, maxBytes, sweepIntervalMs: 3_600_000 });
  await tempStorage.init();
  try {
    await run({
      tempStorage,
      mediaDir: dir,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      denoPath: 'deno',
      timeoutMs: 5_000,
      maxBytes,
      fallbackBaseUrl: 'https://fallback.example.test',
      fallbackApiKey: API_KEY,
      fallbackMediaHosts: ['fallback.example.test'],
      fallbackMaxControlBytes: 16 * 1024,
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl,
    }, dir);
  } finally {
    await tempStorage.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('fallback baixa áudio por URL, limita destinos e registra mídia opaca', async () => {
  const media = Buffer.from('ID3conteudo-de-audio');
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = requestUrl(input);
    requests.push(url);
    if (url.pathname === '/api/downloads/youtubemp3') {
      return new Response(JSON.stringify({ resposta: {
        dlurl: 'https://fallback.example.test/media/audio.mp3',
        title: 'Faixa de teste',
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(media, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(media.length) },
    });
  };

  await withDeps(async (deps) => {
    const result = await downloadYoutubeMediaViaFallback(
      'audio',
      { type: 'url', value: VIDEO_URL },
      'best',
      deps,
    );
    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.sizeBytes, media.length);
    assert.equal(result.title, 'Faixa de teste');
    assert.equal(result.durationSeconds, 0);
    assert.match(result.mediaId, /^[A-Za-z0-9_-]{24}$/);
    assert.equal((await deps.tempStorage.get(result.mediaId))?.sizeBytes, media.length);
  }, fetchImpl);

  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.searchParams.get('apikey'), API_KEY);
  assert.equal(requests[0]!.searchParams.get('query'), VIDEO_URL);
  assert.equal(requests[1]!.toString(), 'https://fallback.example.test/media/audio.mp3');
});

test('fallback suporta vídeo MP4 e só é acionado em falha transitória da implementação principal', async () => {
  const media = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    fallbackCalls += 1;
    const url = requestUrl(input);
    if (url.pathname === '/api/downloads/youtubemp4') {
      return new Response(JSON.stringify({ resultado: {
        url: 'https://fallback.example.test/media/video.mp4',
        titulo: 'Vídeo de teste',
      } }), { status: 200 });
    }
    return new Response(media, {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': String(media.length) },
    });
  };

  await withDeps(async (deps) => {
    const result = await downloadYoutubeMediaWithFallback(
      async () => {
        primaryCalls += 1;
        throw AppError.unavailable('falha transitória');
      },
      'video',
      { type: 'url', value: VIDEO_URL },
      '360p',
      deps,
    );
    assert.equal(result.mimeType, 'video/mp4');
    assert.equal(result.title, 'Vídeo de teste');
  }, fetchImpl);

  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 2);
});

test('fallback não mascara erro de política, recusa busca textual e limpa parcial inválido', async () => {
  let calls = 0;
  const invalidMedia = Buffer.from('nao-e-mp3');
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    const url = requestUrl(input);
    if (url.pathname.startsWith('/api/downloads/')) {
      return new Response(JSON.stringify({ resposta: {
        dlurl: 'https://fallback.example.test/media/invalido.mp3',
      } }), { status: 200 });
    }
    return new Response(invalidMedia, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(invalidMedia.length) },
    });
  };

  await withDeps(async (deps, dir) => {
    await assert.rejects(
      () => downloadYoutubeMediaWithFallback(
        async () => { throw AppError.badRequest('entrada inválida'); },
        'audio',
        { type: 'url', value: VIDEO_URL },
        undefined,
        deps,
      ),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_BAD_REQUEST',
    );
    assert.equal(calls, 0);

    await assert.rejects(
      () => downloadYoutubeMediaViaFallback('audio', { type: 'query', value: 'teste' }, undefined, deps),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TOOL_UNAVAILABLE',
    );
    assert.equal(calls, 0);

    await assert.rejects(
      () => downloadYoutubeMediaViaFallback('audio', { type: 'url', value: VIDEO_URL }, undefined, deps),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(JSON.stringify(error).includes(API_KEY), false);
        return error.code === 'BUNNYFY_UNAVAILABLE';
      },
    );
    assert.deepEqual(await readdir(dir), []);
  }, fetchImpl);
});

test('fallback bloqueia URL de mídia fora da allowlist antes do segundo request', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ resposta: {
      dlurl: 'https://nao-permitido.example/media/audio.mp3',
    } }), { status: 200 });
  };

  await withDeps(async (deps) => {
    await assert.rejects(
      () => downloadYoutubeMediaViaFallback('audio', { type: 'url', value: VIDEO_URL }, undefined, deps),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_UNAVAILABLE',
    );
  }, fetchImpl);
  assert.equal(calls, 1);
});

test('aplicação usa fallback após ferramenta local indisponível e entrega URL assinada', async () => {
  const media = Buffer.from('ID3audio-integracao');
  const fetchImpl: typeof fetch = async (input) => {
    const url = requestUrl(input);
    if (url.pathname === '/api/downloads/youtubemp3') {
      return new Response(JSON.stringify({ resposta: {
        dlurl: 'https://fallback.example.test/media/audio.mp3',
        title: 'Integração',
      } }), { status: 200 });
    }
    return new Response(media, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(media.length) },
    });
  };
  const handle = await createTestApp({
    envOverrides: {
      YOUTUBE_FALLBACK_ENABLED: 'true',
      YOUTUBE_FALLBACK_BASE_URL: 'https://fallback.example.test',
      YOUTUBE_FALLBACK_API_KEY: API_KEY,
      YTDLP_PATH: '/inexistente/yt-dlp',
      FFMPEG_PATH: '/inexistente/ffmpeg',
      DENO_PATH: '/inexistente/deno',
    },
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    youtubeFallbackFetch: fetchImpl,
  });
  try {
    const response = await handle.app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: VIDEO_URL },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.data.title, 'Integração');
    assert.equal(body.data.media.mime, 'audio/mpeg');
    assert.equal(body.data.media.bytes, media.length);
    assert.equal(response.body.includes(API_KEY), false);

    const downloaded = await handle.app.inject({ method: 'GET', url: body.data.media.mediaUrl });
    assert.equal(downloaded.statusCode, 200);
    assert.deepEqual(downloaded.rawPayload, media);
  } finally {
    await handle.close();
  }
});
