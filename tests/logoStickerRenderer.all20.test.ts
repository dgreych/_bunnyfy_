import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LOGO_STICKER_FPS,
  LOGO_STICKER_FRAMES,
  LOGO_STICKER_TARGET_MAX_BYTES,
  renderLogoSticker,
} from '../src/lib/logoStickerRenderer.ts';
import { STICKER_LOGO_MODELS } from '../src/lib/logoStickerVisualAll.ts';

const ONE_TEXT = new Set([
  'darkgreen', 'glitch', 'write', 'advanced', 'typography',
  'pixel', 'neon', 'flag', 'americanflag', 'deleting',
]);

function sample(model: string): string[] {
  return ONE_TEXT.has(model) ? ['BunnyFy'] : ['Bunny', 'Fy'];
}

test('vinte modelos geram WebP animado real dentro do teto de sticker', async () => {
  assert.equal(STICKER_LOGO_MODELS.length, 20);
  const diagnostics: Array<{ model: string; bytes: number; quality: number }> = [];

  for (const model of STICKER_LOGO_MODELS) {
    const result = await renderLogoSticker(
      { model, texts: sample(model) },
      { ffmpegPath: 'ffmpeg', timeoutMs: 45_000 },
    );
    assert.equal(result.mime, 'image/webp', model);
    assert.equal(result.width, 512, model);
    assert.equal(result.height, 512, model);
    assert.equal(result.frames, LOGO_STICKER_FRAMES, model);
    assert.equal(result.fps, LOGO_STICKER_FPS, model);
    assert.ok(result.buffer.length <= LOGO_STICKER_TARGET_MAX_BYTES, model);
    diagnostics.push({ model, bytes: result.buffer.length, quality: result.quality });
  }

  console.log(`BUN018C_WEBP_20=${JSON.stringify(diagnostics)}`);
});
