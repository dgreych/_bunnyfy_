// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
import Jimp from 'jimp';

import { AppError } from '../../envelope.ts';
import { TavernAssetRegistry } from './TavernAssetRegistry.ts';
import { COLORS, KEYWORD_LABELS, rarityVisual } from './VNextVisualTheme.ts';
import { applyHandVeil, createFallbackArt } from './VNextVisualPrimitives.ts';

const WIDTH = 720;
const HEIGHT = 960;
const HAND_PAGE_SIZE = 5;

function cropText(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text;
}

function fitTextToWidth(font, value, maxWidth) {
  const text = String(value || '').trim();
  if (!text || Jimp.measureText(font, text) <= maxWidth) return text;

  const ellipsis = '...';
  const ellipsisWidth = Jimp.measureText(font, ellipsis);
  const characters = Array.from(text);
  while (characters.length > 1) {
    characters.pop();
    const candidate = `${characters.join('').trimEnd()}${ellipsis}`;
    if (Jimp.measureText(font, candidate) <= Math.max(ellipsisWidth, maxWidth)) return candidate;
  }
  return ellipsis;
}

function handPage(view, requestedPage = 1) {
  const totalCards = view.cards.length;
  const totalPages = Math.max(1, Math.ceil(totalCards / HAND_PAGE_SIZE));
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > totalPages) {
    throw AppError.badRequest('Página inválida para renderizar a mão');
  }
  const offset = (requestedPage - 1) * HAND_PAGE_SIZE;
  return {
    page: requestedPage,
    totalPages,
    totalCards,
    entries: view.cards.slice(offset, offset + HAND_PAGE_SIZE).map((card, localIndex) => ({
      card,
      globalIndex: offset + localIndex + 1
    }))
  };
}

function cardCost(player, card) {
  const base = Math.max(0, Number(card.cost) || 0);
  if (card.type !== 'SPELL') return base;
  return Math.max(0, base - Math.max(0, Number(player.nextSpellDiscount) || 0));
}

function cardIsPlayable(view, card) {
  if (view.status !== 'ACTIVE' || view.phase !== 'MAIN' || !view.isActive) return false;
  if (cardCost(view.viewer, card) > view.viewer.mana.current) return false;
  if (card.type === 'MINION' && view.viewer.boardCount >= 7) return false;
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

function drawNonMinionHeader(canvas, font, card, x, y, cardWidth, playable, cost) {
  const typeLabels = {
    SPELL: 'FEITIÇO',
    ARTIFACT: 'ARTEFATO',
    TERRAIN: 'TERRENO'
  };
  const costColor = playable ? COLORS.mana : 0x31405fff;
  drawRect(canvas, x + 8, y + 8, 42, 28, costColor);
  canvas.print(font, x + 8, y + 12, {
    text: String(cost),
    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
  }, 42, 20);

  drawRect(canvas, x + 58, y + 8, cardWidth - 116, 28, 0x120f19f2);
  canvas.print(font, x + 58, y + 12, {
    text: typeLabels[card.type] || card.type,
    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
  }, cardWidth - 116, 20);
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

  async render(view, { page: requestedPage = 1 } = {}) {
    if (view?.schemaVersion !== 1 || view?.kind !== 'hand' || !view.viewer || !Array.isArray(view.cards)) {
      throw AppError.badRequest('Visão inválida para renderizar a mão');
    }
    const player = view.viewer;
    const pagination = handPage(view, requestedPage);

    const [font16, font32, legacyBackground, manaIcon] = await Promise.all([
      this.assets.font(16),
      this.assets.font(32),
      this.assets.image('background.hand'),
      this.assets.image('resource.mana')
    ]);
    const canvas = legacyBackground
      ? legacyBackground.cover(WIDTH, HEIGHT)
      : new Jimp(WIDTH, HEIGHT, COLORS.obsidian);
    applyHandVeil(canvas);

    const active = view.status === 'ACTIVE' && view.phase === 'MAIN' && view.isActive;
    const heading = view.phase === 'MULLIGAN'
      ? 'ESCOLHA SUA ABERTURA'
      : active
        ? 'SUA VEZ · JOGUE UMA CARTA'
        : 'SUA MÃO';
    canvas.print(font32, 28, 27, heading, 500, 40);
    const pagePrefix = `PÁGINA ${pagination.page}`;
    const pagePrefixWidth = Jimp.measureText(font16, pagePrefix);
    canvas.print(font16, 430, 76, pagePrefix, pagePrefixWidth, 20);
    canvas.print(font16, 430 + pagePrefixWidth, 76, `/${pagination.totalPages}`, 32, 20);

    if (manaIcon) canvas.composite(manaIcon.clone().contain(42, 42), 566, 28);
    canvas.print(font32, 614, 32, `${player.mana.current}/${player.mana.max}`, 90, 38);

    const entries = pagination.entries;
    const columns = 3;
    const cardWidth = 210;
    const layout = frameLayout(cardWidth);
    const cardHeight = layout.height;
    const gapX = 14;
    const gapY = 20;
    const startY = 118;

    const assetKeys = new Set();
    for (const { card } of entries) {
      assetKeys.add(`card.${card.cardId}`);
      if (card.type === 'MINION') assetKeys.add(`frame.${card.rarity || 'COMMON'}`);
      if (card.keywords?.[0]) assetKeys.add(`keyword.${card.keywords[0]}`);
    }
    const loadedAssets = new Map(await Promise.all(
      [...assetKeys].map(async key => [key, await this.assets.image(key)])
    ));
    const pageAssets = await Promise.all(entries.map(async ({ card }) => ({
      art: loadedAssets.get(`card.${card.cardId}`)
        || await createFallbackArt(this.assets, card.classId || player.classId, layout.art.width, layout.art.height),
      frame: card.type === 'MINION'
        ? loadedAssets.get(`frame.${card.rarity || 'COMMON'}`)
        : null,
      keywordIcon: card.keywords?.[0]
        ? loadedAssets.get(`keyword.${card.keywords[0]}`)
        : null
    })));

    for (let index = 0; index < entries.length; index += 1) {
      const { card, globalIndex } = entries[index];
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cardsInRow = Math.min(columns, entries.length - row * columns);
      const rowWidth = cardsInRow * cardWidth + Math.max(0, cardsInRow - 1) * gapX;
      const rowStartX = Math.floor((WIDTH - rowWidth) / 2);
      const x = rowStartX + column * (cardWidth + gapX);
      const y = startY + row * (cardHeight + gapY);
      const rarity = rarityVisual(card.rarity);
      const playable = cardIsPlayable(view, card);
      const { art, frame, keywordIcon } = pageAssets[index];

      drawCardShell(canvas, x, y, cardWidth, cardHeight, rarity.accent, playable);

      if (art) canvas.composite(art.clone().cover(layout.art.width, layout.art.height), x + layout.art.x, y + layout.art.y);
      else drawRect(canvas, x + layout.art.x, y + layout.art.y, layout.art.width, layout.art.height, COLORS.coal);

      // Moldura na proporção nativa (744x1039), sem esticar e em opacidade
      // cheia — antes ficava borrada em 0.72 por cima de um retângulo
      // achatado que não batia com o recorte real da janela de arte.
      if (frame) canvas.composite(frame.clone().resize(cardWidth, cardHeight), x, y);

      if (card.type === 'MINION') {
        printGemNumber(canvas, font16, layout.mana, x, y, cardCost(player, card));
        printGemNumber(canvas, font16, layout.attack, x, y, card.attack ?? 0);
        printGemNumber(canvas, font16, layout.health, x, y, card.health ?? 0);
      } else {
        // Feitiços e permanentes não usam a moldura de criatura. Assim o
        // custo continua explícito, mas não sobram gemas vazias de ataque e
        // vida; a placa textual também deixa o tipo inequívoco sem depender
        // somente de cor.
        drawNonMinionHeader(canvas, font16, card, x, y, cardWidth, playable, cardCost(player, card));
      }

      const numberAccent = playable ? 0x6b4a16ff : 0x3f3436ff;
      drawRect(canvas, x + cardWidth - 34, y + 6, 28, 24, numberAccent);
      canvas.print(font16, x + cardWidth - 34, y + 8, {
        text: String(globalIndex),
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, 28, 20);

      const nameBarY = layout.art.y + layout.art.height - 6;
      drawRect(canvas, x + layout.art.x, y + nameBarY, layout.art.width, 20, 0x050408f0);
      canvas.print(font16, x + layout.art.x, y + nameBarY + 1, {
        text: fitTextToWidth(font16, card.name, layout.art.width - 8),
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, layout.art.width, 18);

      const keyword = card.keywords?.[0] ? KEYWORD_LABELS[card.keywords[0]] : null;
      let textY = nameBarY + 24;
      if (keyword) {
        if (keywordIcon) canvas.composite(keywordIcon.clone().contain(18, 18), x + layout.art.x, y + textY);
        canvas.print(font16, x + layout.art.x + (keywordIcon ? 21 : 0), y + textY + 1, cropText(keyword, 16), layout.art.width - 21, 18);
        textY += 20;
      }
      if (card.text) {
        canvas.print(font16, x + layout.art.x, y + textY, cropText(card.text, keyword ? 38 : 52), layout.art.width, cardHeight - textY - 4);
      }
    }

    drawRect(canvas, 20, HEIGHT - 50, WIDTH - 40, 42, 0x050408e8);
    const footer = view.phase === 'MULLIGAN'
      ? `Página ${pagination.page} de ${pagination.totalPages} · escolha pelo número global ou mantenha sua abertura`
      : active
        ? `Página ${pagination.page} de ${pagination.totalPages} · BORDA DOURADA = ação disponível agora`
        : `Página ${pagination.page} de ${pagination.totalPages} · sua mão é privada · aguarde seu turno`;
    canvas.print(font16, 28, HEIGHT - 39, {
      text: footer,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH - 56, 22);

    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }
}

export {
  HEIGHT as VNEXT_HAND_HEIGHT,
  HAND_PAGE_SIZE,
  VNextHandRenderer,
  WIDTH as VNEXT_HAND_WIDTH,
  cardCost,
  cardIsPlayable,
  fitTextToWidth,
  handPage
};
