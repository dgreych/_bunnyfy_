import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import {
  inspectAnimatedWebp,
  logicalFrameForEncodedFrame,
  LOGO_STICKER_DURATION_SECONDS,
  LOGO_STICKER_FPS,
  LOGO_STICKER_FRAMES,
  LOGO_STICKER_LOGICAL_FRAMES,
  LOGO_STICKER_TARGET_MAX_BYTES,
  renderAnchorLogoSticker,
} from '../src/lib/logoStickerRenderer.ts';

test('inspetor exige container WebP animado com frames', () => {
  assert.deepEqual(inspectAnimatedWebp(Buffer.from('not-webp')), { valid: false, frames: 0 });
  const fake = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.alloc(4),
    Buffer.from('WEBP'),
    Buffer.alloc(24),
    Buffer.from('ANIM'),
    Buffer.from('ANMF'.repeat(3)),
  ]);
  assert.deepEqual(inspectAnimatedWebp(fake), { valid: true, frames: 3 });
});

test('18 frames codificados amostram a animação lógica completa de 24 frames', () => {
  assert.equal(LOGO_STICKER_FRAMES, 18);
  assert.equal(LOGO_STICKER_FPS, 9);
  assert.equal(LOGO_STICKER_LOGICAL_FRAMES, 24);
  assert.equal(LOGO_STICKER_DURATION_SECONDS, 2);
  assert.equal(logicalFrameForEncodedFrame(0), 0);
  assert.equal(logicalFrameForEncodedFrame(LOGO_STICKER_FRAMES - 1), LOGO_STICKER_LOGICAL_FRAMES - 1);

  const logicalFrames = Array.from(
    { length: LOGO_STICKER_FRAMES },
    (_, index) => logicalFrameForEncodedFrame(index),
  );
  assert.equal(new Set(logicalFrames).size, LOGO_STICKER_FRAMES);
  assert.ok(logicalFrames.every((value, index) => index === 0 || value > logicalFrames[index - 1]!));
});

test('ffmpeg real produz sticker WebP animado 512x512 e limpa workspace', async (t) => {
  // Rastreia o workspace exato criado por ESTA chamada, em vez de comparar um
  // snapshot do os.tmpdir() compartilhado — outros arquivos de teste (ex.:
  // logoStickerRenderer.all20.test.ts) rodam em paralelo e criam/removem
  // workspaces com o mesmo prefixo ao mesmo tempo, o que gerava falso
  // positivo de "sobra não limpa" por pura coincidência de timing.
  const originalMkdtemp = fs.mkdtemp;
  const capturedWorkspaces: string[] = [];
  t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => {
    const created = await originalMkdtemp(...args);
    capturedWorkspaces.push(created);
    return created;
  });

  const result = await renderAnchorLogoSticker(
    { model: 'write', texts: ['BunnyFy'] },
    { ffmpegPath: 'ffmpeg', timeoutMs: 45_000 },
  );
  assert.equal(result.mime, 'image/webp');
  assert.equal(result.width, 512);
  assert.equal(result.height, 512);
  assert.equal(result.animated, true);
  assert.equal(result.frames, LOGO_STICKER_FRAMES);
  assert.equal(result.fps, LOGO_STICKER_FPS);
  assert.equal(result.durationSeconds, LOGO_STICKER_DURATION_SECONDS);
  assert.equal(result.buffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(result.buffer.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.ok(result.buffer.indexOf(Buffer.from('ANIM')) >= 0);
  assert.equal(inspectAnimatedWebp(result.buffer).frames, LOGO_STICKER_FRAMES);
  assert.ok(result.buffer.length <= LOGO_STICKER_TARGET_MAX_BYTES);

  assert.equal(capturedWorkspaces.length, 1);
  await assert.rejects(fs.access(capturedWorkspaces[0]!));
});
