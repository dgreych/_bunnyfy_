import assert from 'node:assert/strict';
import test from 'node:test';

import Jimp from 'jimp';

import {
  VNextBoardRenderer,
  prepareBoardArt,
} from '../src/tavernGame/rendering/VNextBoardRenderer.ts';
import {
  calculateBoardLineLayout,
  truncateTextToPixelWidth,
} from '../src/tavernGame/rendering/VNextLayoutV4.ts';

function boardCard(index: number) {
  return {
    cardId: index % 2 === 0 ? 'GY-001' : 'GY-027',
    name: `Sentinela Extraordinariamente Longa das Ruínas ${index + 1}`,
    rarity: 'COMMON',
    classId: 'GUARDIAN',
    attack: index + 2,
    health: index + 3,
    keywords: index === 0 ? ['GUARD'] : [],
    canAttack: index % 2 === 0,
    attacksThisTurn: 0,
  };
}

function boardView(count: number) {
  return {
    schemaVersion: 1,
    kind: 'board',
    status: 'ACTIVE',
    phase: 'MAIN',
    turn: { number: 12, activeSlot: 'bottom', deadlineAt: null },
    terrain: { name: 'Salão das Sete Lanternas' },
    players: [
      {
        slot: 'bottom', displayName: 'Jogadora das Tempestades', classId: 'GUARDIAN',
        hero: { hp: 29, armor: 4 }, mana: { current: 7, max: 8 },
        handCount: 4, deckCount: 18,
        board: Array.from({ length: count }, (_, index) => boardCard(index)),
      },
      {
        slot: 'top', displayName: 'Adversário do Véu', classId: 'EXILE',
        hero: { hp: 21, armor: 0 }, mana: { current: 3, max: 8 },
        handCount: 5, deckCount: 16,
        board: Array.from({ length: count }, (_, index) => boardCard(index + 7)),
      },
    ],
  };
}

test('layout V4 centraliza de 1 a 7 cartas sem clipping nem sobreposição', () => {
  for (let count = 1; count <= 7; count += 1) {
    const layout = calculateBoardLineLayout(count, 154);
    const first = layout.cards[0];
    const last = layout.cards.at(-1);

    assert.ok(first);
    assert.ok(last);
    assert.ok(first.x >= layout.safeMargin);
    assert.ok(last.x + last.width <= layout.canvasWidth - layout.safeMargin);
    assert.ok(Math.abs(first.x - (layout.canvasWidth - layout.totalWidth) / 2) <= 1);
    for (let index = 1; index < layout.cards.length; index += 1) {
      const previous = layout.cards[index - 1];
      const current = layout.cards[index];
      assert.ok(previous);
      assert.ok(current);
      assert.ok(previous.x + previous.width < current.x);
    }
  }
});

test('nomes são truncados pela largura medida e crop remove a moldura histórica', () => {
  const result = truncateTextToPixelWidth('Dragão Carmesim do Horizonte Impossível', 90, value => value.length * 10);
  assert.ok(result.endsWith('...'));
  assert.ok(result.length * 10 <= 90);

  const fullCard = new Jimp(744, 1039, 0x334455ff);
  const cropped = prepareBoardArt(fullCard, 'GY-001');
  assert.deepEqual([cropped.bitmap.width, cropped.bitmap.height], [594, 488]);
  assert.deepEqual([fullCard.bitmap.width, fullCard.bitmap.height], [744, 1039]);

  const normalized = new Jimp(665, 886, 0x334455ff);
  const untouched = prepareBoardArt(normalized, 'GY-002');
  assert.deepEqual([untouched.bitmap.width, untouched.bitmap.height], [665, 886]);

  const replacementPortrait = new Jimp(1024, 1024, 0x334455ff);
  const replacementUntouched = prepareBoardArt(replacementPortrait, 'GY-001');
  assert.deepEqual([replacementUntouched.bitmap.width, replacementUntouched.bitmap.height], [1024, 1024]);
});

test('renderer V4 rasteriza duas linhas completas de sete cartas dentro de 1200x940', async () => {
  const renderer = new VNextBoardRenderer({ now: () => Date.parse('2026-08-15T18:00:00-03:00') });
  const output = await renderer.render(boardView(7));
  const image = await Jimp.read(output);
  const layout = calculateBoardLineLayout(7, 544);
  const rightmost = layout.cards.at(-1);

  assert.equal(image.bitmap.width, 1200);
  assert.equal(image.bitmap.height, 940);
  assert.ok(rightmost);
  assert.ok(rightmost.x + rightmost.width < image.bitmap.width);
  assert.notEqual(image.getPixelColor(rightmost.x + rightmost.width - 8, 544 + 200), 0x00000000);
});
