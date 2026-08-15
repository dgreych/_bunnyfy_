import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import { downloadYoutubeMediaViaEgress, type YoutubeEgressDeps } from '../src/lib/youtubeEgress.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';
import type { DnsLookup } from '../src/security/ssrf.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const WORKER_TOKEN = 'worker-token-de-teste-0123456789abcdef';
const VIDEO_ID = 'jNQXAC9IVRw';
const PUBLIC_DNS: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

async function withDeps(
  fetchImpl: typeof fetch,
  run: (deps: YoutubeEgressDeps, dir: string) => Promise<void>,
  overrides: Partial<YoutubeEgressDeps> = {},
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-egress-test-'));
  const tempStorage = new TempStorage({
    dir,
    ttlMs: 60_000,
    maxBytes: 1_024,
    sweepIntervalMs: 3_600_000,
  });
  await tempStorage.init();
  const deps: YoutubeEgressDeps = {
    tempStorage,
    mediaDir: dir,
    ytDlpPath: 'unused',
    ffmpegPath: 'unused',
    denoPath: 'unused',
    timeoutMs: 1_000,
    maxBytes: 1_024,
    workerUrl: 'https://egress.example.test',
    workerToken: WORKER_TOKEN,
    fetchImpl,
    ...overrides,
  };
  try {
    await run(deps, dir);
  } finally {
    await tempStorage.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function audioResponse(payload: Uint8Array, overrides: Record<string, string> = {}): Response {
  return new Response(payload, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': String(payload.byteLength),
      'x-bunnyfy-duration-seconds': '19.032',
      'x-bunnyfy-title': Buffer.from('Primeiro vídeo', 'utf8').toString('base64url'),
      ...overrides,
    },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('body de teste ausente');
  return JSON.parse(init.body);
}

test('egress envia somente ID canônico e registra o áudio validado', async () => {
  const payload = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  let requestBody: unknown;
  const fakeFetch: typeof fetch = async (input, init) => {
    assert.equal(requestUrl(input), 'https://egress.example.test/v1/youtube/audio');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${WORKER_TOKEN}`);
    requestBody = jsonRequestBody(init);
    return audioResponse(payload);
  };

  await withDeps(fakeFetch, async (deps) => {
    const result = await downloadYoutubeMediaViaEgress(
      'audio',
      { type: 'url', value: `https://www.youtube.com/watch?v=${VIDEO_ID}` },
      'best',
      deps,
    );
    assert.deepEqual(requestBody, { inputType: 'url', value: VIDEO_ID });
    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.sizeBytes, payload.byteLength);
    assert.equal(result.durationSeconds, 19.032);
    assert.equal(result.title, 'Primeiro vídeo');
    const stored = await deps.tempStorage.get(result.mediaId);
    assert.ok(stored);
    assert.deepEqual(await readFile(stored.filePath), Buffer.from(payload));
  });
});

test('egress preserva consulta como texto e nunca envia URL arbitrária', async () => {
  let requestBody: unknown;
  const fakeFetch: typeof fetch = async (_input, init) => {
    requestBody = jsonRequestBody(init);
    return audioResponse(Uint8Array.from([1, 2, 3]));
  };
  await withDeps(fakeFetch, async (deps) => {
    await downloadYoutubeMediaViaEgress('audio', { type: 'query', value: 'música de teste' }, undefined, deps);
    assert.deepEqual(requestBody, { inputType: 'query', value: 'música de teste' });
  });
});

test('egress rejeita status, MIME e tamanho declarados inválidos sem deixar arquivo', async () => {
  const cases: Array<() => Response> = [
    () => new Response('{"ok":false}', { status: 503, headers: { 'content-type': 'application/json' } }),
    () => audioResponse(Uint8Array.from([1]), { 'content-type': 'text/html' }),
    () => audioResponse(Uint8Array.from([1]), { 'content-length': '2048' }),
  ];
  for (const responseFactory of cases) {
    await withDeps(async () => responseFactory(), async (deps, dir) => {
      await assert.rejects(
        downloadYoutubeMediaViaEgress('audio', { type: 'query', value: 'teste' }, undefined, deps),
        (error: unknown) => error instanceof AppError && error.statusCode === 503,
      );
      assert.deepEqual(await readdir(dir), []);
    });
  }
});

test('egress rejeita corpo truncado e remove o parcial', async () => {
  const fakeFetch: typeof fetch = async () => audioResponse(
    Uint8Array.from([1, 2, 3]),
    { 'content-length': '4' },
  );
  await withDeps(fakeFetch, async (deps, dir) => {
    await assert.rejects(
      downloadYoutubeMediaViaEgress('audio', { type: 'query', value: 'teste' }, undefined, deps),
      (error: unknown) => error instanceof AppError && error.statusCode === 503,
    );
    assert.deepEqual(await readdir(dir), []);
  });
});

test('timeout cobre também o streaming do corpo e remove o parcial', async () => {
  const fakeFetch: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
        signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'content-length': '2',
        'x-bunnyfy-duration-seconds': '1',
      },
    });
  };
  await withDeps(fakeFetch, async (deps, dir) => {
    await assert.rejects(
      downloadYoutubeMediaViaEgress('audio', { type: 'query', value: 'teste' }, undefined, deps),
      (error: unknown) => error instanceof AppError && error.statusCode === 504,
    );
    assert.deepEqual(await readdir(dir), []);
  }, { timeoutMs: 20 });
});

test('egress recusa vídeo e qualidade fora do contrato atual antes de acessar a rede', async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    throw new Error('não deveria chamar');
  };
  await withDeps(fakeFetch, async (deps) => {
    await assert.rejects(
      downloadYoutubeMediaViaEgress('video', { type: 'query', value: 'teste' }, '360p', deps),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TOOL_UNAVAILABLE',
    );
    assert.equal(called, false);
  });
});

test('app ativada despacha áudio ao egress e devolve mídia interna assinada', async () => {
  const payload = Uint8Array.from([0x49, 0x44, 0x33, 0x04]);
  const { app, close } = await createTestApp({
    envOverrides: {
      YOUTUBE_EGRESS_ENABLED: 'true',
      YOUTUBE_EGRESS_URL: 'https://egress.example.test',
      YOUTUBE_EGRESS_SHARED_SECRET: WORKER_TOKEN,
    },
    dnsLookup: PUBLIC_DNS,
    youtubeEgressFetch: async () => audioResponse(payload),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: `https://youtu.be/${VIDEO_ID}` },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.data.media.mime, 'audio/mpeg');
    assert.equal(body.data.media.bytes, payload.byteLength);
    assert.equal(body.data.media.mediaUrl.includes('egress.example.test'), false);

    const mediaUrl = new URL(body.data.media.mediaUrl, 'http://localhost');
    const mediaResponse = await app.inject({ method: 'GET', url: `${mediaUrl.pathname}${mediaUrl.search}` });
    assert.equal(mediaResponse.statusCode, 200);
    assert.deepEqual(mediaResponse.rawPayload, Buffer.from(payload));
  } finally {
    await close();
  }
});
