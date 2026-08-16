const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_SAFE_MARGIN = 44;
const DEFAULT_CARD_HEIGHT = 240;
const DEFAULT_MAX_CARD_WIDTH = 200;
const DEFAULT_MIN_CARD_WIDTH = 146;
const MAX_BOARD_CARDS = 7;

type BoardLineLayoutOptions = Readonly<{
  canvasWidth?: number;
  safeMargin?: number;
  cardHeight?: number;
  maxCardWidth?: number;
  minCardWidth?: number;
}>;

type BoardCardBox = Readonly<{
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

type BoardLineLayout = Readonly<{
  canvasWidth: number;
  safeMargin: number;
  gap: number;
  totalWidth: number;
  cards: readonly BoardCardBox[];
}>;

function gapForCardCount(cardCount: number): number {
  if (cardCount <= 5) return 18;
  if (cardCount === 6) return 14;
  return 10;
}

/**
 * Calcula uma linha centralizada e inteiramente contida na zona segura.
 * A função não conhece estado, assets nem Jimp e pode ser exercitada sem I/O.
 */
function calculateBoardLineLayout(
  cardCount: number,
  y: number,
  options: BoardLineLayoutOptions = {},
): BoardLineLayout {
  if (!Number.isInteger(cardCount) || cardCount < 0 || cardCount > MAX_BOARD_CARDS) {
    throw new RangeError(`cardCount deve estar entre 0 e ${MAX_BOARD_CARDS}`);
  }

  const canvasWidth = options.canvasWidth ?? DEFAULT_CANVAS_WIDTH;
  const safeMargin = options.safeMargin ?? DEFAULT_SAFE_MARGIN;
  const cardHeight = options.cardHeight ?? DEFAULT_CARD_HEIGHT;
  const maxCardWidth = options.maxCardWidth ?? DEFAULT_MAX_CARD_WIDTH;
  const minCardWidth = options.minCardWidth ?? DEFAULT_MIN_CARD_WIDTH;

  for (const [name, value] of Object.entries({
    canvasWidth,
    safeMargin,
    cardHeight,
    maxCardWidth,
    minCardWidth,
  })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${name} deve ser um inteiro positivo`);
    }
  }
  if (!Number.isInteger(y) || y < 0) {
    throw new RangeError('y deve ser um inteiro não negativo');
  }
  if (safeMargin * 2 >= canvasWidth || minCardWidth > maxCardWidth) {
    throw new RangeError('dimensões incompatíveis para a linha de cartas');
  }

  if (cardCount === 0) {
    return {
      canvasWidth,
      safeMargin,
      gap: 0,
      totalWidth: 0,
      cards: [],
    };
  }

  const gap = gapForCardCount(cardCount);
  const availableWidth = canvasWidth - safeMargin * 2;
  const fittedCardWidth = Math.floor(
    (availableWidth - gap * Math.max(0, cardCount - 1)) / cardCount,
  );
  const cardWidth = Math.min(maxCardWidth, fittedCardWidth);
  if (cardWidth < minCardWidth) {
    throw new RangeError('largura insuficiente para preservar a legibilidade das cartas');
  }

  const totalWidth = cardCount * cardWidth + Math.max(0, cardCount - 1) * gap;
  const startX = Math.floor((canvasWidth - totalWidth) / 2);
  const cards = Array.from({ length: cardCount }, (_, index) => ({
    index,
    x: startX + index * (cardWidth + gap),
    y,
    width: cardWidth,
    height: cardHeight,
  }));

  return {
    canvasWidth,
    safeMargin,
    gap,
    totalWidth,
    cards,
  };
}

type TextWidthMeasurer = (text: string) => number;

/**
 * Trunca por largura raster medida pela fonte de destino. O corte usa pontos
 * de código, evitando partir pares substitutos no meio.
 */
function truncateTextToPixelWidth(
  value: unknown,
  maxWidth: number,
  measure: TextWidthMeasurer,
  fallback = '',
): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return '';

  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ') || fallback;
  if (!normalized || measure(normalized) <= maxWidth) return normalized;

  const ellipsis = '...';
  if (measure(ellipsis) > maxWidth) return '';

  const points = Array.from(normalized);
  let low = 0;
  let high = points.length;
  let best = '';

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${points.slice(0, middle).join('').trimEnd()}${ellipsis}`;
    if (measure(candidate) <= maxWidth) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best || ellipsis;
}

export {
  DEFAULT_CARD_HEIGHT as VNEXT_V4_CARD_HEIGHT,
  DEFAULT_SAFE_MARGIN as VNEXT_V4_SAFE_MARGIN,
  MAX_BOARD_CARDS as VNEXT_V4_MAX_BOARD_CARDS,
  calculateBoardLineLayout,
  truncateTextToPixelWidth,
};

export type { BoardCardBox, BoardLineLayout, BoardLineLayoutOptions, TextWidthMeasurer };
