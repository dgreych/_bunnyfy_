import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import Fastify, { type FastifyError } from 'fastify';

import { envelopeMeta } from '../src/context.ts';
import { AppError, errEnvelope } from '../src/envelope.ts';
import { ConcurrencyLimiter } from '../src/lib/concurrencyLimiter.ts';
import { registerImageGenerateRoutes, type ImageGenerateRouteDeps } from '../src/routes/imageGenerate.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

const TOKEN = 'image-gen-test-token-123456';
const SIGNING_SECRET = 'image-gen-signing-secret-1234567890';

async function createRouteApp(overrides: Partial<ImageGenerateRouteDeps> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-image-gen-'));
  const tempStorage = new TempStorage({ dir, ttlMs: 60_000, maxBytes: 2_000_000, sweepIntervalMs: 3_600_000 });
  await tempStorage.init();
  const app = Fastify({ logger: false });
  app.decorateRequest('startTimeNs');
  app.addHook('onRequest', (request, _reply, done) => {
    request.startTimeNs = process.hrtime.bigint();
    done();
  });
  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    const appError = error instanceof AppError ? error : AppError.internal();
    reply.code(appError.statusCode);
    return errEnvelope(appError.toPayload(), envelopeMeta(request));
  });

  registerImageGenerateRoutes(app, {
    tempStorage,
    apiKeys: [TOKEN],
    mediaSigningSecret: SIGNING_SECRET,
    mediaTtlSeconds: 60,
    limiter: new ConcurrencyLimiter(2),
    maxOutputBytes: 5_000_000,
    imageGenTimeoutMs: 5_000,
    generateImage: async () => Buffer.from('png-imagem-falsa'),
    ...overrides,
  });

  return {
    app,
    tempStorage,
    close: async () => {
      await app.close();
      await tempStorage.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('exige autenticação por bearer token', async () => {
  const { app, close } = await createRouteApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/generate',
      payload: { prompt: 'um dragão vermelho' },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await close();
  }
});

test('gera imagem com sucesso, usando dimensões padrão quando não informadas', async () => {
  let receivedArgs: unknown[] = [];
  const { app, close } = await createRouteApp({
    generateImage: async (...args) => {
      receivedArgs = args;
      return Buffer.from('png-imagem-falsa');
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/generate',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'um dragão vermelho' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.ok(body.data.media.mediaUrl);
    assert.equal(body.data.width, 768);
    assert.equal(body.data.height, 768);
    assert.deepEqual(receivedArgs, ['um dragão vermelho', 768, 768]);
  } finally {
    await close();
  }
});

test('aceita dimensões customizadas dentro do limite', async () => {
  const { app, close } = await createRouteApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/generate',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'um dragão vermelho', width: 512, height: 1024 },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.data.width, 512);
    assert.equal(body.data.height, 1024);
  } finally {
    await close();
  }
});

test('prompt vazio responde 400', async () => {
  const { app, close } = await createRouteApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/generate',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: '' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await close();
  }
});

test('dimensão fora do limite responde 400', async () => {
  const { app, close } = await createRouteApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/generate',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'um dragão vermelho', width: 5000 },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await close();
  }
});

test('falha do gerador upstream vira 503/504 sem vazar detalhe interno', async () => {
  const { app, close } = await createRouteApp({
    generateImage: async () => {
      throw AppError.upstreamTimeout('Tempo esgotado aguardando a geração de imagem.');
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/generate',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'um dragão vermelho' },
    });
    assert.equal(response.statusCode, 504);
    const body = response.json();
    assert.equal(body.error.code, 'BUNNYFY_TIMEOUT');
  } finally {
    await close();
  }
});
