// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
import Jimp from 'jimp';

import { AppError } from '../../envelope.ts';
import { TavernAssetRegistry } from './TavernAssetRegistry.ts';
import {
  calculateBoardLineLayout,
  truncateTextToPixelWidth,
} from './VNextLayoutV4.ts';
import { COLORS, classVisual, rarityVisual } from './VNextVisualTheme.ts';
import { applyBoardVeil, createFallbackArt } from './VNextVisualPrimitives.ts';

const WIDTH = 1200;
// Mais alto que a mão de propósito — o board tem duas linhas de criatura
// (uma por jogador) espremidas entre duas barras de herói, então precisa
// de mais espaço vertical que 820 pra carta de campo ficar realmente
// legível, não só "menos ruim" que antes.
const HEIGHT = 940;
const FULL_CARD_ART_IDS = new Set([
  'GY-001',
  'GY-014',
  'GY-027',
  'GY-042',
  'GY-061',
  'GY-088',
  'GY-103',
  'GY-148',
]);

function stat(value) {
  return String(Math.max(0, Number(value) || 0));
}

function deadlineText(deadlineAt, now) {
  if (!deadlineAt) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(deadlineAt) - Number(now)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  return `${Math.ceil(minutes / 60)}h`;
}

function rect(canvas, x, y, width, height, color) {
  canvas.composite(new Jimp(width, height, color), x, y);
}

function cardAccent(card) {
  if (card.canAttack && Number(card.attacksThisTurn) < 1) return COLORS.gold;
  if (card.keywords?.includes('GUARD')) return COLORS.armor;
  return rarityVisual(card.rarity).accent;
}

/** Recorta apenas a janela de arte dos oito assets históricos de carta completa. */
function prepareBoardArt(image, cardId) {
  if (!image) return null;

  const prepared = image.clone();
  if (!FULL_CARD_ART_IDS.has(String(cardId || ''))) return prepared;

  const { width, height } = prepared.bitmap;
  const legacyAspectRatio = 744 / 1039;
  if (Math.abs(width / height - legacyAspectRatio) > 0.01) return prepared;

  const x = Math.round(width * 0.101);
  const y = Math.round(height * 0.096);
  const cropWidth = Math.max(1, Math.round(width * 0.798));
  const cropHeight = Math.max(1, Math.round(height * 0.47));
  prepared.crop(
    x,
    y,
    Math.min(cropWidth, width - x),
    Math.min(cropHeight, height - y),
  );
  return prepared;
}

class VNextBoardRenderer {
  constructor({ assets = new TavernAssetRegistry(), now = () => Date.now() } = {}) {
    this.assets = assets;
    this.now = now;
  }

  async createBackground() {
    const legacy = await this.assets.image('background.board');
    const canvas = legacy ? legacy.cover(WIDTH, HEIGHT) : new Jimp(WIDTH, HEIGHT, COLORS.obsidian);
    return applyBoardVeil(canvas);
  }

  async render(view) {
    if (view?.schemaVersion !== 1 || view?.kind !== 'board' || !Array.isArray(view.players)) {
      throw AppError.badRequest('Visão inválida para renderizar a mesa');
    }

    const bottomPlayer = view.players.find(player => player.slot === 'bottom');
    const topPlayer = view.players.find(player => player.slot === 'top');
    if (!bottomPlayer || !topPlayer) {
      throw AppError.badRequest('Visão inválida para renderizar a mesa');
    }
    const [font16, font32] = await Promise.all([
      this.assets.font(16),
      this.assets.font(32)
    ]);
    const canvas = await this.createBackground();

    await this.drawHeroBar(canvas, view, topPlayer, 24, font16, font32);
    await this.drawMinionLine(
      canvas,
      topPlayer.board,
      topPlayer.classId,
      154,
      font16,
      font32
    );

    await this.drawCenter(canvas, view, font16, font32);

    await this.drawMinionLine(
      canvas,
      bottomPlayer.board,
      bottomPlayer.classId,
      544,
      font16,
      font32
    );
    await this.drawHeroBar(canvas, view, bottomPlayer, 824, font16, font32);

    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }

  async drawHeroBar(canvas, view, player, y, font16, font32) {
    const active = view.status === 'ACTIVE' && view.phase === 'MAIN' && view.turn.activeSlot === player.slot;
    const visual = classVisual(player.classId);
    const accent = active ? COLORS.gold : visual.accent;

    rect(canvas, 34, y, 1132, 90, 0x050408dd);
    rect(canvas, 38, y + 4, 1124, 82, accent);
    rect(canvas, 42, y + 7, 1116, 76, 0x07060af5);

    const [crest, healthIcon, armorIcon, manaIcon] = await Promise.all([
      this.assets.image(`class.${player.classId}`),
      this.assets.image('resource.health'),
      this.assets.image('resource.armor'),
      this.assets.image('resource.mana')
    ]);
    if (crest) canvas.composite(crest.contain(68, 68), 52, y + 10);

    const heroName = truncateTextToPixelWidth(
      player.displayName,
      330,
      text => Jimp.measureText(font32, text),
      'Aventureiro'
    );
    canvas.print(font32, 132, y + 13, heroName, 330, 34);
    canvas.print(font16, 132, y + 51, `${visual.archetype} · ${visual.label}`, 300, 20);
    if (active) canvas.print(font16, 392, y + 51, 'TURNO ATIVO', 150, 20);

    if (healthIcon) canvas.composite(healthIcon.contain(28, 28), 770, y + 16);
    canvas.print(font32, 806, y + 13, stat(player.hero.hp), 54, 34);

    if (armorIcon) canvas.composite(armorIcon.contain(25, 25), 874, y + 18);
    canvas.print(font32, 905, y + 13, stat(player.hero.armor), 52, 34);

    if (manaIcon) canvas.composite(manaIcon.contain(28, 28), 978, y + 16);
    canvas.print(font32, 1014, y + 13, `${stat(player.mana.current)}/${stat(player.mana.max)}`, 100, 34);
    canvas.print(font16, 995, y + 53, `mão ${player.handCount}   deck ${player.deckCount}`, 150, 20);
  }

  async drawCenter(canvas, view, font16, font32) {
    const activePlayer = view.players.find(player => player.slot === view.turn.activeSlot);
    const activeName = truncateTextToPixelWidth(
      activePlayer?.displayName,
      390,
      text => Jimp.measureText(font32, text),
      'Aventureiro'
    );
    const deadline = deadlineText(view.turn.deadlineAt, this.now());
    const terrain = view.terrain?.name || 'Sem terreno ativo';

    rect(canvas, 258, 434, 684, 70, 0x050408ee);
    rect(canvas, 262, 438, 676, 62, view.status === 'FINISHED' ? 0x59344fff : COLORS.oldGold);

    const headline = view.status === 'FINISHED'
      ? 'PARTIDA ENCERRADA'
      : view.phase === 'MULLIGAN'
        ? 'PREPARAÇÃO DA MESA'
        : `TURNO ${view.turn.number} · ${activeName}${deadline ? ` · ${deadline}` : ''}`;
    canvas.print(font32, 280, 444, {
      text: headline,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 640, 32);
    canvas.print(font16, 280, 476, {
      text: truncateTextToPixelWidth(
        terrain,
        620,
        text => Jimp.measureText(font16, text),
        'Sem terreno ativo'
      ),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 640, 18);
  }

  drawStatPlate(canvas, font16, font32, x, y, width, label, value, color) {
    const height = 54;
    rect(canvas, x, y, width, height, 0x050408f5);
    rect(canvas, x + 2, y + 2, width - 4, height - 4, 0x17131fff);
    rect(canvas, x + 2, y + 2, width - 4, 4, color);
    rect(canvas, x + 2, y + 6, 4, height - 8, color);
    canvas.print(font16, x + 8, y + 8, label, width - 16, 16);
    canvas.print(font32, x + 4, y + 18, {
      text: stat(value),
      alignmentX: Jimp.HORIZONTAL_ALIGN_RIGHT
    }, width - 10, 32);
  }

  async drawMinionLine(canvas, cards, ownerClassId, y, font16, font32) {
    if (!cards.length) {
      rect(canvas, 390, y + 118, 420, 2, 0xd5a44155);
      canvas.print(font16, 0, y + 104, {
        text: 'linha vazia',
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, WIDTH, 20);
      return;
    }

    const layout = calculateBoardLineLayout(cards.length, y, { canvasWidth: WIDTH });
    const artHeight = 140;
    const cardIds = [...new Set(cards.map(card => String(card.cardId || '')))];
    const keywordIds = [...new Set(cards.flatMap(card => card.keywords?.slice(0, 1) || []))];
    const [cardEntries, keywordEntries] = await Promise.all([
      Promise.all(cardIds.map(async cardId => [cardId, await this.assets.image(`card.${cardId}`)])),
      Promise.all(keywordIds.map(async keyword => [keyword, await this.assets.image(`keyword.${keyword}`)]))
    ]);
    const cardAssets = new Map(cardEntries);
    const keywordAssets = new Map(keywordEntries);
    const fallbackClasses = [...new Set(
      cards
        .filter(card => !cardAssets.get(String(card.cardId || '')))
        .map(card => card.classId || ownerClassId)
    )];
    const fallbackEntries = await Promise.all(fallbackClasses.map(async classId => [
      classId,
      await createFallbackArt(this.assets, classId, layout.cards[0].width - 10, artHeight)
    ]));
    const fallbackAssets = new Map(fallbackEntries);

    for (const [index, card] of cards.entries()) {
      const box = layout.cards[index];
      const { x, width: cardWidth, height: cardHeight } = box;
      const accent = cardAccent(card);
      const ready = card.canAttack && Number(card.attacksThisTurn) < 1;

      if (ready) {
        rect(canvas, x - 7, y - 7, cardWidth + 14, cardHeight + 14, 0xd5a44133);
      }
      rect(canvas, x - 3, y - 3, cardWidth + 6, cardHeight + 6, accent);
      rect(canvas, x, y, cardWidth, cardHeight, 0x07060aff);

      const specific = cardAssets.get(String(card.cardId || ''));
      const keywordIcon = card.keywords?.[0]
        ? keywordAssets.get(card.keywords[0])
        : null;
      const art = specific
        ? prepareBoardArt(specific, card.cardId)
        : fallbackAssets.get(card.classId || ownerClassId)?.clone();

      if (art) canvas.composite(art.cover(cardWidth - 10, artHeight), x + 5, y + 33);
      else rect(canvas, x + 5, y + 33, cardWidth - 10, artHeight, 0x241d31ff);

      rect(canvas, x + 5, y + 5, cardWidth - 10, 24, 0x050408e8);
      const indexWidth = cards.length >= 6 ? 20 : 24;
      rect(canvas, x + 7, y + 7, indexWidth, 20, accent);
      canvas.print(font16, x + 7, y + 8, {
        text: String(index + 1),
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, indexWidth, 18);
      const nameX = x + 11 + indexWidth;
      const nameWidth = cardWidth - indexWidth - 25;
      const displayName = truncateTextToPixelWidth(
        card.name,
        nameWidth,
        text => Jimp.measureText(font16, text),
        'Criatura'
      );
      canvas.print(font16, nameX, y + 8, displayName, nameWidth, 18);

      if (keywordIcon) canvas.composite(keywordIcon.clone().contain(30, 30), x + 8, y + 37);

      const plateGap = 6;
      const plateWidth = Math.floor((cardWidth - 18) / 2);
      const plateY = y + cardHeight - 60;
      this.drawStatPlate(canvas, font16, font32, x + 6, plateY, plateWidth, 'ATQ', card.attack, COLORS.gold);
      this.drawStatPlate(
        canvas,
        font16,
        font32,
        x + 6 + plateWidth + plateGap,
        plateY,
        plateWidth,
        'VIDA',
        card.health,
        COLORS.health
      );

      if (card.keywords?.includes('GUARD')) {
        rect(canvas, x + 2, y + 2, 4, cardHeight - 4, COLORS.armor);
        rect(canvas, x + cardWidth - 6, y + 2, 4, cardHeight - 4, COLORS.armor);
      }
    }
  }
}

export {
  HEIGHT as VNEXT_BOARD_HEIGHT,
  FULL_CARD_ART_IDS,
  VNextBoardRenderer,
  WIDTH as VNEXT_BOARD_WIDTH,
  cardAccent,
  deadlineText,
  prepareBoardArt
};
