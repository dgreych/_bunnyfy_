import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import Fastify, { type FastifyError } from 'fastify';

import { envelopeMeta } from '../src/context.ts';
import { AppError, errEnvelope } from '../src/envelope.ts';
import { ConcurrencyLimiter } from '../src/lib/concurrencyLimiter.ts';
import { buildCardArtPrompt, registerTavernArtRoutes, type TavernArtRouteDeps } from '../src/routes/tavernArt.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

const TOKEN = 'tavern-art-test-token-123456';
const SIGNING_SECRET = 'tavern-art-signing-secret-1234567890';

async function createRouteApp(overrides: Partial<TavernArtRouteDeps> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-tavern-art-'));
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

  registerTavernArtRoutes(app, {
    tempStorage,
    apiKeys: [TOKEN],
    mediaSigningSecret: SIGNING_SECRET,
    mediaTtlSeconds: 60,
    limiter: new ConcurrencyLimiter(2),
    maxOutputBytes: 5_000_000,
    imageGenTimeoutMs: 5_000,
    generateImage: async () => Buffer.from('png-arte-falsa'),
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

test('monta o prompt combinando nome da carta, estilo da classe e sufixo de estilo fixo', () => {
  const prompt = buildCardArtPrompt({ cardName: 'Sentinela de Pedra', classId: 'GUARDIAN' });
  assert.match(prompt, /Sentinela de Pedra/);
  assert.match(prompt, /blued steel/);
  assert.match(prompt, /no text, no watermark/);
});

test('classe desconhecida cai no estilo genérico de taverna, sem quebrar', () => {
  const prompt = buildCardArtPrompt({ cardName: 'Algo Raro', classId: 'INEXISTENTE' });
  assert.match(prompt, /dark fantasy tavern relic/);
});

test('exige autenticação por bearer token', async () => {
  const { app, close } = await createRouteApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/games/tavern/art',
      payload: { cardName: 'Sentinela de Pedra', classId: 'GUARDIAN' },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await close();
  }
});

test('gera arte com sucesso e devolve descritor de mídia assinado', async () => {
  const { app, close } = await createRouteApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/games/tavern/art',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cardName: 'Sentinela de Pedra', classId: 'GUARDIAN', flavor: 'stone golem guardian' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.ok(body.data.media.mediaUrl);
    assert.equal(body.data.media.mime, 'image/png');
  } finally {
    await close();
  }
});

test('corpo inválido (sem cardName) responde 400', async () => {
  const { app, close } = await createRouteApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/games/tavern/art',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { classId: 'GUARDIAN' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await close();
  }
});

test('falha do gerador upstream vira 503 sem vazar detalhe interno', async () => {
  const { app, close } = await createRouteApp({
    generateImage: async () => {
      throw AppError.upstreamTimeout('Tempo esgotado aguardando a geração de imagem.');
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/games/tavern/art',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cardName: 'Sentinela de Pedra', classId: 'GUARDIAN' },
    });
    assert.equal(response.statusCode, 504);
    const body = response.json();
    assert.equal(body.error.code, 'BUNNYFY_TIMEOUT');
  } finally {
    await close();
  }
});

test('concorrência esgotada responde 429', async () => {
  let releaseFirst: () => void = () => {};
  const blocking = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const { app, close } = await createRouteApp({
    limiter: new ConcurrencyLimiter(1),
    generateImage: async () => {
      await blocking;
      return Buffer.from('png-arte-falsa');
    },
  });
  try {
    const first = app.inject({
      method: 'POST',
      url: '/v1/games/tavern/art',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cardName: 'Sentinela de Pedra', classId: 'GUARDIAN' },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await app.inject({
      method: 'POST',
      url: '/v1/games/tavern/art',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cardName: 'Outra Carta', classId: 'EXILE' },
    });
    assert.equal(second.statusCode, 429);
    releaseFirst();
    const firstResponse = await first;
    assert.equal(firstResponse.statusCode, 200);
  } finally {
    await close();
  }
});
