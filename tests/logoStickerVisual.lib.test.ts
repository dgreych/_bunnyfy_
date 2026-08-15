import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { ANCHOR_LOGO_MODELS, renderAnchorLogoSvg } from '../src/lib/logoStickerVisual.ts';

const sample = (model: (typeof ANCHOR_LOGO_MODELS)[number], alternate = false) => {
  if (['glitch', 'write', 'neon'].includes(model)) return alternate ? ['OUTRO'] : ['BunnyFy'];
  return alternate ? ['Outra', 'Marca'] : ['Bunny', 'Fy'];
};

test('seis âncoras são sticker-first, 512x512 e sem fonte runtime', () => {
  assert.equal(ANCHOR_LOGO_MODELS.length, 6);
  for (const model of ANCHOR_LOGO_MODELS) {
    const svg = renderAnchorLogoSvg({ model, texts: sample(model) }, 9);
    assert.match(svg, /width="512" height="512"/);
    assert.match(svg, new RegExp(`data-model="${model}"`));
    assert.equal(svg.includes('<text'), false, model);
    assert.equal(svg.includes('font-family'), false, model);
    assert.equal(svg.includes('<image'), false, model);
    assert.equal(svg.includes('https://'), false, model);
  }
});

test('texto diferente muda pixels reais no centro da composição', async () => {
  for (const model of ANCHOR_LOGO_MODELS) {
    const first = renderAnchorLogoSvg({ model, texts: sample(model) }, 9);
    const second = renderAnchorLogoSvg({ model, texts: sample(model, true) }, 9);
    const a = await sharp(Buffer.from(first)).extract({ left: 48, top: 116, width: 416, height: 288 }).raw().toBuffer();
    const b = await sharp(Buffer.from(second)).extract({ left: 48, top: 116, width: 416, height: 288 }).raw().toBuffer();
    assert.equal(a.length, b.length);
    let different = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        Math.abs(a[i]! - b[i]!)
        + Math.abs(a[i + 1]! - b[i + 1]!)
        + Math.abs(a[i + 2]! - b[i + 2]!)
        + Math.abs(a[i + 3]! - b[i + 3]!) > 24
      ) {
        different += 1;
      }
    }
    assert.ok(different > 700, `${model}: somente ${different} pixels mudaram`);
  }
});

test('bordas permanecem transparentes para uso como sticker', async () => {
  for (const model of ANCHOR_LOGO_MODELS) {
    const svg = renderAnchorLogoSvg({ model, texts: sample(model) }, 9);
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    assert.equal(alpha(0, 0), 0, `${model}: canto superior esquerdo opaco`);
    assert.equal(alpha(511, 511), 0, `${model}: canto inferior direito opaco`);
  }
});
