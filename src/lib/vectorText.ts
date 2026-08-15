export type VectorTextCap = 'round' | 'square' | 'butt';
export type VectorTextJoin = 'round' | 'bevel' | 'miter';

type Point = readonly [number, number];
type Stroke = readonly Point[];

interface GlyphDefinition {
  readonly advance: number;
  readonly strokes: readonly Stroke[];
}

export interface VectorTextOptions {
  readonly x: number;
  readonly y: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly tracking?: number;
  readonly weight?: number;
  readonly slant?: number;
  readonly align?: 'left' | 'center' | 'right';
}

export interface VectorTextShape {
  readonly d: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly strokeWidth: number;
  readonly scale: number;
  readonly source: string;
  readonly glyphs: number;
}

const EM_HEIGHT = 140;
const DEFAULT_ADVANCE = 106;
const SPACE_ADVANCE = 54;

const s = (...points: Point[]): Stroke => points;
const g = (strokes: readonly Stroke[], advance = DEFAULT_ADVANCE): GlyphDefinition => ({ strokes, advance });

const GLYPHS: Readonly<Record<string, GlyphDefinition>> = Object.freeze({
  A: g([s([10, 140], [50, 0], [90, 140]), s([27, 82], [73, 82])]),
  B: g([s([12, 0], [12, 140]), s([12, 0], [60, 0], [86, 18], [86, 48], [62, 70], [12, 70]), s([12, 70], [64, 70], [90, 90], [90, 120], [64, 140], [12, 140])]),
  C: g([s([90, 18], [70, 0], [30, 0], [10, 22], [10, 118], [30, 140], [70, 140], [90, 122])]),
  D: g([s([12, 0], [12, 140]), s([12, 0], [58, 0], [88, 26], [88, 114], [58, 140], [12, 140])]),
  E: g([s([88, 0], [12, 0], [12, 140], [88, 140]), s([12, 70], [72, 70])]),
  F: g([s([12, 140], [12, 0], [90, 0]), s([12, 70], [72, 70])]),
  G: g([s([90, 20], [70, 0], [30, 0], [10, 22], [10, 118], [30, 140], [72, 140], [90, 122], [90, 82], [58, 82])]),
  H: g([s([12, 0], [12, 140]), s([88, 0], [88, 140]), s([12, 70], [88, 70])]),
  I: g([s([18, 0], [82, 0]), s([50, 0], [50, 140]), s([18, 140], [82, 140])], 92),
  J: g([s([16, 0], [88, 0], [88, 112], [72, 140], [34, 140], [12, 118])]),
  K: g([s([12, 0], [12, 140]), s([90, 0], [12, 82]), s([48, 46], [92, 140])]),
  L: g([s([12, 0], [12, 140], [90, 140])]),
  M: g([s([8, 140], [8, 0], [50, 72], [92, 0], [92, 140])], 116),
  N: g([s([10, 140], [10, 0], [90, 140], [90, 0])], 112),
  O: g([s([30, 0], [70, 0], [92, 24], [92, 116], [70, 140], [30, 140], [8, 116], [8, 24], [30, 0])], 112),
  P: g([s([12, 140], [12, 0], [62, 0], [90, 20], [90, 52], [62, 72], [12, 72])]),
  Q: g([s([30, 0], [70, 0], [92, 24], [92, 116], [70, 140], [30, 140], [8, 116], [8, 24], [30, 0]), s([58, 104], [96, 150])], 116),
  R: g([s([12, 140], [12, 0], [62, 0], [90, 20], [90, 52], [62, 72], [12, 72]), s([54, 72], [94, 140])]),
  S: g([s([90, 18], [70, 0], [30, 0], [10, 22], [10, 56], [28, 70], [72, 70], [90, 84], [90, 118], [70, 140], [28, 140], [8, 122])]),
  T: g([s([8, 0], [92, 0]), s([50, 0], [50, 140])]),
  U: g([s([10, 0], [10, 110], [28, 140], [72, 140], [90, 110], [90, 0])], 112),
  V: g([s([8, 0], [50, 140], [92, 0])]),
  W: g([s([6, 0], [24, 140], [50, 78], [76, 140], [96, 0])], 122),
  X: g([s([8, 0], [92, 140]), s([92, 0], [8, 140])]),
  Y: g([s([8, 0], [50, 72], [92, 0]), s([50, 72], [50, 140])]),
  Z: g([s([8, 0], [92, 0], [8, 140], [92, 140])]),
  '0': g([s([30, 0], [70, 0], [90, 24], [90, 116], [70, 140], [30, 140], [10, 116], [10, 24], [30, 0]), s([24, 118], [76, 22])]),
  '1': g([s([28, 28], [50, 0], [50, 140]), s([24, 140], [78, 140])], 88),
  '2': g([s([12, 28], [30, 0], [70, 0], [90, 24], [90, 48], [12, 140], [92, 140])]),
  '3': g([s([12, 14], [32, 0], [72, 0], [90, 20], [90, 50], [68, 70], [90, 88], [90, 120], [70, 140], [30, 140], [10, 126]), s([36, 70], [68, 70])]),
  '4': g([s([76, 140], [76, 0], [10, 92], [94, 92])]),
  '5': g([s([90, 0], [16, 0], [12, 68], [68, 68], [90, 88], [90, 118], [70, 140], [28, 140], [8, 124])]),
  '6': g([s([86, 16], [68, 0], [30, 0], [10, 28], [10, 112], [30, 140], [70, 140], [90, 118], [90, 88], [70, 68], [12, 68])]),
  '7': g([s([8, 0], [94, 0], [40, 140])]),
  '8': g([s([30, 0], [70, 0], [90, 20], [90, 50], [70, 70], [30, 70], [10, 50], [10, 20], [30, 0]), s([30, 70], [70, 70], [92, 90], [92, 120], [70, 140], [30, 140], [8, 120], [8, 90], [30, 70])]),
  '9': g([s([90, 72], [30, 72], [10, 52], [10, 22], [30, 0], [70, 0], [90, 28], [90, 112], [70, 140], [30, 140], [12, 124])]),
  '-': g([s([18, 72], [82, 72])], 88),
  '_': g([s([10, 140], [90, 140])], 100),
  '.': g([s([50, 136], [50, 140])], 54),
  ',': g([s([54, 132], [46, 154])], 54),
  ':': g([s([50, 44], [50, 48]), s([50, 120], [50, 124])], 54),
  '!': g([s([50, 0], [50, 98]), s([50, 132], [50, 140])], 54),
  '?': g([s([14, 28], [28, 4], [68, 4], [88, 26], [88, 48], [52, 78], [52, 98]), s([52, 132], [52, 140])], 96),
  '/': g([s([12, 140], [90, 0])], 94),
  '+': g([s([14, 72], [86, 72]), s([50, 36], [50, 108])], 90),
  '&': g([s([82, 116], [64, 140], [30, 140], [10, 118], [10, 92], [78, 22], [66, 0], [36, 0], [18, 18], [18, 46], [88, 140])], 108),
  '#': g([s([34, 12], [24, 132]), s([74, 12], [64, 132]), s([12, 48], [92, 48]), s([8, 94], [88, 94])], 104),
});

const UNKNOWN_GLYPH = g([
  s([12, 12], [88, 12], [88, 128], [12, 128], [12, 12]),
  s([24, 28], [76, 112]),
  s([76, 28], [24, 112]),
]);

const ACCENT_STROKES: Readonly<Record<string, readonly Stroke[]>> = Object.freeze({
  '\u0301': [s([42, -12], [66, -34])],
  '\u0300': [s([58, -12], [34, -34])],
  '\u0302': [s([28, -14], [50, -34], [72, -14])],
  '\u0303': [s([24, -20], [36, -30], [50, -18], [64, -30], [78, -20])],
  '\u0308': [s([34, -24], [34, -20]), s([66, -24], [66, -20])],
  '\u0327': [s([52, 142], [44, 160], [58, 166])],
});

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} precisa ser finito.`);
  return value;
}

function normalizeInput(text: string): string {
  const normalized = String(text ?? '').normalize('NFC').trim();
  if (!normalized) throw new TypeError('Texto vetorial vazio.');
  return normalized;
}

interface LogicalGlyph {
  readonly base: string;
  readonly marks: readonly string[];
  readonly source: string;
}

function splitLogicalGlyphs(text: string): LogicalGlyph[] {
  const glyphs: LogicalGlyph[] = [];
  for (const character of [...text]) {
    if (character === ' ') {
      glyphs.push({ base: ' ', marks: [], source: character });
      continue;
    }
    const decomposed = character.normalize('NFD');
    const parts = [...decomposed];
    const base = (parts.shift() ?? character).toLocaleUpperCase('pt-BR');
    const marks = parts.filter((part) => Object.hasOwn(ACCENT_STROKES, part));
    glyphs.push({ base, marks, source: character });
  }
  return glyphs;
}

function resolveGlyph(base: string): GlyphDefinition {
  if (base === ' ') return { advance: SPACE_ADVANCE, strokes: [] };
  return GLYPHS[base] ?? UNKNOWN_GLYPH;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function transformedPath(
  stroke: Stroke,
  cursor: number,
  scale: number,
  originX: number,
  originY: number,
  slant: number,
): string {
  return stroke.map(([px, py], index) => {
    const skewedX = px + (EM_HEIGHT - py) * slant;
    const x = originX + (cursor + skewedX) * scale;
    const y = originY + py * scale;
    return `${index === 0 ? 'M' : 'L'}${formatNumber(x)} ${formatNumber(y)}`;
  }).join('');
}

export function buildVectorTextPath(text: string, options: VectorTextOptions): VectorTextShape {
  const source = normalizeInput(text);
  const glyphs = splitLogicalGlyphs(source);
  const maxWidth = Math.max(1, finite(options.maxWidth, 'maxWidth'));
  const maxHeight = Math.max(1, finite(options.maxHeight, 'maxHeight'));
  const tracking = Math.max(0, Number(options.tracking ?? 8));
  const weight = Math.max(1, Number(options.weight ?? 12));
  const slant = Math.max(-0.45, Math.min(0.45, Number(options.slant ?? 0)));
  const align = options.align ?? 'center';

  const advances = glyphs.map((logical) => resolveGlyph(logical.base).advance);
  const unitsWidth = advances.reduce((total, value) => total + value, 0) + Math.max(0, glyphs.length - 1) * tracking;
  const hasTopAccent = glyphs.some((logical) => logical.marks.some((mark) => mark !== '\u0327'));
  const hasCedilla = glyphs.some((logical) => logical.marks.includes('\u0327'));
  const minY = hasTopAccent ? -38 : 0;
  const maxY = hasCedilla ? 168 : 140;
  const unitsHeight = maxY - minY;
  const slantOverflow = Math.abs(slant) * EM_HEIGHT;
  const scale = Math.min(maxWidth / Math.max(1, unitsWidth + slantOverflow), maxHeight / unitsHeight);
  const renderedWidth = (unitsWidth + slantOverflow) * scale;
  const renderedHeight = unitsHeight * scale;

  const x = finite(options.x, 'x');
  const y = finite(options.y, 'y');
  const left = align === 'left' ? x : align === 'right' ? x - renderedWidth : x - renderedWidth / 2;
  const top = y - renderedHeight / 2;
  const originX = left + (slant < 0 ? -slant * EM_HEIGHT * scale : 0);
  const originY = top - minY * scale;

  const chunks: string[] = [];
  let cursor = 0;
  for (let index = 0; index < glyphs.length; index += 1) {
    const logical = glyphs[index];
    if (logical === undefined) throw new TypeError('Glifo vetorial inválido.');
    const definition = resolveGlyph(logical.base);
    for (const stroke of definition.strokes) {
      chunks.push(transformedPath(stroke, cursor, scale, originX, originY, slant));
    }
    for (const mark of logical.marks) {
      for (const stroke of ACCENT_STROKES[mark] ?? []) {
        chunks.push(transformedPath(stroke, cursor, scale, originX, originY, slant));
      }
    }
    cursor += definition.advance;
    if (index < glyphs.length - 1) cursor += tracking;
  }

  return {
    d: chunks.join(''),
    x: left,
    y: top,
    width: renderedWidth,
    height: renderedHeight,
    strokeWidth: Math.max(1, weight * scale),
    scale,
    source,
    glyphs: glyphs.length,
  };
}

export function vectorTextPathElement(
  shape: VectorTextShape,
  {
    stroke = 'currentColor',
    strokeWidth = shape.strokeWidth,
    fill = 'none',
    opacity = 1,
    linecap = 'round',
    linejoin = 'round',
    extra = '',
  }: {
    readonly stroke?: string;
    readonly strokeWidth?: number;
    readonly fill?: string;
    readonly opacity?: number;
    readonly linecap?: VectorTextCap;
    readonly linejoin?: VectorTextJoin;
    readonly extra?: string;
  } = {},
): string {
  return `<path d="${shape.d}" fill="${fill}" stroke="${stroke}" stroke-width="${formatNumber(strokeWidth)}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}" opacity="${formatNumber(opacity)}" vector-effect="non-scaling-stroke"${extra ? ` ${extra}` : ''}/>`;
}

export function vectorTextMask(
  id: string,
  shape: VectorTextShape,
  {
    strokeWidth = shape.strokeWidth,
    linecap = 'round',
    linejoin = 'round',
  }: {
    readonly strokeWidth?: number;
    readonly linecap?: VectorTextCap;
    readonly linejoin?: VectorTextJoin;
  } = {},
): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw new TypeError('ID de máscara vetorial inválido.');
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="960" height="540"><rect width="960" height="540" fill="#000"/><path d="${shape.d}" fill="none" stroke="#fff" stroke-width="${formatNumber(strokeWidth)}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"/></mask>`;
}
