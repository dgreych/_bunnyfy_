// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
import Jimp from 'jimp';

import { AppError } from '../../envelope.ts';
import { TavernAssetRegistry } from './TavernAssetRegistry.ts';
import { COLORS, KEYWORD_LABELS, rarityVisual } from './VNextVisualTheme.ts';
import { applyHandVeil, createFallbackArt } from './VNextVisualPrimitives.ts';

const WIDTH = 1200;
const HEIGHT = 820;

function cropText(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text;
}

function cardCost(player, card) {
  const base = Math.max(0, Number(card.cost) || 0);
  if (card.type !== 'SPELL') return base;
  return Math.max(0, base - Math.max(0, Number(player.nextSpellDiscount) || 0));
}

function cardIsPlayable(state, player, card) {
  if (state.status !== 'ACTIVE' || state.phase !== 'MAIN') return false;
  if (state.turn?.activePlayerId !== player.id) return false;
  if (cardCost(player, card) > player.mana.current) return false;
  if (card.type === 'MINION' && player.board.length >= 7) return false;
  return true;
}

function drawRect(canvas, x, y, width, height, color) {
  canvas.composite(new Jimp(width, height, color), x, y);
}

function drawCardShell(canvas, x, y, width, height, accent, playable) {
  if (playable) {
    drawRect(canvas, x - 7, y - 7, width + 14, height + 14, 0xd5a44133);
    drawRect(canvas, x - 4, y - 4, width + 8, height + 8, COLORS.gold);
  } else {
    drawRect(canvas, x - 3, y - 3, width + 6, height + 6, 0x00000088);
  }
  drawRect(canvas, x, y, width, height, accent);
  drawRect(canvas, x + 3, y + 3, width - 6, height - 6, 0x07060aff);
}

// Coordenadas medidas diretamente em frame_common_744x1039.png (moldura
// nativa 744x1039, janela de arte e gemas cortadas como buraco
// transparente). Escalonar por FRAME_NATIVE_WIDTH mantém tudo alinhado sem
// distorcer a moldura, ao contrário do resize() esticado que havia antes.
const FRAME_NATIVE_WIDTH = 744;
const FRAME_NATIVE_HEIGHT = 1039;
const FRAME_ART_WINDOW = { x: 80, y: 105, width: 584, height: 500 };
const FRAME_MANA_GEM = { cx: 80, cy: 75, radius: 55 };
const FRAME_ATTACK_GEM = { cx: 84, cy: 952, radius: 55 };
const FRAME_HEALTH_GEM = { cx: 660, cy: 952, radius: 55 };

function frameLayout(cardWidth) {
  const scale = cardWidth / FRAME_NATIVE_WIDTH;
  const scalePoint = point => ({ cx: Math.round(point.x * scale), cy: Math.round(point.y * scale) });
  return {
    scale,
    height: Math.round(FRAME_NATIVE_HEIGHT * scale),
    art: {
      x: Math.round(FRAME_ART_WINDOW.x * scale),
      y: Math.round(FRAME_ART_WINDOW.y * scale),
      width: Math.round(FRAME_ART_WINDOW.width * scale),
      height: Math.round(FRAME_ART_WINDOW.height * scale)
    },
    mana: { ...scalePoint({ x: FRAME_MANA_GEM.cx, y: FRAME_MANA_GEM.cy }), radius: Math.round(FRAME_MANA_GEM.radius * scale) },
    attack: { ...scalePoint({ x: FRAME_ATTACK_GEM.cx, y: FRAME_ATTACK_GEM.cy }), radius: Math.round(FRAME_ATTACK_GEM.radius * scale) },
    health: { ...scalePoint({ x: FRAME_HEALTH_GEM.cx, y: FRAME_HEALTH_GEM.cy }), radius: Math.round(FRAME_HEALTH_GEM.radius * scale) }
  };
}

function printGemNumber(canvas, font, gem, x, y, value) {
  const size = gem.radius * 2;
  canvas.print(font, x + gem.cx - gem.radius, y + gem.cy - size / 2 + 6, {
    text: String(value),
    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
  }, size, size);
}

class VNextHandRenderer {
  constructor({ assets = new TavernAssetRegistry() } = {}) {
    this.assets = assets;
  }

  async render(state, playerId) {
    const player = state?.players?.[playerId];
    if (!player) throw AppError.badRequest('Jogador não encontrado para renderizar a mão');

    const [font16, font32] = await Promise.all([
      this.assets.font(16),
      this.assets.font(32)
    ]);
    const legacyBackground = await this.assets.image('background.hand');
    const canvas = legacyBackground
      ? legacyBackground.cover(WIDTH, HEIGHT)
      : new Jimp(WIDTH, HEIGHT, COLORS.obsidian);
    applyHandVeil(canvas);

    const active = state.status === 'ACTIVE' && state.phase === 'MAIN' && state.turn?.activePlayerId === playerId;
    const heading = state.phase === 'MULLIGAN'
      ? 'ESCOLHA SUA ABERTURA'
      : active
        ? 'SUA VEZ · ESCOLHA UMA JOGADA'
        : 'SUA MÃO';
    canvas.print(font32, 48, 31, heading, 760, 40);

    const manaIcon = await this.assets.image('resource.mana');
    if (manaIcon) canvas.composite(manaIcon.contain(42, 42), 952, 31);
    canvas.print(font32, 1002, 35, `${player.mana.current}/${player.mana.max}`, 120, 38);

    const cards = player.hand;
    const columns = 5;
    const cardWidth = 210;
    const layout = frameLayout(cardWidth);
    const cardHeight = layout.height;
    const gapX = 20;
    const gapY = 24;
    const startY = 128;

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cardsInRow = Math.min(columns, cards.length - row * columns);
      const rowWidth = cardsInRow * cardWidth + Math.max(0, cardsInRow - 1) * gapX;
      const rowStartX = Math.floor((WIDTH - rowWidth) / 2);
      const x = rowStartX + column * (cardWidth + gapX);
      const y = startY + row * (cardHeight + gapY);
      const rarity = rarityVisual(card.rarity);
      const playable = cardIsPlayable(state, player, card);

      drawCardShell(canvas, x, y, cardWidth, cardHeight, rarity.accent, playable);

      const specificArt = await this.assets.image(`card.${card.cardId}`);
      const art = specificArt || await createFallbackArt(this.assets, card.classId || player.classId, layout.art.width, layout.art.height);

      const frame = await this.assets.image(`frame.${card.rarity || 'COMMON'}`);
      const keywordIcon = card.keywords?.[0]
        ? await this.assets.image(`keyword.${card.keywords[0]}`)
        : null;

      if (art) canvas.composite(art.cover(layout.art.width, layout.art.height), x + layout.art.x, y + layout.art.y);
      else drawRect(canvas, x + layout.art.x, y + layout.art.y, layout.art.width, layout.art.height, COLORS.coal);

      // Moldura na proporção nativa (744x1039), sem esticar e em opacidade
      // cheia — antes ficava borrada em 0.72 por cima de um retângulo
      // achatado que não batia com o recorte real da janela de arte.
      if (frame) canvas.composite(frame.resize(cardWidth, cardHeight), x, y);

      printGemNumber(canvas, font16, layout.mana, x, y, cardCost(player, card));
      if (card.type === 'MINION') {
        printGemNumber(canvas, font16, layout.attack, x, y, card.attack ?? 0);
        printGemNumber(canvas, font16, layout.health, x, y, card.health ?? 0);
      }

      const numberAccent = playable ? 0x6b4a16ff : 0x3f3436ff;
      drawRect(canvas, x + cardWidth - 34, y + 6, 28, 24, numberAccent);
      canvas.print(font16, x + cardWidth - 34, y + 8, {
        text: String(index + 1),
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, 28, 20);

      const nameBarY = layout.art.y + layout.art.height - 6;
      drawRect(canvas, x + layout.art.x, y + nameBarY, layout.art.width, 20, 0x050408f0);
      canvas.print(font16, x + layout.art.x, y + nameBarY + 1, {
        text: cropText(card.name, 24),
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, layout.art.width, 18);

      const keyword = card.keywords?.[0] ? KEYWORD_LABELS[card.keywords[0]] : null;
      let textY = nameBarY + 24;
      if (keyword) {
        if (keywordIcon) canvas.composite(keywordIcon.contain(18, 18), x + layout.art.x, y + textY);
        canvas.print(font16, x + layout.art.x + (keywordIcon ? 21 : 0), y + textY + 1, cropText(keyword, 16), layout.art.width - 21, 18);
        textY += 20;
      }
      if (card.text) {
        canvas.print(font16, x + layout.art.x, y + textY, cropText(card.text, keyword ? 38 : 52), layout.art.width, cardHeight - textY - 4);
      }
    }

    drawRect(canvas, 36, HEIGHT - 50, WIDTH - 72, 42, 0x050408e8);
    const footer = state.phase === 'MULLIGAN'
      ? 'Escolha pelo número · ou mantenha sua abertura'
      : active
        ? 'BORDA DOURADA = ação disponível agora · a mensagem privada diz exatamente como agir'
        : 'Sua mão é privada · aguarde a mesa indicar seu turno';
    canvas.print(font16, 48, HEIGHT - 39, {
      text: footer,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH - 96, 22);

    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }
}

export {
  HEIGHT as VNEXT_HAND_HEIGHT,
  VNextHandRenderer,
  WIDTH as VNEXT_HAND_WIDTH,
  cardCost,
  cardIsPlayable
};
