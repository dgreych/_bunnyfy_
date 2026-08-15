import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildVectorTextPath,
  vectorTextMask,
  vectorTextPathElement,
} from '../src/lib/vectorText.ts';

test('path textual não depende de fontes SVG', () => {
  const shape = buildVectorTextPath('BunnyFy', {
    x: 480,
    y: 270,
    maxWidth: 760,
    maxHeight: 180,
  });
  const markup = vectorTextPathElement(shape);
  assert.match(markup, /^<path /);
  assert.equal(markup.includes('<text'), false);
  assert.equal(markup.includes('font-family'), false);
  assert.ok(shape.d.length > 100);
});

test('conteúdo textual altera a geometria renderizável', () => {
  const a = buildVectorTextPath('BunnyFy', { x: 480, y: 270, maxWidth: 760, maxHeight: 180 });
  const b = buildVectorTextPath('BunnyFx', { x: 480, y: 270, maxWidth: 760, maxHeight: 180 });
  assert.notEqual(a.d, b.d);
});

test('acentos latinos ganham geometria própria', () => {
  const plain = buildVectorTextPath('ACAO', { x: 480, y: 270, maxWidth: 760, maxHeight: 180 });
  const accented = buildVectorTextPath('AÇÃO', { x: 480, y: 270, maxWidth: 760, maxHeight: 180 });
  assert.notEqual(plain.d, accented.d);
  assert.ok(accented.d.length > plain.d.length);
});

test('layout respeita a caixa máxima', () => {
  const shape = buildVectorTextPath('UMA FRASE BEM LONGA 123', {
    x: 480,
    y: 270,
    maxWidth: 700,
    maxHeight: 150,
    tracking: 6,
  });
  assert.ok(shape.width <= 700.01);
  assert.ok(shape.height <= 150.01);
});

test('máscara de material também usa path em vez de texto', () => {
  const shape = buildVectorTextPath('STONE', { x: 480, y: 270, maxWidth: 700, maxHeight: 160 });
  const mask = vectorTextMask('stoneMask', shape, { strokeWidth: shape.strokeWidth * 1.4 });
  assert.match(mask, /<mask id="stoneMask"/);
  assert.match(mask, /<path d=/);
  assert.equal(mask.includes('<text'), false);
});
