import assert from 'node:assert/strict';
import { test } from 'node:test';

import Jimp from 'jimp';

import type { TavernAssetRegistry } from '../src/tavernGame/rendering/TavernAssetRegistry.ts';
import {
  VNextHandRenderer,
  fitTextToWidth,
  handPage,
} from '../src/tavernGame/rendering/VNextHandRenderer.ts';

const BASE_CARD = {
  cardId: 'GY-001',
  name: 'Sentinela de Pedra',
  type: 'MINION',
  rarity: 'COMMON',
  cost: 2,
  attack: 2,
  health: 3,
  keywords: ['GUARD'],
  classId: 'GUARDIAN',
  text: 'Protege a mesa.',
};

function handView(count: number, cardOverrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'hand',
    status: 'ACTIVE',
    phase: 'MAIN',
    isActive: true,
    viewer: {
      classId: 'GUARDIAN',
      mana: { current: 10, max: 10 },
      nextSpellDiscount: 0,
      boardCount: 0,
    },
    cards: Array.from({ length: count }, (_, index) => ({
      ...BASE_CARD,
      ...cardOverrides,
      cardId: `GY-${String(index + 1).padStart(3, '0')}`,
      name: index === 0
        ? 'Sentinela de Pedra com um nome deliberadamente comprido demais para a placa'
        : `Carta ${index + 1}`,
    })),
  };
}

class MinimalAssets {
  requestedImages: string[] = [];

  async font(size: number) {
    return Jimp.loadFont(size >= 32 ? Jimp.FONT_SANS_32_WHITE : Jimp.FONT_SANS_16_WHITE);
  }

  async image(key: string) {
    this.requestedImages.push(key);
    return null;
  }
}

test('paginação da mão limita cinco cartas e conserva índices globais', () => {
  const view = handView(10);
  const first = handPage(view, 1);
  const second = handPage(view, 2);

  assert.deepEqual(first.entries.map((entry: { globalIndex: number }) => entry.globalIndex), [1, 2, 3, 4, 5]);
  assert.deepEqual(second.entries.map((entry: { globalIndex: number }) => entry.globalIndex), [6, 7, 8, 9, 10]);
  assert.equal(first.totalPages, 2);
  assert.equal(second.totalCards, 10);
  assert.throws(() => handPage(view, 3), /Página inválida/);
});

test('nome comprido é medido em pixels e recebe reticências dentro da placa', async () => {
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const fitted = String(fitTextToWidth(font, BASE_CARD.name.repeat(8), 140));

  assert.match(fitted, /\.\.\.$/);
  assert.ok(Jimp.measureText(font, fitted) <= 140);
});

test('feitiço usa chrome próprio sem solicitar moldura ou gemas de criatura', async () => {
  const assets = new MinimalAssets();
  const renderer = new VNextHandRenderer({ assets: assets as unknown as TavernAssetRegistry });
  const output = await renderer.render(handView(1, {
    type: 'SPELL',
    attack: undefined,
    health: undefined,
    keywords: ['ARCANE'],
  }));

  assert.equal(output.subarray(1, 4).toString(), 'PNG');
  assert.equal(assets.requestedImages.some(key => key.startsWith('frame.')), false);
});

test('página dois renderiza somente a fatia final e continua usando chrome de criatura', async () => {
  const assets = new MinimalAssets();
  const renderer = new VNextHandRenderer({ assets: assets as unknown as TavernAssetRegistry });
  const output = await renderer.render(handView(6), { page: 2 });
  const image = await Jimp.read(output);

  assert.equal(output.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([image.bitmap.width, image.bitmap.height], [720, 960]);
  assert.equal(assets.requestedImages.includes('card.GY-006'), true);
  assert.equal(assets.requestedImages.includes('card.GY-001'), false);
  assert.equal(assets.requestedImages.some(key => key.startsWith('frame.')), true);
});
