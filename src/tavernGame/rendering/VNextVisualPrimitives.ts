// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
import Jimp from 'jimp';

import { COLORS, classVisual } from './VNextVisualTheme.ts';

function rect(canvas, x, y, width, height, color) {
  canvas.composite(new Jimp(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), color), Math.round(x), Math.round(y));
}

// Cartas sem arte própria (a maioria do catálogo hoje) usavam formas
// geométricas desenhadas na mão tentando imitar escudo/lâmina/raio — o
// resultado lia como placeholder de programador, não como arte de jogo.
// O emblema de classe já é um asset desenhado e consistente (usado no
// cabeçalho do herói); reaproveitar ele aqui é mais forte visualmente e
// garante que toda carta sem arte própria pelo menos exiba uma identidade
// de classe reconhecível, não um retângulo genérico.
async function createFallbackArt(assets, classId, width, height) {
  const visual = classVisual(classId);
  const canvas = new Jimp(width, height, COLORS.coal);
  const accent = visual.accent;

  rect(canvas, 0, 0, width, height, 0x0a0810ff);
  rect(canvas, 0, 0, width, height, ((accent & 0xffffff00) | 0x22) >>> 0);

  const badge = await assets.image(`class.${classId}`);
  if (badge) {
    const size = Math.round(Math.min(width, height) * 0.86);
    const bx = Math.round((width - size) / 2);
    const by = Math.round((height - size) / 2);
    canvas.composite(badge.contain(size, size), bx, by);
  }

  return canvas;
}

function applyBoardVeil(canvas) {
  rect(canvas, 0, 0, canvas.bitmap.width, 108, 0x05040788);
  rect(canvas, 0, canvas.bitmap.height - 116, canvas.bitmap.width, 116, 0x050407aa);
  rect(canvas, Math.round(canvas.bitmap.width * 0.22), Math.round(canvas.bitmap.height * 0.44),
    Math.round(canvas.bitmap.width * 0.56), Math.round(canvas.bitmap.height * 0.12), 0xd5a44111);
  return canvas;
}

function applyHandVeil(canvas) {
  rect(canvas, 0, 0, canvas.bitmap.width, 96, 0x050407aa);
  rect(canvas, 32, 94, canvas.bitmap.width - 64, canvas.bitmap.height - 154, 0x08060c88);
  return canvas;
}

export {
  applyBoardVeil,
  applyHandVeil,
  createFallbackArt
};
