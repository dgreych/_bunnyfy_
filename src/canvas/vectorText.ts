import { normalizeCanvasText } from './text.ts';

interface VectorTextOptions {
  x: number;
  y: number;
  maxWidth: number;
  height: number;
  color?: string;
  anchor?: 'start' | 'middle' | 'end';
  opacity?: number;
  strokeRatio?: number;
  tracking?: number;
  shadow?: boolean;
}

interface GlyphToken {
  base: string;
  marks: string[];
}

/**
 * Fonte vetorial monoline própria do Social Canvas.
 *
 * Deliberadamente não usa <text>, Pango, fontconfig nem arquivos de fonte.
 * Cada glifo é geometria SVG em uma grade lógica 4x6; assim nomes reais
 * continuam aparecendo mesmo em imagens Alpine mínimas sem fonts instaladas.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  A: 'M0 6L2 0L4 6M.75 4H3.25',
  B: 'M0 0V6M0 0H2.35Q4 0 4 1.5Q4 3 2.35 3H0M2.35 3Q4 3 4 4.5Q4 6 2.35 6H0',
  C: 'M4 .7Q3.25 0 2 0Q0 0 0 3Q0 6 2 6Q3.25 6 4 5.3',
  D: 'M0 0V6M0 0H1.9Q4 0 4 3Q4 6 1.9 6H0',
  E: 'M4 0H0V6H4M0 3H3.25',
  F: 'M0 6V0H4M0 3H3.25',
  G: 'M4 .7Q3.25 0 2 0Q0 0 0 3Q0 6 2 6Q3.25 6 4 5.3V3.4H2.4',
  H: 'M0 0V6M4 0V6M0 3H4',
  I: 'M.8 0H3.2M2 0V6M.8 6H3.2',
  J: 'M4 0V4Q4 6 2 6Q0 6 0 4.65',
  K: 'M0 0V6M4 0L0 3L4 6',
  L: 'M0 0V6H4',
  M: 'M0 6V0L2 3L4 0V6',
  N: 'M0 6V0L4 6V0',
  O: 'M2 0Q0 0 0 2V4Q0 6 2 6Q4 6 4 4V2Q4 0 2 0Z',
  P: 'M0 6V0H2.3Q4 0 4 1.5Q4 3 2.3 3H0',
  Q: 'M2 0Q0 0 0 2V4Q0 6 2 6Q4 6 4 4V2Q4 0 2 0ZM2.45 4.35L4.4 6.3',
  R: 'M0 6V0H2.3Q4 0 4 1.5Q4 3 2.3 3H0M2.05 3L4 6',
  S: 'M4 .7Q3.25 0 2 0Q0 0 0 1.5Q0 3 2 3Q4 3 4 4.5Q4 6 2 6Q.75 6 0 5.3',
  T: 'M0 0H4M2 0V6',
  U: 'M0 0V4Q0 6 2 6Q4 6 4 4V0',
  V: 'M0 0L2 6L4 0',
  W: 'M0 0L1 6L2 3L3 6L4 0',
  X: 'M0 0L4 6M4 0L0 6',
  Y: 'M0 0L2 3L4 0M2 3V6',
  Z: 'M0 0H4L0 6H4',
  '0': 'M2 0Q0 0 0 2V4Q0 6 2 6Q4 6 4 4V2Q4 0 2 0ZM.7 5L3.3 1',
  '1': 'M1 1L2 0V6M.8 6H3.2',
  '2': 'M0 .9Q.7 0 2 0Q4 0 4 1.55Q4 2.45 3.15 3.25L0 6H4',
  '3': 'M0 .65Q.75 0 2 0Q4 0 4 1.5Q4 3 2.3 3H1.4M2.3 3Q4 3 4 4.5Q4 6 2 6Q.75 6 0 5.35',
  '4': 'M3.2 6V0L0 4H4',
  '5': 'M4 0H.3L0 3H2.1Q4 3 4 4.5Q4 6 2 6Q.7 6 0 5.3',
  '6': 'M3.8 .6Q3.2 0 2 0Q0 0 0 3V4Q0 6 2 6Q4 6 4 4.5Q4 3 2 3H0',
  '7': 'M0 0H4L1.3 6',
  '8': 'M2 0Q0 0 0 1.45Q0 3 2 3Q4 3 4 1.45Q4 0 2 0ZM2 3Q0 3 0 4.5Q0 6 2 6Q4 6 4 4.5Q4 3 2 3Z',
  '9': 'M4 3H2Q0 3 0 1.5Q0 0 2 0Q4 0 4 2V4Q4 6 2 6Q.8 6 .2 5.4',
  '-': 'M.5 3H3.5',
  _: 'M0 6H4',
  '.': 'M2 5.8L2 6',
  ',': 'M2 5.55L1.65 6.45',
  ':': 'M2 2L2 2.1M2 4.9L2 5',
  '!': 'M2 0V4.3M2 5.75L2 5.9',
  '?': 'M.2 1Q.8 0 2 0Q4 0 4 1.5Q4 2.4 3 3L2 3.7V4.2M2 5.8L2 5.9',
  '/': 'M0 6L4 0',
  "'": 'M2 0V1.2',
  '·': 'M2 3L2 3.1',
  '#': 'M1.2 0L.6 6M3.4 0L2.8 6M0 2H4M0 4H4',
  '+': 'M.5 3H3.5M2 1.5V4.5',
  '(': 'M3 .2Q1 1.5 1 3Q1 4.5 3 5.8',
  ')': 'M1 .2Q3 1.5 3 3Q3 4.5 1 5.8',
  '&': 'M3.7 5.7L.6 2.1Q.1 1.5.5 .7Q1 0 2 0Q3.4 0 3.4 1.2Q3.4 2 2.4 2.8L.8 4.1Q0 4.8.5 5.6Q1.2 6.2 2.2 5.8L4 4.3',
  '@': 'M3.5 4.8Q2.9 5.4 2 5.4Q.3 5.4.3 3Q.3 .6 2 .6Q3.8 .6 3.8 2.8V4H2.8V2Q2.8 1.4 2 1.4Q1.2 1.4 1.2 2.8Q1.2 4.1 2.1 4.1Q2.8 4.1 2.8 3.2',
  '*': 'M2 .6V5.4M.4 1.5L3.6 4.5M3.6 1.5L.4 4.5',
};

const DIACRITICS: Readonly<Record<string, string>> = {
  '\u0301': 'M1 -.2L2 -1.2', // agudo
  '\u0300': 'M2 -1.2L3 -.2', // grave
  '\u0302': 'M.9 -.2L2 -1.2L3.1 -.2', // circunflexo
  '\u0303': 'M.7 -.55Q1.2 -1.2 1.9 -.7Q2.6 -.2 3.3 -.85', // til
  '\u0308': 'M1.1 -.65L1.1 -.55M2.9 -.65L2.9 -.55', // trema
  '\u0327': 'M2 6.1Q2.8 6.8 1.8 7.25', // cedilha
};

function tokenize(value: string): GlyphToken[] {
  const normalized = normalizeCanvasText(value).normalize('NFD').toUpperCase();
  const tokens: GlyphToken[] = [];

  for (const character of [...normalized]) {
    if (DIACRITICS[character] && tokens.length > 0) {
      tokens.at(-1)!.marks.push(character);
      continue;
    }
    if (/\s/u.test(character)) {
      tokens.push({ base: ' ', marks: [] });
      continue;
    }
    tokens.push({ base: GLYPHS[character] ? character : '*', marks: [] });
  }

  return tokens;
}

/**
 * Gera apenas paths SVG; o conteúdo original nunca é interpolado em XML.
 * Caracteres fora do alfabeto fechado viram um glifo neutro, mantendo o
 * renderer determinístico e sem abrir superfície de injeção.
 */
export function vectorTextSvg(value: string, options: VectorTextOptions): string {
  const tokens = tokenize(value);
  if (tokens.length === 0) return '';

  const {
    x,
    y,
    maxWidth,
    height,
    color = '#ffffff',
    anchor = 'middle',
    opacity = 1,
    strokeRatio = 0.45,
    tracking = 0.95,
    shadow = false,
  } = options;

  const advance = 4 + tracking;
  const logicalWidth = Math.max(4, tokens.length * advance - tracking);
  const scale = Math.min(height / 6, maxWidth / logicalWidth);
  const renderedWidth = logicalWidth * scale;
  const startX = anchor === 'middle' ? x - renderedWidth / 2 : anchor === 'end' ? x - renderedWidth : x;
  const strokeWidth = Math.max(0.28, strokeRatio);

  const paths: string[] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (token.base !== ' ') {
      const glyph = GLYPHS[token.base] ?? GLYPHS['*']!;
      paths.push(`<path d="${glyph}" transform="translate(${cursor} 0)"/>`);
      for (const mark of token.marks) {
        paths.push(`<path d="${DIACRITICS[mark]!}" transform="translate(${cursor} 0)"/>`);
      }
    }
    cursor += advance;
  }

  const content = paths.join('');
  const transform = `translate(${startX.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})`;
  const main = `<g transform="${transform}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${content}</g>`;

  if (!shadow) return main;

  const shadowTransform = `translate(${(startX + 2).toFixed(2)} ${(y + 3).toFixed(2)}) scale(${scale.toFixed(4)})`;
  const shadowLayer = `<g transform="${shadowTransform}" fill="none" stroke="#000000" stroke-width="${(strokeWidth * 1.35).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round" opacity=".52">${content}</g>`;
  return `${shadowLayer}${main}`;
}
