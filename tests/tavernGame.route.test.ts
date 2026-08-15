import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import Fastify, { type FastifyError } from 'fastify';

import { envelopeMeta } from '../src/context.ts';
import { AppError, errEnvelope } from '../src/envelope.ts';
import { ConcurrencyLimiter } from '../src/lib/concurrencyLimiter.ts';
import { registerTavernGameRoutes, type TavernGameRouteDeps } from '../src/routes/tavernGame.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

const TOKEN = 'tavern-game-test-token-123456';
const SIGNING_SECRET = 'tavern-game-signing-secret-1234567890';

const FAKE_STATE = {
  matchId: 'm1',
  playerOrder: ['one', 'two'],
  players: { one: { id: 'one', classId: 'GUARDIAN' }, two: { id: 'two', classId: 'EXILE' } },
};

async function createRouteApp(overrides: Partial<TavernGameRouteDeps> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-tavern-'));
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

  registerTavernGameRoutes(app, {
    tempStorage,
    apiKeys: [TOKEN],
    mediaSigningSecret: SIGNING_SECRET,
    mediaTtlSeconds: 60,
    limiter: new ConcurrencyLimiter(2),
    maxOutputBytes: 5_000_000,
    maxStateBytes: 200_000,
    renderBoard: async () => Buffer.from('png-board-falso'),
    renderHand: async () => Buffer.from('png-hand-falso'),
    renderScene: async () => Buffer.from('png-scene-falso'),
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

test('rotas da Tavern exigem Bearer', async () => {
  const handle = await createRouteApp();
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { state: FAKE_STATE, playerNames: {} },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await handle.close();
  }
});

test('board, mão e as quatro cenas devolvem descritor de mídia com dimensões corretas', async () => {
  const handle = await createRouteApp();
  const requests = [
    ['/v1/games/tavern/board', { state: FAKE_STATE, playerNames: { one: 'Um', two: 'Dois' } }, 1200, 940],
    ['/v1/games/tavern/hand', { state: FAKE_STATE, playerId: 'one' }, 1200, 820],
    ['/v1/games/tavern/scene', { kind: 'invite', payload: {} }, 1200, 675],
    ['/v1/games/tavern/scene', { kind: 'mulligan', payload: {} }, 1200, 675],
    ['/v1/games/tavern/scene', { kind: 'turn', payload: {} }, 1200, 675],
    ['/v1/games/tavern/scene', { kind: 'victory', payload: {} }, 1200, 675],
  ] as const;

  try {
    for (const [url, payload, width, height] of requests) {
      const response = await handle.app.inject({
        method: 'POST', url, payload,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.statusCode, 200, `${url} deveria responder 200`);
      const body = response.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.width, width);
      assert.equal(body.data.height, height);
      assert.match(body.data.media.mediaUrl, /^\/v1\/media\//);
      assert.equal(body.data.media.mime, 'image/png');
    }
  } finally {
    await handle.close();
  }
});

test('estado inválido ou ausente devolve 400 sem chamar o renderer', async () => {
  const handle = await createRouteApp({
    renderBoard: async () => { throw new Error('não deveria ser chamado'); },
  });
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { playerNames: {} },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await handle.close();
  }
});

test('estado maior que o limite configurado devolve 413 antes de renderizar', async () => {
  const handle = await createRouteApp({
    maxStateBytes: 50,
    renderBoard: async () => { throw new Error('não deveria ser chamado'); },
  });
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { state: { ...FAKE_STATE, filler: 'x'.repeat(500) }, playerNames: {} },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 413);
  } finally {
    await handle.close();
  }
});

test('cena com kind desconhecido é recusada pela validação', async () => {
  const handle = await createRouteApp();
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/scene',
      payload: { kind: 'nao-existe', payload: {} },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await handle.close();
  }
});

test('falha do renderer vira 500 estável, sem derrubar a rota', async () => {
  const handle = await createRouteApp({
    renderHand: async () => { throw new Error('jimp explodiu'); },
  });
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/hand',
      payload: { state: FAKE_STATE, playerId: 'one' },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'BUNNYFY_INTERNAL_ERROR');
  } finally {
    await handle.close();
  }
});

test('renderer real (Jimp + assets copiados de nazuna-gyomei) produz PNG válido de ponta a ponta', async () => {
  const handle = await createRouteApp({
    // sem overrides de render* aqui: usa VNextBoardRenderer/VNextHandRenderer/
    // VNextSceneRenderer de verdade, contra os assets reais em assets/tavern.
    renderBoard: undefined,
    renderHand: undefined,
    renderScene: undefined,
  });
  const state = {
    matchId: 'm1',
    status: 'ACTIVE',
    phase: 'MAIN',
    playerOrder: ['one', 'two'],
    turn: { number: 1, activePlayerId: 'one', deadlineAt: null },
    terrain: null,
    players: {
      one: {
        id: 'one', classId: 'GUARDIAN',
        hero: { hp: 30, maxHp: 30, armor: 0, powerUsed: false },
        mana: { current: 1, max: 1 }, nextSpellDiscount: 0,
        hand: [{ instanceId: 'i1', cardId: 'GY-001', name: 'Sentinela de Pedra', type: 'MINION', cost: 2, attack: 2, health: 3, rarity: 'COMMON', keywords: ['GUARD'], text: 'Guarda.', classId: 'GUARDIAN' }],
        board: [], deck: [],
      },
      two: {
        id: 'two', classId: 'EXILE',
        hero: { hp: 30, maxHp: 30, armor: 0, powerUsed: false },
        mana: { current: 0, max: 0 }, nextSpellDiscount: 0,
        hand: [], board: [], deck: [],
      },
    },
  };
  try {
    const boardResponse = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { state, playerNames: { one: 'Um', two: 'Dois' } },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(boardResponse.statusCode, 200);

    const handResponse = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/hand',
      payload: { state, playerId: 'one' },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(handResponse.statusCode, 200);

    const mediaId = handResponse.json().data.media.mediaId as string;
    const entry = await handle.tempStorage.get(mediaId);
    assert.ok(entry);
    const fs = await import('node:fs/promises');
    const bytes = await fs.readFile(entry.filePath);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.ok(bytes.length > 10_000, 'PNG real deveria ter um tamanho plausível');
  } finally {
    await handle.close();
  }
});

test('concorrência esgotada devolve 429 sem travar a fila', async () => {
  let releaseFirst: () => void = () => {};
  const blocking = new Promise<void>(resolve => { releaseFirst = resolve; });
  const handle = await createRouteApp({
    limiter: new ConcurrencyLimiter(1),
    renderBoard: async () => {
      await blocking;
      return Buffer.from('png-board-falso');
    },
  });
  try {
    const first = handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { state: FAKE_STATE, playerNames: {} },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await new Promise(resolve => setTimeout(resolve, 20));

    const second = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { state: FAKE_STATE, playerNames: {} },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(second.statusCode, 429);

    releaseFirst();
    const firstResponse = await first;
    assert.equal(firstResponse.statusCode, 200);
  } finally {
    await handle.close();
  }
});
