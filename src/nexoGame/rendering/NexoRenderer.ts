import sharp from 'sharp';

import type {
  NexoCharacterRenderView,
  NexoCircleRenderView,
  NexoEncounterRenderView,
  NexoLocationRenderView,
  NexoRenderMetric,
} from '../contracts/renderView.ts';

const WIDTH = 1200;
const HEIGHT = 675;
const CARD_CONTENT_RIGHT = 1118;
const CARD_BOTTOM = 633;
const LOCATION_DESCRIPTION_MAX_CHARACTERS_PER_LINE = 52;
const LOCATION_DESCRIPTION_MAX_LINES = 9;
const LOCATION_DESCRIPTION_START_Y = 282;
const LOCATION_DESCRIPTION_LINE_HEIGHT = 28;

type ChipLayoutOptions = Readonly<{
  startX: number;
  startY: number;
  maxX: number;
  maxY: number;
  minWidth?: number;
  maxWidth?: number;
  height?: number;
  gapX?: number;
  gapY?: number;
  fontSize?: number;
  horizontalPadding?: number;
}>;

type ChipLayout = Readonly<{
  svg: string;
  nextY: number;
  rows: number;
}>;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[char] ?? char);
}

function metricRows(metrics: readonly NexoRenderMetric[], startY: number): string {
  return metrics.map((metric, index) => {
    const y = startY + index * 38;
    const value = metric.max === undefined ? String(metric.value) : `${metric.value}/${metric.max}`;
    return `<text x="86" y="${y}" class="metric-label">${escapeXml(metric.label)}</text><text x="540" y="${y}" class="metric-value">${escapeXml(value)}</text>`;
  }).join('');
}

function fitChipLabel(label: string, width: number, fontSize: number, horizontalPadding: number): string {
  const usableWidth = Math.max(1, width - horizontalPadding * 2);
  const averageGlyphWidth = fontSize * 0.58;
  const maxCharacters = Math.max(1, Math.floor(usableWidth / averageGlyphWidth));
  if (label.length <= maxCharacters) return label;
  if (maxCharacters === 1) return '…';
  return `${label.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function chips(labels: readonly string[], options: ChipLayoutOptions): ChipLayout {
  const minWidth = options.minWidth ?? 90;
  const maxWidth = options.maxWidth ?? 260;
  const height = options.height ?? 42;
  const gapX = options.gapX ?? 12;
  const gapY = options.gapY ?? 10;
  const fontSize = options.fontSize ?? 16;
  const horizontalPadding = options.horizontalPadding ?? 18;

  let x = options.startX;
  let y = options.startY;
  let rows = labels.length ? 1 : 0;
  const parts: string[] = [];

  for (const label of labels) {
    const estimatedWidth = Math.ceil(horizontalPadding * 2 + label.length * fontSize * 0.58);
    const width = Math.min(maxWidth, Math.max(minWidth, estimatedWidth));

    if (x !== options.startX && x + width > options.maxX) {
      x = options.startX;
      y += height + gapY;
      rows += 1;
    }

    if (y + height > options.maxY) {
      throw new Error('NEXO chip layout excedeu a área útil do card.');
    }

    const renderedLabel = fitChipLabel(label, width, fontSize, horizontalPadding);
    const baselineY = y + Math.round((height + fontSize) / 2) - 2;
    parts.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.floor(height / 2)}" class="chip"/>` +
      `<text x="${x + horizontalPadding}" y="${baselineY}" class="chip-text" style="font-size:${fontSize}px">${escapeXml(renderedLabel)}</text>`,
    );
    x += width + gapX;
  }

  return Object.freeze({
    svg: parts.join(''),
    nextY: labels.length ? y + height : options.startY,
    rows,
  });
}

function splitOversizedWord(word: string, maxCharacters: number): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < word.length; offset += maxCharacters) {
    chunks.push(word.slice(offset, offset + maxCharacters));
  }
  return chunks;
}

function wrapLocationDescription(value: string): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  const flushCurrent = () => {
    if (!current) return;
    lines.push(current);
    current = '';
  };

  for (const rawWord of words) {
    const fragments = rawWord.length > LOCATION_DESCRIPTION_MAX_CHARACTERS_PER_LINE
      ? splitOversizedWord(rawWord, LOCATION_DESCRIPTION_MAX_CHARACTERS_PER_LINE)
      : [rawWord];

    for (const fragment of fragments) {
      const candidate = current ? `${current} ${fragment}` : fragment;
      if (candidate.length <= LOCATION_DESCRIPTION_MAX_CHARACTERS_PER_LINE) {
        current = candidate;
        continue;
      }
      flushCurrent();
      current = fragment;
    }
  }
  flushCurrent();

  if (lines.length > LOCATION_DESCRIPTION_MAX_LINES) {
    throw new Error('Descrição do local NEXO excedeu a área útil do card.');
  }
  return lines;
}

function shell(title: string, subtitle: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#11111b"/><stop offset="1" stop-color="#1f1633"/></linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect x="42" y="42" width="1116" height="591" rx="34" fill="#171421" stroke="#7c5cff" stroke-width="2"/>
  <text x="82" y="112" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#f5f2ff">${escapeXml(title)}</text>
  <text x="84" y="151" font-family="Arial, sans-serif" font-size="20" fill="#b9acd8">${escapeXml(subtitle)}</text>
  <style>
    .metric-label{font:600 22px Arial,sans-serif;fill:#d8d1e8}.metric-value{font:700 22px Arial,sans-serif;fill:#ffffff;text-anchor:end}
    .label{font:600 22px Arial,sans-serif;fill:#c8bddf}.value{font:700 25px Arial,sans-serif;fill:#ffffff}.chip{fill:#29213b;stroke:#5d4b85}.chip-text{font-family:Arial,sans-serif;font-weight:600;fill:#eee8ff}
    .location-description{font:500 20px Arial,sans-serif;fill:#ddd5f0}
  </style>
  ${body}
</svg>`;
}

async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

export async function renderNexoCircle(view: NexoCircleRenderView): Promise<Buffer> {
  const highlightChips = chips(view.highlights, {
    startX: 690,
    startY: 205,
    maxX: CARD_CONTENT_RIGHT,
    maxY: 595,
    maxWidth: 206,
    height: 36,
    gapY: 8,
    fontSize: 14,
    horizontalPadding: 16,
  });
  const body = `<text x="84" y="215" class="label">Modo</text><text x="260" y="215" class="value">${escapeXml(view.modeLabel)}</text>
  <text x="84" y="255" class="label">Estado</text><text x="260" y="255" class="value">${escapeXml(view.statusLabel)}</text>
  ${metricRows(view.metrics, 320)}
  ${highlightChips.svg}`;
  return svgToPng(shell(view.titleLabel, 'NEXO · Círculo', body));
}

export async function renderNexoCharacter(view: NexoCharacterRenderView): Promise<Buffer> {
  const techniqueChips = chips(view.techniqueLabels, {
    startX: 670,
    startY: 210,
    maxX: CARD_CONTENT_RIGHT,
    maxY: 550,
    maxWidth: 218,
    height: 30,
    gapX: 10,
    gapY: 6,
    fontSize: 13,
    horizontalPadding: 14,
  });
  const traitChips = chips(view.traitLabels, {
    startX: 670,
    startY: techniqueChips.nextY + (techniqueChips.rows ? 12 : 0),
    maxX: CARD_CONTENT_RIGHT,
    maxY: 590,
    maxWidth: 218,
    height: 30,
    gapX: 10,
    gapY: 6,
    fontSize: 13,
    horizontalPadding: 14,
  });
  const body = `<text x="84" y="210" class="label">Origem</text><text x="280" y="210" class="value">${escapeXml(view.originLabel)}</text>
  <text x="84" y="248" class="label">Tom</text><text x="280" y="248" class="value">${escapeXml(view.toneLabel)}</text>
  <text x="84" y="286" class="label">Impulso</text><text x="280" y="286" class="value">${escapeXml(view.impulseLabel)}</text>
  <text x="84" y="324" class="label">Cicatriz</text><text x="280" y="324" class="value">${escapeXml(view.scarLabel)}</text>
  ${metricRows(view.metrics, 382)}
  ${techniqueChips.svg}
  ${traitChips.svg}`;
  return svgToPng(shell(view.titleLabel, 'NEXO · Personagem', body));
}

export async function renderNexoEncounter(view: NexoEncounterRenderView): Promise<Buffer> {
  const actionChips = chips(view.actionLabels, {
    startX: 655,
    startY: 390,
    maxX: CARD_CONTENT_RIGHT,
    maxY: 628,
    maxWidth: 226,
    height: 30,
    gapX: 10,
    gapY: 4,
    fontSize: 13,
    horizontalPadding: 14,
  });
  const statusChips = chips(view.statusLabels, {
    startX: 655,
    startY: actionChips.nextY + (actionChips.rows ? 8 : 0),
    maxX: CARD_CONTENT_RIGHT,
    maxY: 628,
    maxWidth: 226,
    height: 30,
    gapX: 10,
    gapY: 4,
    fontSize: 13,
    horizontalPadding: 14,
  });
  const outcome = view.outcomeLabel ? ` · ${escapeXml(view.outcomeLabel)}` : '';
  const body = `<text x="84" y="210" class="label">Rodada</text><text x="250" y="210" class="value">${view.round}</text>
  <text x="84" y="250" class="label">Postura</text><text x="250" y="250" class="value">${escapeXml(view.postureLabel)}${outcome}</text>
  <text x="84" y="310" class="value">${escapeXml(view.actor.label)}</text>${metricRows(view.actor.metrics, 350)}
  <text x="655" y="310" class="value">${escapeXml(view.enemy.label)}</text><text x="655" y="346" class="label">Intenção: ${escapeXml(view.enemy.intentLabel)}</text>
  ${actionChips.svg}${statusChips.svg}`;
  return svgToPng(shell(view.titleLabel, 'NEXO · Encontro', body));
}

export async function renderNexoLocation(view: NexoLocationRenderView): Promise<Buffer> {
  const descriptionLines = wrapLocationDescription(view.descriptionLabel);
  const descriptionSvg = descriptionLines.map((line, index) => (
    `<text x="84" y="${LOCATION_DESCRIPTION_START_Y + index * LOCATION_DESCRIPTION_LINE_HEIGHT}" class="location-description">${escapeXml(line)}</text>`
  )).join('');
  const descriptionBottom = LOCATION_DESCRIPTION_START_Y + Math.max(0, descriptionLines.length - 1) * LOCATION_DESCRIPTION_LINE_HEIGHT;
  const highlightLabelY = descriptionBottom + 38;
  const highlightChips = chips(view.highlights, {
    startX: 84,
    startY: highlightLabelY + 16,
    maxX: CARD_CONTENT_RIGHT,
    maxY: 628,
    maxWidth: 240,
    height: 30,
    gapX: 10,
    gapY: 6,
    fontSize: 13,
    horizontalPadding: 14,
  });
  const body = `<text x="84" y="205" class="label">Clima</text><text x="240" y="205" class="value">${escapeXml(view.moodLabel)}</text>
  <text x="84" y="248" class="label">Descrição</text>
  ${descriptionSvg}
  <text x="84" y="${highlightLabelY}" class="label">Pontos visíveis</text>
  ${highlightChips.svg}`;
  return svgToPng(shell(view.nameLabel, 'NEXO · Local', body));
}

export const NEXO_RENDER_DIMENSIONS = Object.freeze({ width: WIDTH, height: HEIGHT });
export const NEXO_RENDER_CARD_BOUNDS = Object.freeze({ right: CARD_CONTENT_RIGHT, bottom: CARD_BOTTOM });
