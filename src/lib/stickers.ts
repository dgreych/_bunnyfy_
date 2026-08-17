import fs from 'node:fs/promises';

import sharp from 'sharp';

import { AppError } from '../envelope.ts';
import {
  runSubprocess,
  SubprocessTimeoutError,
  ToolNotFoundError,
  type RunSubprocessResult,
} from './subprocess.ts';

export const STICKER_SIZE = 512;

export type StickerKind = 'static' | 'animated';
export type StickerFit = 'contain' | 'cover';
export type StickerCanvasTheme = 'honey' | 'midnight' | 'mint' | 'rose';
export type StickerCanvasTemplate = 'text' | 'quote' | 'badge';

export interface StickerProcessDeps {
  ffmpegPath: string;
  ffprobePath: string;
  timeoutMs: number;
  maxInputPixels: number;
  maxOutputBytes: number;
  maxDurationSeconds: number;
  runProcess?: (
    bin: string,
    args: string[],
    options: { timeoutMs: number; maxBufferBytes?: number },
  ) => Promise<RunSubprocessResult>;
}

export interface StickerProcessResult {
  width: number;
  height: number;
  animated: boolean;
  durationSeconds: number | null;
}

export interface StickerCanvasInput {
  template: StickerCanvasTemplate;
  text: string;
  title?: string;
  footer?: string;
  theme: StickerCanvasTheme;
}

const THEMES: Record<StickerCanvasTheme, {
  backgroundA: string;
  backgroundB: string;
  accent: string;
  text: string;
  muted: string;
  panel: string;
}> = {
  honey: { backgroundA: '#17110a', backgroundB: '#3d2605', accent: '#ffbd2e', text: '#fff8e8', muted: '#e8c98a', panel: '#23180c' },
  midnight: { backgroundA: '#080d21', backgroundB: '#1a2757', accent: '#6ea8ff', text: '#f4f7ff', muted: '#b6c6ea', panel: '#101832' },
  mint: { backgroundA: '#071c19', backgroundB: '#0f4b3f', accent: '#64f1c2', text: '#effff9', muted: '#a9dbc9', panel: '#0a2c27' },
  rose: { backgroundA: '#250b18', backgroundB: '#6b173a', accent: '#ff78ad', text: '#fff3f8', muted: '#efb6cc', panel: '#381023' },
};

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&apos;',
    '"': '&quot;',
  })[character]!);
}

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const chunks = word.match(new RegExp(`.{1,${maxCharacters}}`, 'gu')) ?? [];
    for (const chunk of chunks) {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if ([...candidate].length <= maxCharacters) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = chunk;
      }
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = [...lines[maxLines - 1]!].slice(0, Math.max(1, maxCharacters - 1)).join('');
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

async function validateWebpOutput(
  outputPath: string,
  expectedAnimated: boolean,
  maxOutputBytes: number,
): Promise<StickerProcessResult> {
  let stat;
  try {
    stat = await fs.stat(outputPath);
  } catch {
    throw AppError.unavailable('O processamento não produziu uma figurinha.');
  }
  if (!stat.isFile() || stat.size === 0) {
    throw AppError.unavailable('O processamento produziu uma figurinha inválida.');
  }
  if (stat.size > maxOutputBytes) {
    throw AppError.payloadTooLarge('A figurinha resultante excede o limite de bytes permitido.');
  }

  try {
    const metadata = await sharp(outputPath, {
      animated: true,
      limitInputPixels: STICKER_SIZE * STICKER_SIZE * 300,
      failOn: 'error',
    }).metadata();
    const pages = metadata.pages ?? 1;
    const animated = pages > 1;
    if (
      metadata.format !== 'webp'
      || metadata.width !== STICKER_SIZE
      || !metadata.height
      || metadata.pageHeight !== undefined && metadata.pageHeight !== STICKER_SIZE
      || metadata.pageHeight === undefined && metadata.height !== STICKER_SIZE
      || expectedAnimated !== animated
    ) {
      throw new Error('invalid-sticker-output');
    }
    const delays = Array.isArray(metadata.delay) ? metadata.delay : [];
    const durationSeconds = animated
      ? delays.reduce((total, delay) => total + Math.max(0, delay), 0) / 1000
      : null;
    return { width: STICKER_SIZE, height: STICKER_SIZE, animated, durationSeconds };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unavailable('O processamento produziu uma figurinha inválida.');
  }
}

async function createStaticSticker(
  inputPath: string,
  outputPath: string,
  fit: StickerFit,
  deps: StickerProcessDeps,
): Promise<StickerProcessResult> {
  let metadata;
  try {
    metadata = await sharp(inputPath, { limitInputPixels: false, failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp', 'gif'].includes(metadata.format ?? '')) {
      throw new Error('unsupported-static-input');
    }
    const pixels = metadata.width * metadata.height;
    if (!Number.isSafeInteger(pixels) || pixels > deps.maxInputPixels) {
      throw AppError.payloadTooLarge('A imagem excede o limite de pixels permitido.');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.badRequest('A mídia não é uma imagem válida para figurinha estática.');
  }

  for (const quality of [88, 76, 62, 48]) {
    try {
      await fs.rm(outputPath, { force: true });
      await sharp(inputPath, { limitInputPixels: deps.maxInputPixels, failOn: 'error' })
        .autoOrient()
        .resize(STICKER_SIZE, STICKER_SIZE, {
          fit,
          position: 'centre',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          kernel: sharp.kernel.lanczos3,
        })
        .webp({ quality, alphaQuality: 92, effort: 6 })
        .toFile(outputPath);
      const stat = await fs.stat(outputPath);
      if (stat.size <= deps.maxOutputBytes) {
        return validateWebpOutput(outputPath, false, deps.maxOutputBytes);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.unavailable('Não foi possível criar a figurinha estática.');
    }
  }
  throw AppError.payloadTooLarge('A figurinha resultante excede o limite de bytes permitido.');
}

async function inspectAnimatedInput(inputPath: string, deps: StickerProcessDeps): Promise<void> {
  const run = deps.runProcess ?? runSubprocess;
  let result: RunSubprocessResult;
  try {
    result = await run(deps.ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      inputPath,
    ], { timeoutMs: Math.min(deps.timeoutMs, 15_000), maxBufferBytes: 64 * 1024 });
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable('Ferramenta de análise de mídia não está instalada.');
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('A análise da mídia excedeu o tempo limite.');
    }
    throw AppError.badRequest('A mídia não contém uma animação ou vídeo válido e suportado.');
  }

  try {
    const parsed = JSON.parse(result.stdout) as { streams?: Array<{ width?: number; height?: number }> };
    const stream = parsed.streams?.[0];
    const width = stream?.width;
    const height = stream?.height;
    if (
      typeof width !== 'number'
      || typeof height !== 'number'
      || !Number.isInteger(width)
      || !Number.isInteger(height)
      || width < 1
      || height < 1
    ) {
      throw new Error('invalid-video-stream');
    }
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > deps.maxInputPixels) {
      throw AppError.payloadTooLarge('A animação excede o limite de pixels permitido.');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.badRequest('A mídia não contém uma animação ou vídeo válido e suportado.');
  }
}

async function createAnimatedSticker(
  inputPath: string,
  outputPath: string,
  fit: StickerFit,
  deps: StickerProcessDeps,
): Promise<StickerProcessResult> {
  const run = deps.runProcess ?? runSubprocess;
  await inspectAnimatedInput(inputPath, deps);
  const profiles = [
    { fps: 15, quality: 70 },
    { fps: 12, quality: 55 },
    { fps: 10, quality: 40 },
  ];
  let producedOversizedOutput = false;

  for (const profile of profiles) {
    await fs.rm(outputPath, { force: true });
    const geometry = fit === 'cover'
      ? `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=increase,crop=${STICKER_SIZE}:${STICKER_SIZE}`
      : `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
    try {
      await run(deps.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-t', String(deps.maxDurationSeconds),
        '-an', '-sn', '-dn',
        '-vf', `fps=${profile.fps},${geometry},format=rgba`,
        '-c:v', 'libwebp_anim',
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', String(profile.quality),
        '-loop', '0',
        '-fps_mode', 'passthrough',
        outputPath,
      ], { timeoutMs: deps.timeoutMs, maxBufferBytes: 1024 * 1024 });

      const stat = await fs.stat(outputPath).catch(() => null);
      if (stat?.isFile() && stat.size > 0 && stat.size <= deps.maxOutputBytes) {
        const result = await validateWebpOutput(outputPath, true, deps.maxOutputBytes);
        if (result.durationSeconds !== null && result.durationSeconds > deps.maxDurationSeconds + 0.2) {
          throw AppError.unavailable('A animação produzida ultrapassou a duração permitida.');
        }
        return result;
      }
      if (stat?.isFile() && stat.size > deps.maxOutputBytes) producedOversizedOutput = true;
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        throw AppError.toolUnavailable('Ferramenta de animação não está instalada.');
      }
      if (error instanceof SubprocessTimeoutError) {
        throw AppError.upstreamTimeout('Criação da figurinha animada excedeu o tempo limite.');
      }
      if (error instanceof AppError) throw error;
      if (profile === profiles[profiles.length - 1] && !producedOversizedOutput) {
        throw AppError.badRequest('A mídia não contém uma animação ou vídeo válido e suportado.');
      }
    }
  }

  if (producedOversizedOutput) {
    throw AppError.payloadTooLarge('A figurinha animada excede o limite de bytes permitido.');
  }
  throw AppError.badRequest('A mídia não contém uma animação ou vídeo válido e suportado.');
}

export async function createStickerFromMedia(
  inputPath: string,
  outputPath: string,
  kind: StickerKind,
  fit: StickerFit,
  deps: StickerProcessDeps,
): Promise<StickerProcessResult> {
  return kind === 'animated'
    ? createAnimatedSticker(inputPath, outputPath, fit, deps)
    : createStaticSticker(inputPath, outputPath, fit, deps);
}

export async function renderStickerCanvas(input: StickerCanvasInput): Promise<Buffer> {
  const theme = THEMES[input.theme];
  const lines = wrapText(input.text, input.template === 'quote' ? 21 : 18, input.template === 'badge' ? 4 : 6);
  const fontSize = input.template === 'badge' ? 49 : lines.length <= 2 ? 68 : lines.length <= 4 ? 54 : 44;
  const lineHeight = Math.round(fontSize * 1.18);
  const startY = 256 - ((lines.length - 1) * lineHeight) / 2;
  const text = lines.map((line, index) =>
    `<text x="256" y="${Math.round(startY + index * lineHeight)}" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="${fontSize}" font-weight="900" fill="${theme.text}">${escapeXml(line)}</text>`,
  ).join('');
  const title = input.title
    ? `<text x="256" y="84" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="24" font-weight="800" letter-spacing="2" fill="${theme.accent}">${escapeXml(input.title.toUpperCase())}</text>`
    : '';
  const footer = input.footer
    ? `<text x="256" y="449" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="23" font-weight="700" fill="${theme.muted}">${escapeXml(input.footer)}</text>`
    : '';
  const quoteMarks = input.template === 'quote'
    ? `<text x="64" y="151" font-family="Georgia,serif" font-size="116" font-weight="900" fill="${theme.accent}" opacity=".72">“</text>`
    : '';
  const badge = input.template === 'badge'
    ? `<circle cx="256" cy="256" r="190" fill="${theme.panel}" stroke="${theme.accent}" stroke-width="12"/><circle cx="256" cy="256" r="170" fill="none" stroke="${theme.accent}" stroke-width="2" stroke-dasharray="7 12"/>`
    : `<rect x="38" y="38" width="436" height="436" rx="78" fill="${theme.panel}" stroke="${theme.accent}" stroke-width="4"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${theme.backgroundA}"/><stop offset="1" stop-color="${theme.backgroundB}"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".42"/></filter></defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <g filter="url(#shadow)">${badge}</g>${quoteMarks}${title}${text}${footer}
  <circle cx="454" cy="58" r="15" fill="${theme.accent}"/><circle cx="418" cy="58" r="7" fill="${theme.accent}" opacity=".55"/>
  </svg>`;

  try {
    return await sharp(Buffer.from(svg), { density: 72, limitInputPixels: STICKER_SIZE * STICKER_SIZE })
      .resize(STICKER_SIZE, STICKER_SIZE, { fit: 'fill' })
      .webp({ quality: 88, alphaQuality: 92, effort: 6 })
      .toBuffer();
  } catch {
    throw AppError.internal('Não foi possível renderizar a figurinha Canvas.');
  }
}
