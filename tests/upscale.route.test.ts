import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import sharp from 'sharp';

import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

async function putImage(
  tempStorage: Awaited<ReturnType<typeof createTestApp>>['tempStorage'],
  buffer: Buffer,
  mimeType: string,
) {
  return tempStorage.put(Readable.from(buffer), { mimeType, originalName: 'upscale-input' });
}

async function makePng(width = 32, height = 24): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 40, g: 120, b: 210, alpha: 0.8 } },
  })
    .png()
    .toBuffer();
}

test('upscale exige autenticação', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      payload: { mediaId: 'abcdefghijklmnopqrstuvwx', scale: 2 },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await close();
  }
});

test('upscale aceita somente escala 2 ou 4', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: 'abcdefghijklmnopqrstuvwx', scale: 3 },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
  } finally {
    await close();
  }
});

test('upscale calcula pixels finais antes de chamar o processador', async () => {
  let called = false;
  const { app, tempStorage, close } = await createTestApp({
    envOverrides: {
      IMAGE_MAX_INPUT_PIXELS: '10000',
      IMAGE_MAX_OUTPUT_PIXELS: '20000',
    },
    upscaleImage: async () => {
      called = true;
    },
  });

  try {
    const source = await putImage(tempStorage, await makePng(100, 100), 'image/png');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: source.id, scale: 2 },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, 'BUNNYFY_TOO_LARGE');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('upscale 2x usa Sharp real, preserva PNG e devolve dimensões', async () => {
  const { app, tempStorage, close } = await createTestApp();
  try {
    const source = await putImage(tempStorage, await makePng(32, 24), 'image/png');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: source.id, scale: 2 },
    });
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.equal(body.data.scale, 2);
    assert.equal(body.data.width, 64);
    assert.equal(body.data.height, 48);
    assert.equal(body.data.media.mime, 'image/png');

    const output = await tempStorage.get(body.data.media.mediaId);
    assert.ok(output);
    const metadata = await sharp(output.filePath).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 64);
    assert.equal(metadata.height, 48);
  } finally {
    await close();
  }
});

test('upscale 4x considera orientação EXIF e produz JPEG já orientado', async () => {
  const input = await sharp({
    create: { width: 10, height: 20, channels: 3, background: { r: 180, g: 60, b: 20 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const { app, tempStorage, close } = await createTestApp();
  try {
    const source = await putImage(tempStorage, input, 'image/jpeg');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: source.id, scale: 4 },
    });
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.equal(body.data.width, 80);
    assert.equal(body.data.height, 40);
    assert.equal(body.data.media.mime, 'image/jpeg');

    const output = await tempStorage.get(body.data.media.mediaId);
    assert.ok(output);
    const metadata = await sharp(output.filePath).metadata();
    assert.equal(metadata.width, 80);
    assert.equal(metadata.height, 40);
    assert.equal(metadata.orientation, undefined);
  } finally {
    await close();
  }
});

test('upscale aplica limite final de bytes e remove saída rejeitada', async () => {
  const { app, tempStorage, mediaDir, close } = await createTestApp({
    envOverrides: { IMAGE_MAX_OUTPUT_BYTES: '100' },
    upscaleImage: async (_inputPath, outputPath) => {
      await sharp({
        create: { width: 64, height: 48, channels: 4, background: { r: 30, g: 40, b: 50, alpha: 1 } },
      })
        .png()
        .toFile(outputPath);
    },
  });

  try {
    const source = await putImage(tempStorage, await makePng(32, 24), 'image/png');
    const before = (await fs.readdir(mediaDir)).sort();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: source.id, scale: 2 },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, 'BUNNYFY_TOO_LARGE');
    assert.deepEqual((await fs.readdir(mediaDir)).sort(), before);
  } finally {
    await close();
  }
});

test('upscale compartilha o limite de concorrência do bloco de imagens', async () => {
  let releaseFirst!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let enteredFirst!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredFirst = resolve;
  });

  const { app, tempStorage, close } = await createTestApp({
    envOverrides: { IMAGE_PROCESS_MAX_CONCURRENCY: '1' },
    upscaleImage: async (_inputPath, outputPath) => {
      enteredFirst();
      await release;
      await sharp({
        create: { width: 64, height: 48, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 1 } },
      })
        .png()
        .toFile(outputPath);
    },
  });

  try {
    const source = await putImage(tempStorage, await makePng(), 'image/png');
    const first = app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: source.id, scale: 2 },
    });
    await entered;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: source.id, scale: 2 },
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'BUNNYFY_RATE_LIMITED');

    releaseFirst();
    assert.equal((await first).statusCode, 200);
  } finally {
    releaseFirst();
    await close();
  }
});

test('upscale limpa arquivo parcial quando o processador falha', async () => {
  const { app, tempStorage, mediaDir, close } = await createTestApp({
    upscaleImage: async (_inputPath, outputPath) => {
      await fs.writeFile(outputPath, Buffer.alloc(512, 1));
      throw new Error('falha simulada');
    },
  });

  try {
    const source = await putImage(tempStorage, await makePng(), 'image/png');
    const before = (await fs.readdir(mediaDir)).sort();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/upscale',
      headers: authHeaders,
      payload: { mediaId: source.id, scale: 2 },
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual((await fs.readdir(mediaDir)).sort(), before);
  } finally {
    await close();
  }
});
