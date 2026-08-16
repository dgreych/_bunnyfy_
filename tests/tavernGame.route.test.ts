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

const BOARD_CARD = {
  cardId: 'GY-001', name: 'Sentinela de Pedra', rarity: 'COMMON',
  attack: 2, health: 3, keywords: ['GUARD'], canAttack: true, attacksThisTurn: 0,
};

const HAND_CARD = {
  cardId: 'GY-001', name: 'Sentinela de Pedra', type: 'MINION', rarity: 'COMMON',
  cost: 2, attack: 2, health: 3, keywords: ['GUARD'], text: 'Guarda.',
};

const BOARD_VIEW = {
  schemaVersion: 1,
  kind: 'board',
  status: 'ACTIVE',
  phase: 'MAIN',
  turn: { number: 1, activeSlot: 'bottom', deadlineAt: null },
  terrain: null,
  players: [
    {
      slot: 'bottom', displayName: 'Jogador Um', classId: 'GUARDIAN',
      hero: { hp: 30, armor: 0 }, mana: { current: 1, max: 1 },
      handCount: 1, deckCount: 26, board: [],
    },
    {
      slot: 'top', displayName: 'Jogador Dois', classId: 'EXILE',
      hero: { hp: 30, armor: 0 }, mana: { current: 0, max: 0 },
      handCount: 0, deckCount: 26, board: [],
    },
  ],
};

const HAND_VIEW = {
  schemaVersion: 1,
  kind: 'hand',
  status: 'ACTIVE',
  phase: 'MAIN',
  isActive: true,
  viewer: {
    classId: 'GUARDIAN', mana: { current: 1, max: 1 },
    nextSpellDiscount: 0, boardCount: 0,
  },
  cards: [HAND_CARD],
};

const SCENE_VIEWS = {
  invite: {
    schemaVersion: 1, kind: 'scene', sceneKind: 'invite',
    payload: {
      challengerName: 'Desafiante', challengedName: 'Oponente',
      challengerClassId: 'GUARDIAN', challengedClassId: 'EXILE',
      modeLabel: 'NORMAL', expiresLabel: '5 MIN',
    },
  },
  mulligan: {
    schemaVersion: 1, kind: 'scene', sceneKind: 'mulligan',
    payload: { playerName: 'Aventureiro', classId: 'GUARDIAN', handSize: 4 },
  },
  turn: {
    schemaVersion: 1, kind: 'scene', sceneKind: 'turn',
    payload: { playerName: 'Aventureiro', classId: 'GUARDIAN', turnNumber: 2, deadlineLabel: '45s' },
  },
  victory: {
    schemaVersion: 1, kind: 'scene', sceneKind: 'victory',
    payload: {
      winnerName: 'Vencedor', classId: 'GUARDIAN',
      reasonLabel: 'VITÓRIA', progressionLabel: 'Nv. 2',
    },
  },
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
      payload: { view: BOARD_VIEW },
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
    ['/v1/games/tavern/board', { view: BOARD_VIEW }, 1200, 940],
    ['/v1/games/tavern/hand', { view: HAND_VIEW }, 720, 960],
    ['/v1/games/tavern/scene', { view: SCENE_VIEWS.invite }, 1200, 675],
    ['/v1/games/tavern/scene', { view: SCENE_VIEWS.mulligan }, 1200, 675],
    ['/v1/games/tavern/scene', { view: SCENE_VIEWS.turn }, 1200, 675],
    ['/v1/games/tavern/scene', { view: SCENE_VIEWS.victory }, 1200, 675],
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

test('mão pagina por query sem acrescentar campos ao corpo Render View v1', async () => {
  const calls: Array<{ view: unknown; page: number | undefined }> = [];
  const handle = await createRouteApp({
    renderHand: async (view, page) => {
      calls.push({ view, page });
      return Buffer.from(`png-hand-p${page}`);
    },
  });
  try {
    const response = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/hand?page=2',
      payload: { view: { ...HAND_VIEW, cards: Array.from({ length: 6 }, (_, index) => ({
        ...HAND_CARD,
        cardId: `GY-${String(index + 1).padStart(3, '0')}`,
      })) } },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.page, 2);
    assert.deepEqual(Object.keys(response.json().data).sort(), ['height', 'media', 'width']);
  } finally {
    await handle.close();
  }
});

test('mão recusa página inválida, mais de dez cartas e page dentro do corpo', async () => {
  let renderCalls = 0;
  const handle = await createRouteApp({
    renderHand: async () => { renderCalls += 1; return Buffer.from('não deveria renderizar'); },
  });
  const tenCards = Array.from({ length: 10 }, (_, index) => ({
    ...HAND_CARD,
    cardId: `GY-${String(index + 1).padStart(3, '0')}`,
  }));
  try {
    for (const request of [
      { url: '/v1/games/tavern/hand?page=0', payload: { view: HAND_VIEW } },
      { url: '/v1/games/tavern/hand?page=3', payload: { view: { ...HAND_VIEW, cards: tenCards } } },
      { url: '/v1/games/tavern/hand', payload: { view: HAND_VIEW, page: 1 } },
      { url: '/v1/games/tavern/hand', payload: { view: { ...HAND_VIEW, cards: [...tenCards, HAND_CARD] } } },
    ]) {
      const response = await handle.app.inject({
        method: 'POST', url: request.url, payload: request.payload,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.statusCode, 400, request.url);
    }
    assert.equal(renderCalls, 0);
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
      payload: {},
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await handle.close();
  }
});

test('Render View v1 recusa sentinelas privadas e campos extras em qualquer nível', async () => {
  let renderCalls = 0;
  const handle = await createRouteApp({
    renderBoard: async () => { renderCalls += 1; return Buffer.from('não deveria renderizar'); },
    renderHand: async () => { renderCalls += 1; return Buffer.from('não deveria renderizar'); },
  });
  const boardWithSecrets = {
    ...BOARD_VIEW,
    seed: 'seed-nunca-deve-cruzar',
    players: [
      { ...BOARD_VIEW.players[0], deck: ['GY-001'], hand: [HAND_CARD] },
      BOARD_VIEW.players[1],
    ],
  };
  const handWithOpponent = {
    ...HAND_VIEW,
    opponentHand: [HAND_CARD],
    viewer: { ...HAND_VIEW.viewer, playerId: '5511999999999@s.whatsapp.net' },
  };

  try {
    for (const [url, payload] of [
      ['/v1/games/tavern/board', { view: boardWithSecrets }],
      ['/v1/games/tavern/hand', { view: handWithOpponent }],
      ['/v1/games/tavern/board', { view: BOARD_VIEW, playerNames: {} }],
    ] as const) {
      const response = await handle.app.inject({
        method: 'POST', url, payload,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.statusCode, 400, `${url} deveria recusar campos não allowlisted`);
    }
    assert.equal(renderCalls, 0);
  } finally {
    await handle.close();
  }
});

test('Render View v1 recusa JIDs mesmo quando aparecem dentro de nome ou texto', async () => {
  const handle = await createRouteApp();
  const boardWithJid = {
    ...BOARD_VIEW,
    players: [
      { ...BOARD_VIEW.players[0], displayName: 'Jogador 5511999999999@s.whatsapp.net oculto' },
      BOARD_VIEW.players[1],
    ],
  };
  const boardWithPhone = {
    ...BOARD_VIEW,
    players: [
      { ...BOARD_VIEW.players[0], displayName: '+55 (11) 98888-7777' },
      BOARD_VIEW.players[1],
    ],
  };
  const boardWithBroadcast = {
    ...BOARD_VIEW,
    players: [
      { ...BOARD_VIEW.players[0], displayName: 'contato@broadcast oculto' },
      BOARD_VIEW.players[1],
    ],
  };
  const handWithJid = {
    ...HAND_VIEW,
    cards: [{ ...HAND_CARD, text: 'Convoque 120363000000000000@g.us agora.' }],
  };
  const handWithNewsletter = {
    ...HAND_VIEW,
    cards: [{ ...HAND_CARD, text: 'Canal interno@newsletter não deve vazar.' }],
  };

  try {
    for (const [url, view] of [
      ['/v1/games/tavern/board', boardWithJid],
      ['/v1/games/tavern/board', boardWithPhone],
      ['/v1/games/tavern/board', boardWithBroadcast],
      ['/v1/games/tavern/hand', handWithJid],
      ['/v1/games/tavern/hand', handWithNewsletter],
    ] as const) {
      const response = await handle.app.inject({
        method: 'POST', url, payload: { view },
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.statusCode, 400, `${url} deveria recusar JID`);
    }
  } finally {
    await handle.close();
  }
});

test('cenas recusam JID, telefone e campos de identidade não allowlisted', async () => {
  let renderCalls = 0;
  const handle = await createRouteApp({
    renderScene: async () => { renderCalls += 1; return Buffer.from('não deveria renderizar'); },
  });
  const inviteWithJid = {
    ...SCENE_VIEWS.invite,
    payload: { ...SCENE_VIEWS.invite.payload, challengerName: 'Nome 5511@lid oculto' },
  };
  const inviteWithPhone = {
    ...SCENE_VIEWS.invite,
    payload: { ...SCENE_VIEWS.invite.payload, challengedName: '+55 (11) 99999-9999' },
  };
  const turnWithIdentity = {
    ...SCENE_VIEWS.turn,
    payload: { ...SCENE_VIEWS.turn.payload, playerId: '5511999999999@s.whatsapp.net' },
  };

  try {
    for (const view of [inviteWithJid, inviteWithPhone, turnWithIdentity]) {
      const response = await handle.app.inject({
        method: 'POST', url: '/v1/games/tavern/scene', payload: { view },
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(renderCalls, 0);
  } finally {
    await handle.close();
  }
});

test('Render View exige versão 1 e ordenação bottom/top', async () => {
  const handle = await createRouteApp();
  try {
    for (const view of [
      { ...BOARD_VIEW, schemaVersion: 2 },
      { ...BOARD_VIEW, players: [BOARD_VIEW.players[1], BOARD_VIEW.players[0]] },
    ]) {
      const response = await handle.app.inject({
        method: 'POST', url: '/v1/games/tavern/board', payload: { view },
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.statusCode, 400);
    }
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
      payload: { view: BOARD_VIEW },
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
      payload: { view: { ...SCENE_VIEWS.invite, sceneKind: 'nao-existe' } },
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
      payload: { view: HAND_VIEW },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'BUNNYFY_INTERNAL_ERROR');
  } finally {
    await handle.close();
  }
});

test('renderer real produz PNG válido a partir das Render Views sanitizadas', async () => {
  const handle = await createRouteApp({
    // sem overrides de render* aqui: usa VNextBoardRenderer/VNextHandRenderer/
    // VNextSceneRenderer de verdade, contra os assets reais em assets/tavern.
    renderBoard: undefined,
    renderHand: undefined,
    renderScene: undefined,
  });
  const boardView = {
    ...BOARD_VIEW,
    players: [
      { ...BOARD_VIEW.players[0], board: [BOARD_CARD] },
      BOARD_VIEW.players[1],
    ],
  };
  try {
    const boardResponse = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { view: boardView },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(boardResponse.statusCode, 200);

    const handResponse = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/hand',
      payload: { view: HAND_VIEW },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(handResponse.statusCode, 200);

    const sceneResponse = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/scene',
      payload: { view: SCENE_VIEWS.invite },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(sceneResponse.statusCode, 200);

    const fs = await import('node:fs/promises');
    for (const response of [boardResponse, handResponse, sceneResponse]) {
      const mediaId = response.json().data.media.mediaId as string;
      const entry = await handle.tempStorage.get(mediaId);
      assert.ok(entry);
      const bytes = await fs.readFile(entry.filePath);
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.ok(bytes.length > 10_000, 'PNG real deveria ter um tamanho plausível');
    }
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
      payload: { view: BOARD_VIEW },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await new Promise(resolve => setTimeout(resolve, 20));

    const second = await handle.app.inject({
      method: 'POST', url: '/v1/games/tavern/board',
      payload: { view: BOARD_VIEW },
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
