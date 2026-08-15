import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { STICKER_LOGO_MODELS } from '../src/lib/logoStickerVisualAll.ts';
import { renderStickerLogoSvgV2 } from '../src/lib/logoStickerVisualV2.ts';

const ONE_TEXT = new Set([
  'darkgreen', 'glitch', 'write', 'advanced', 'typography',
  'pixel', 'neon', 'flag', 'americanflag', 'deleting',
]);

function sample(model: string, alternate = false): string[] {
  return ONE_TEXT.has(model)
    ? [alternate ? 'OUTRO' : 'BunnyFy']
    : alternate ? ['Outra', 'Marca'] : ['Bunny', 'Fy'];
}

test('vinte modelos sticker-first não dependem de texto/fontes runtime', () => {
  assert.equal(STICKER_LOGO_MODELS.length, 20);
  for (const model of STICKER_LOGO_MODELS) {
    const svg = renderStickerLogoSvgV2({ model, texts: sample(model) }, 9);
    assert.match(svg, /width="512" height="512"/);
    assert.equal(svg.includes('<text'), false, model);
    assert.equal(svg.includes('font-family'), false, model);
    assert.equal(svg.includes('<image'), false, model);
  }
});

test('vinte modelos mudam pixels reais quando o texto muda', async () => {
  for (const model of STICKER_LOGO_MODELS) {
    const first = await sharp(Buffer.from(renderStickerLogoSvgV2({ model, texts: sample(model) }, 9)))
      .ensureAlpha().raw().toBuffer();
    const second = await sharp(Buffer.from(renderStickerLogoSvgV2({ model, texts: sample(model, true) }, 9)))
      .ensureAlpha().raw().toBuffer();
    let different = 0;
    for (let index = 0; index < first.length; index += 4) {
      if (
        Math.abs(first[index]! - second[index]!)
        + Math.abs(first[index + 1]! - second[index + 1]!)
        + Math.abs(first[index + 2]! - second[index + 2]!)
        + Math.abs(first[index + 3]! - second[index + 3]!) > 30
      ) different += 1;
    }
    assert.ok(different > 500, `${model}: somente ${different} pixels mudaram`);
  }
});

test('vinte modelos preservam transparência nos cantos', async () => {
  for (const model of STICKER_LOGO_MODELS) {
    const { data, info } = await sharp(Buffer.from(renderStickerLogoSvgV2({ model, texts: sample(model) }, 9)))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    assert.equal(alpha(0, 0), 0, model);
    assert.equal(alpha(511, 511), 0, model);
  }
});
