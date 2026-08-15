import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const auth = { authorization: `Bearer ${TEST_TOKEN}` };
const fakeWebp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(32),
  Buffer.from('ANIM'),
  Buffer.from('ANMF'.repeat(18)),
]);
const rendered = {
  buffer: fakeWebp,
  mime: 'image/webp' as const,
  width: 512 as const,
  height: 512 as const,
  fps: 9,
  frames: 18,
  durationSeconds: 2,
  animated: true as const,
  quality: 58,
};

test('rota de logos exige Bearer e escopo images:write', async () => {
  const { app, close } = await createTestApp({ renderLogoSticker: async () => rendered });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/images/logo', payload: { model: 'glitch', texts: ['Teste'] } });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await close();
  }
});

test('os vinte aliases chegam ao renderer sticker com cardinalidade correta', async () => {
  const calls: Array<{ model: string; texts: readonly string[] }> = [];
  const { app, close } = await createTestApp({
    renderLogoSticker: async (input) => {
      calls.push(input);
      return rendered;
    },
  });
  const one = ['darkgreen', 'glitch', 'write', 'advanced', 'typography', 'pixel', 'neon', 'flag', 'americanflag', 'deleting'];
  const two = ['pornhub', 'avengers', 'graffiti', 'captainamerica', 'stone3d', 'neon2', 'thor', 'amongus', 'deadpool', 'blackpink'];
  try {
    for (const model of one) {
      const response = await app.inject({ method: 'POST', url: '/v1/images/logo', headers: auth, payload: { model, texts: ['BunnyFy'] } });
      assert.equal(response.statusCode, 200, `${model}: ${response.body}`);
    }
    for (const model of two) {
      const response = await app.inject({ method: 'POST', url: '/v1/images/logo', headers: auth, payload: { model, texts: ['Bunny', 'Fy'] } });
      assert.equal(response.statusCode, 200, `${model}: ${response.body}`);
    }
    assert.equal(calls.length, 20);
  } finally {
    await close();
  }
});

test('resposta possui descritor canônico de sticker WebP animado', async () => {
  const { app, tempStorage, close } = await createTestApp({ renderLogoSticker: async () => rendered });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/images/logo', headers: auth, payload: { model: 'neon2', texts: ['Bunny', 'Fy'] } });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data;
    assert.equal(data.animated, true);
    assert.equal(data.format, 'sticker');
    assert.equal(data.media.mime, 'image/webp');
    assert.equal(data.width, 512);
    assert.equal(data.height, 512);
    assert.equal(data.fps, 9);
    assert.equal(data.frames, 18);
    assert.equal(data.durationSeconds, 2);
    assert.ok(await tempStorage.get(data.media.mediaId));
  } finally {
    await close();
  }
});

test('modelo, cardinalidade e texto fora do contrato são recusados antes do renderer', async () => {
  let calls = 0;
  const { app, close } = await createTestApp({ renderLogoSticker: async () => { calls += 1; return rendered; } });
  try {
    for (const payload of [
      { model: 'livre', texts: ['A'] },
      { model: 'glitch', texts: ['A', 'B'] },
      { model: 'neon2', texts: ['A'] },
      { model: 'glitch', texts: [''] },
      { model: 'glitch', texts: ['A'.repeat(41)] },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/v1/images/logo', headers: auth, payload });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(calls, 0);
  } finally {
    await close();
  }
});

test('concorrência um recusa segunda renderização e libera o slot', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const { app, close } = await createTestApp({
    envOverrides: { LOGO_MAX_CONCURRENCY: '1' },
    renderLogoSticker: async () => {
      calls += 1;
      if (calls === 1) { entered(); await gate; }
      return rendered;
    },
  });
  try {
    const first = app.inject({ method: 'POST', url: '/v1/images/logo', headers: auth, payload: { model: 'glitch', texts: ['A'] } });
    await started;
    const second = await app.inject({ method: 'POST', url: '/v1/images/logo', headers: auth, payload: { model: 'glitch', texts: ['B'] } });
    assert.equal(second.statusCode, 429);
    release();
    assert.equal((await first).statusCode, 200);
    const third = await app.inject({ method: 'POST', url: '/v1/images/logo', headers: auth, payload: { model: 'glitch', texts: ['C'] } });
    assert.equal(third.statusCode, 200);
  } finally {
    release();
    await close();
  }
});
