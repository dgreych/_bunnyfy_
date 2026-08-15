import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';

import Fastify, { type FastifyError } from 'fastify';
import sharp from 'sharp';

import { envelopeMeta } from '../src/context.ts';
import { AppError, errEnvelope } from '../src/envelope.ts';
import { WELCOME_CARD_HEIGHT, WELCOME_CARD_WIDTH } from '../src/canvas/renderWelcomeCardV2.ts';
import { ConcurrencyLimiter } from '../src/lib/concurrencyLimiter.ts';
import { registerSocialCanvasRoutes, type SocialCanvasRouteDeps } from '../src/routes/socialCanvas.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

const TOKEN = 'social-canvas-test-token-123456';
const SIGNING_SECRET = 'social-canvas-signing-secret-1234567890';

async function createRouteApp(overrides: Partial<SocialCanvasRouteDeps> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-social-'));
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

  registerSocialCanvasRoutes(app, {
    tempStorage,
    apiKeys: [TOKEN],
    mediaSigningSecret: SIGNING_SECRET,
    mediaTtlSeconds: 60,
    limiter: new ConcurrencyLimiter(2),
    maxAvatarBytes: 500_000,
    maxTotalAvatarBytes: 1_000_000,
    maxOutputBytes: 1_000_000,
    render: async () => Buffer.from('png-falso-controlado'),
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

test('rotas Social Canvas exigem Bearer', async () => {
  const handle = await createRouteApp();
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/images/welcome-card',
      payload: { event: 'join', name: 'Membro', groupName: 'Grupo', memberCount: 2 },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await handle.close();
  }
});

test('cada modelo registra saída PNG com dimensões corretas por template', async () => {
  const handle = await createRouteApp();
  const requests = [
    ['/v1/images/welcome-card', { event: 'join', name: 'Membro', groupName: 'Grupo', memberCount: 2 }, WELCOME_CARD_WIDTH, WELCOME_CARD_HEIGHT],
    ['/v1/images/profile-card', { name: 'Membro', level: 2, xp: 50, nextLevelXp: 100 }, 1200, 675],
    ['/v1/images/compatibility-card', { left: { name: 'A' }, right: { name: 'B' }, score: 75, label: 'Boa dupla' }, 1200, 675],
    ['/v1/images/ranking-card', { title: 'Ranking', entries: [{ name: 'A', value: 10 }] }, 1200, 675],
    ['/v1/images/achievement-card', { name: 'A', title: 'Conquista', description: 'Descrição', progress: 50, rarity: 'rare', unlocked: false }, 1200, 675],
  ] as const;

  try {
    for (const [url, payload, width, height] of requests) {
      const response = await handle.app.inject({
        method: 'POST', url, payload,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.width, width);
      assert.equal(body.data.height, height);
      assert.equal(body.data.media.mime, 'image/png');
      assert.match(body.data.media.mediaUrl, /^\/v1\/media\//);
    }
  } finally {
    await handle.close();
  }
});

test('resolve avatar e fundo existentes e entrega somente os bytes ao renderer', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-avatar-source-'));
  const sourceStorage = new TempStorage({ dir, ttlMs: 60_000, maxBytes: 2_000_000, sweepIntervalMs: 3_600_000 });
  await sourceStorage.init();
  const avatar = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#3366ff' } }).png().toBuffer();
  const entry = await sourceStorage.put(Readable.from(avatar), { mimeType: 'image/png' });
  const background = await sharp({ create: { width: 120, height: 150, channels: 3, background: '#110022' } }).png().toBuffer();
  const backgroundEntry = await sourceStorage.put(Readable.from(background), { mimeType: 'image/png' });
  let receivedMedia = false;
  const handle = await createRouteApp({
    tempStorage: sourceStorage,
    render: async (_kind, _input, avatars) => {
      receivedMedia = avatars?.has(entry.id) === true && avatars?.has(backgroundEntry.id) === true;
      return Buffer.from('saida');
    },
  });
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/images/welcome-card',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        event: 'join', name: 'Membro', groupName: 'Grupo', memberCount: 2,
        avatarMediaId: entry.id, backgroundMediaId: backgroundEntry.id,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(receivedMedia, true);
    assert.equal(response.json().data.width, WELCOME_CARD_WIDTH);
    assert.equal(response.json().data.height, WELCOME_CARD_HEIGHT);
  } finally {
    await handle.close();
    await sourceStorage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('avatar ausente, inválido e corpo fora do contrato são recusados', async () => {
  const handle = await createRouteApp();
  try {
    const missing = await handle.app.inject({
      method: 'POST', url: '/v1/images/profile-card',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { name: 'Membro', level: 2, xp: 50, nextLevelXp: 100, avatarMediaId: 'avatar_inexistente_123' },
    });
    assert.equal(missing.statusCode, 404);

    const invalidEntry = await handle.tempStorage.put(Readable.from(Buffer.from('não é imagem')), { mimeType: 'image/png' });
    const invalidAvatar = await handle.app.inject({
      method: 'POST', url: '/v1/images/profile-card',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { name: 'Membro', level: 2, xp: 50, nextLevelXp: 100, avatarMediaId: invalidEntry.id },
    });
    assert.equal(invalidAvatar.statusCode, 400);

    const invalidBody = await handle.app.inject({
      method: 'POST', url: '/v1/images/ranking-card',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { title: 'Ranking', entries: [] },
    });
    assert.equal(invalidBody.statusCode, 400);
  } finally {
    await handle.close();
  }
});

test('saída acima do limite é rejeitada antes de entrar no storage', async () => {
  const handle = await createRouteApp({ maxOutputBytes: 4, render: async () => Buffer.alloc(5) });
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/images/welcome-card',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { event: 'join', name: 'Membro', groupName: 'Grupo', memberCount: 2 },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, 'BUNNYFY_TOO_LARGE');
  } finally {
    await handle.close();
  }
});

test('soma de avatares acima do orçamento agregado é recusada', async () => {
  const handle = await createRouteApp({ maxAvatarBytes: 500_000, maxTotalAvatarBytes: 1 });
  try {
    const avatar = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#000000' } }).png().toBuffer();
    const left = await handle.tempStorage.put(Readable.from(avatar), { mimeType: 'image/png' });
    const right = await handle.tempStorage.put(Readable.from(avatar), { mimeType: 'image/png' });
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/images/compatibility-card',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        left: { name: 'A', avatarMediaId: left.id },
        right: { name: 'B', avatarMediaId: right.id },
        score: 50,
        label: 'Teste',
      },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, 'BUNNYFY_TOO_LARGE');
  } finally {
    await handle.close();
  }
});

test('renderização concorrente acima do limite recebe 429 e libera slot ao terminar', async () => {
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const limiter = new ConcurrencyLimiter(1);
  let calls = 0;
  const handle = await createRouteApp({
    limiter,
    render: async () => {
      calls += 1;
      if (calls === 1) await gate;
      return Buffer.from('saida');
    },
  });

  try {
    const payload = { event: 'join', name: 'Membro', groupName: 'Grupo', memberCount: 2 };
    const first = handle.app.inject({
      method: 'POST', url: '/v1/images/welcome-card',
      headers: { authorization: `Bearer ${TOKEN}` }, payload,
    });
    await sleep(25);
    const second = await handle.app.inject({
      method: 'POST', url: '/v1/images/welcome-card',
      headers: { authorization: `Bearer ${TOKEN}` }, payload,
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'BUNNYFY_RATE_LIMITED');
    releaseFirst?.();
    const firstResponse = await first;
    assert.equal(firstResponse.statusCode, 200);
    assert.equal(limiter.activeCount, 0);
  } finally {
    releaseFirst?.();
    await handle.close();
  }
});
