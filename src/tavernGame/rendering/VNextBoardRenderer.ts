// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
import Jimp from 'jimp';

import { AppError } from '../../envelope.ts';
import { TavernAssetRegistry } from './TavernAssetRegistry.ts';
import { COLORS, classVisual, rarityVisual } from './VNextVisualTheme.ts';
import { applyBoardVeil, createFallbackArt } from './VNextVisualPrimitives.ts';

const WIDTH = 1200;
// Mais alto que a mão de propósito — o board tem duas linhas de criatura
// (uma por jogador) espremidas entre duas barras de herói, então precisa
// de mais espaço vertical que 820 pra carta de campo ficar realmente
// legível, não só "menos ruim" que antes.
const HEIGHT = 940;

function shortText(value, max = 20) {
  const text = String(value || 'Aventureiro');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

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

  async render(state, { playerNames = {} } = {}) {
    if (!state?.players || !Array.isArray(state.playerOrder) || state.playerOrder.length !== 2) {
      throw AppError.badRequest('Estado inválido para renderizar a mesa');
    }

    const [bottomId, topId] = state.playerOrder;
    const [font16, font32] = await Promise.all([
      this.assets.font(16),
      this.assets.font(32)
    ]);
    const canvas = await this.createBackground();

    await this.drawHeroBar(canvas, state, topId, playerNames[topId], 24, font16, font32);
    await this.drawMinionLine(
      canvas,
      state.players[topId].board,
      state.players[topId].classId,
      154,
      font16,
      font32
    );

    await this.drawCenter(canvas, state, playerNames, font16, font32);

    await this.drawMinionLine(
      canvas,
      state.players[bottomId].board,
      state.players[bottomId].classId,
      544,
      font16,
      font32
    );
    await this.drawHeroBar(canvas, state, bottomId, playerNames[bottomId], 824, font16, font32);

    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }

  async drawHeroBar(canvas, state, playerId, displayName, y, font16, font32) {
    const player = state.players[playerId];
    const active = state.status === 'ACTIVE' && state.phase === 'MAIN' && state.turn.activePlayerId === playerId;
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

    canvas.print(font32, 132, y + 13, shortText(displayName, 24), 330, 34);
    canvas.print(font16, 132, y + 51, `${visual.archetype} · ${visual.label}`, 300, 20);
    if (active) canvas.print(font16, 392, y + 51, 'TURNO ATIVO', 150, 20);

    if (healthIcon) canvas.composite(healthIcon.contain(28, 28), 770, y + 16);
    canvas.print(font32, 806, y + 13, stat(player.hero.hp), 54, 34);

    if (armorIcon) canvas.composite(armorIcon.contain(25, 25), 874, y + 18);
    canvas.print(font32, 905, y + 13, stat(player.hero.armor), 52, 34);

    if (manaIcon) canvas.composite(manaIcon.contain(28, 28), 978, y + 16);
    canvas.print(font32, 1014, y + 13, `${stat(player.mana.current)}/${stat(player.mana.max)}`, 100, 34);
    canvas.print(font16, 995, y + 53, `mão ${player.hand.length}   deck ${player.deck.length}`, 150, 20);
  }

  async drawCenter(canvas, state, playerNames, font16, font32) {
    const activeName = shortText(playerNames[state.turn.activePlayerId] || state.turn.activePlayerId, 24);
    const deadline = deadlineText(state.turn.deadlineAt, this.now());
    const terrain = state.terrain?.card?.name || 'Sem terreno ativo';

    rect(canvas, 258, 434, 684, 70, 0x050408ee);
    rect(canvas, 262, 438, 676, 62, state.status === 'FINISHED' ? 0x59344fff : COLORS.oldGold);

    const headline = state.status === 'FINISHED'
      ? 'PARTIDA ENCERRADA'
      : state.phase === 'MULLIGAN'
        ? 'PREPARAÇÃO DA MESA'
        : `TURNO ${state.turn.number} · ${activeName}${deadline ? ` · ${deadline}` : ''}`;
    canvas.print(font32, 280, 444, {
      text: headline,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 640, 32);
    canvas.print(font16, 280, 476, {
      text: shortText(terrain, 52),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 640, 18);
  }

  // Gema circular de verdade (não retângulo com cantos arredondados
  // fingidos) — anel escuro externo, núcleo na cor do atributo, brilho
  // sutil no canto superior esquerdo pra dar volume em vez de cor chapada.
  // Mesma linguagem visual das gemas de mana/ataque/vida da moldura da
  // mão, só que desenhada em vez de recortada de um asset (o card de
  // campo é pequeno demais pra caber a moldura inteira).
  async drawStatBadge(canvas, font32, x, y, size, value, color) {
    const gem = new Jimp(size, size, 0x000000ff);
    rect(gem, 0, 0, size, size, 0x0c0a12ff);
    gem.circle();
    const ringWidth = Math.max(2, Math.round(size * 0.09));
    const core = new Jimp(size - ringWidth * 2, size - ringWidth * 2, color);
    core.circle();
    gem.composite(core, ringWidth, ringWidth);
    const highlight = new Jimp(Math.round(size * 0.42), Math.round(size * 0.3), 0xffffff33);
    highlight.circle();
    gem.composite(highlight, Math.round(size * 0.2), Math.round(size * 0.16));
    canvas.composite(gem, x, y);
    canvas.print(font32, x, y + Math.round(size * 0.15), {
      text: stat(value),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, size, size);
  }

  async drawMinionLine(canvas, cards, ownerClassId, y, font16, font32) {
    const cardWidth = 200;
    const cardHeight = 240;
    const gap = 18;

    if (!cards.length) {
      rect(canvas, 390, y + 118, 420, 2, 0xd5a44155);
      canvas.print(font16, 0, y + 104, {
        text: 'linha vazia',
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, WIDTH, 20);
      return;
    }

    const totalWidth = cards.length * cardWidth + Math.max(0, cards.length - 1) * gap;
    let x = Math.max(30, Math.floor((WIDTH - totalWidth) / 2));

    for (const [index, card] of cards.entries()) {
      const accent = cardAccent(card);
      const ready = card.canAttack && Number(card.attacksThisTurn) < 1;

      if (ready) {
        rect(canvas, x - 7, y - 7, cardWidth + 14, cardHeight + 14, 0xd5a44133);
      }
      rect(canvas, x - 3, y - 3, cardWidth + 6, cardHeight + 6, accent);
      rect(canvas, x, y, cardWidth, cardHeight, 0x07060aff);

      const artHeight = 140;
      const specific = await this.assets.image(`card.${card.cardId}`);
      const art = specific || await createFallbackArt(this.assets, card.classId || ownerClassId, cardWidth - 10, artHeight);
      const keywordIcon = card.keywords?.[0]
        ? await this.assets.image(`keyword.${card.keywords[0]}`)
        : null;

      if (art) canvas.composite(art.cover(cardWidth - 10, artHeight), x + 5, y + 33);
      else rect(canvas, x + 5, y + 33, cardWidth - 10, artHeight, 0x241d31ff);

      rect(canvas, x + 5, y + 5, cardWidth - 10, 24, 0x050408e8);
      canvas.print(font16, x + 8, y + 7, `${index + 1} · ${shortText(card.name, 16)}`, cardWidth - 16, 20);

      if (keywordIcon) canvas.composite(keywordIcon.contain(30, 30), x + 8, y + 37);

      const badgeSize = 52;
      await this.drawStatBadge(canvas, font32, x + 6, y + cardHeight - badgeSize - 6, badgeSize, card.attack, COLORS.gold);
      await this.drawStatBadge(canvas, font32, x + cardWidth - badgeSize - 6, y + cardHeight - badgeSize - 6, badgeSize, card.health, COLORS.health);

      if (card.keywords?.includes('GUARD')) {
        rect(canvas, x + 2, y + 2, 4, cardHeight - 4, COLORS.armor);
        rect(canvas, x + cardWidth - 6, y + 2, 4, cardHeight - 4, COLORS.armor);
      }

      x += cardWidth + gap;
    }
  }
}

export {
  HEIGHT as VNEXT_BOARD_HEIGHT,
  VNextBoardRenderer,
  WIDTH as VNEXT_BOARD_WIDTH,
  cardAccent,
  deadlineText
};
