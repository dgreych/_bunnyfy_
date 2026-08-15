import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import sharp from 'sharp';

import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

async function putBuffer(
  tempStorage: Awaited<ReturnType<typeof createTestApp>>['tempStorage'],
  buffer: Buffer,
  mimeType: string,
) {
  return tempStorage.put(Readable.from(buffer), { mimeType, originalName: 'input' });
}

async function makePng(width = 32, height = 24): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 80, b: 40 } },
  })
    .png()
    .toBuffer();
}

test('remove-background exige autenticação', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/images/remove-background', payload: { mediaId: 'abc' } });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await close();
  }
});

test('remove-background rejeita mediaId malformado', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: '../arquivo' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
  } finally {
    await close();
  }
});

test('remove-background retorna 404 para mídia inexistente', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: 'abcdefghijklmnopqrstuvwx' },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, 'BUNNYFY_NOT_FOUND');
  } finally {
    await close();
  }
});

test('remove-background valida os bytes como imagem antes de chamar o processador', async () => {
  let called = false;
  const { app, tempStorage, close } = await createTestApp({
    removeBackground: async () => {
      called = true;
    },
  });

  try {
    const entry = await putBuffer(tempStorage, Buffer.from('isto não é uma imagem'), 'image/png');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: entry.id },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('remove-background bloqueia imagem acima do teto de pixels antes do processador', async () => {
  let called = false;
  const { app, tempStorage, close } = await createTestApp({
    envOverrides: { IMAGE_MAX_INPUT_PIXELS: '100' },
    removeBackground: async () => {
      called = true;
    },
  });

  try {
    const entry = await putBuffer(tempStorage, await makePng(20, 20), 'image/png');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: entry.id },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, 'BUNNYFY_TOO_LARGE');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('remove-background registra PNG transparente e devolve descritor BunnyFy', async () => {
  const { app, tempStorage, close } = await createTestApp({
    removeBackground: async (inputPath, outputPath) => {
      await sharp(inputPath).ensureAlpha(0.5).png().toFile(outputPath);
    },
  });

  try {
    const source = await putBuffer(tempStorage, await makePng(32, 24), 'image/png');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: source.id },
    });
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.width, 32);
    assert.equal(body.data.height, 24);
    assert.equal(body.data.media.mime, 'image/png');
    assert.equal(typeof body.data.media.mediaId, 'string');
    assert.equal(body.data.media.mediaUrl.startsWith('/v1/media/'), true);

    const output = await tempStorage.get(body.data.media.mediaId);
    assert.ok(output);
    const metadata = await sharp(output.filePath).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.hasAlpha, true);
  } finally {
    await close();
  }
});

test('remove-background devolve 503 quando modelo real não está provisionado', async () => {
  const { app, tempStorage, close } = await createTestApp({
    envOverrides: { REMBG_MODEL_DIR: `/tmp/bunnyfy-modelo-ausente-${process.pid}` },
  });

  try {
    const source = await putBuffer(tempStorage, await makePng(), 'image/png');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: source.id },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'BUNNYFY_TOOL_UNAVAILABLE');
  } finally {
    await close();
  }
});

test('remove-background recusa concorrência acima do limite', async () => {
  let releaseFirst!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let enteredFirst!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredFirst = resolve;
  });
  let calls = 0;

  const { app, tempStorage, close } = await createTestApp({
    envOverrides: { IMAGE_PROCESS_MAX_CONCURRENCY: '1' },
    removeBackground: async (inputPath, outputPath) => {
      calls += 1;
      if (calls === 1) {
        enteredFirst();
        await released;
      }
      await sharp(inputPath).ensureAlpha().png().toFile(outputPath);
    },
  });

  try {
    const source = await putBuffer(tempStorage, await makePng(), 'image/png');
    const first = app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: source.id },
    });
    await entered;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: source.id },
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'BUNNYFY_RATE_LIMITED');

    releaseFirst();
    assert.equal((await first).statusCode, 200);
    assert.equal(calls, 1);
  } finally {
    releaseFirst();
    await close();
  }
});

test('remove-background limpa saída parcial quando o processador falha', async () => {
  const { app, tempStorage, mediaDir, close } = await createTestApp({
    removeBackground: async (_inputPath, outputPath) => {
      await fs.writeFile(outputPath, Buffer.from('parcial'));
      throw new Error('falha simulada');
    },
  });

  try {
    const source = await putBuffer(tempStorage, await makePng(), 'image/png');
    const before = (await fs.readdir(mediaDir)).sort();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/remove-background',
      headers: authHeaders,
      payload: { mediaId: source.id },
    });
    assert.equal(response.statusCode, 500);
    const after = (await fs.readdir(mediaDir)).sort();
    assert.deepEqual(after, before);
  } finally {
    await close();
  }
});
