import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { AppError } from '../envelope.ts';
import { STICKER_LOGO_SIZE } from './logoStickerVisual.ts';
import { type StickerLogoInput } from './logoStickerVisualAll.ts';
import { renderStickerLogoSvgV2 } from './logoStickerVisualV2.ts';
import {
  runSubprocess,
  SubprocessExitError,
  SubprocessTimeoutError,
  ToolNotFoundError,
} from './subprocess.ts';

export const LOGO_STICKER_FPS = 9;
export const LOGO_STICKER_FRAMES = 18;
export const LOGO_STICKER_LOGICAL_FRAMES = 24;
export const LOGO_STICKER_DURATION_SECONDS = LOGO_STICKER_FRAMES / LOGO_STICKER_FPS;
export const LOGO_STICKER_TARGET_MAX_BYTES = 950_000;
const FRAME_WORKERS = 4;
const QUALITY_STEPS = [58, 52, 46, 40, 34] as const;

export interface LogoStickerDeps {
  readonly ffmpegPath: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly run?: typeof runSubprocess;
}

export interface LogoStickerResult {
  readonly buffer: Buffer;
  readonly mime: 'image/webp';
  readonly width: 512;
  readonly height: 512;
  readonly fps: number;
  readonly frames: number;
  readonly durationSeconds: number;
  readonly animated: true;
  readonly quality: number;
}

function countChunk(buffer: Buffer, chunk: string): number {
  const needle = Buffer.from(chunk, 'ascii');
  let count = 0;
  let cursor = 0;
  while (cursor <= buffer.length - needle.length) {
    const index = buffer.indexOf(needle, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

export function inspectAnimatedWebp(buffer: Buffer): { valid: boolean; frames: number } {
  const validContainer = buffer.length > 40
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    && buffer.indexOf(Buffer.from('ANIM', 'ascii')) >= 0;
  const frames = validContainer ? countChunk(buffer, 'ANMF') : 0;
  return { valid: validContainer && frames > 0, frames };
}

export function logicalFrameForEncodedFrame(encodedFrame: number): number {
  if (!Number.isInteger(encodedFrame) || encodedFrame < 0 || encodedFrame >= LOGO_STICKER_FRAMES) {
    throw new TypeError('Frame codificado inválido.');
  }
  return Math.round(
    encodedFrame * (LOGO_STICKER_LOGICAL_FRAMES - 1) / (LOGO_STICKER_FRAMES - 1),
  );
}

async function renderFrames(input: StickerLogoInput, workspace: string): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const encodedFrame = cursor;
      cursor += 1;
      if (encodedFrame >= LOGO_STICKER_FRAMES) return;
      const logicalFrame = logicalFrameForEncodedFrame(encodedFrame);
      const svg = renderStickerLogoSvgV2(input, logicalFrame);
      await sharp(Buffer.from(svg), { density: 96, limitInputPixels: 4_000_000 })
        .resize(STICKER_LOGO_SIZE, STICKER_LOGO_SIZE, { fit: 'fill' })
        .png({ compressionLevel: 6 })
        .toFile(path.join(workspace, `frame-${String(encodedFrame).padStart(3, '0')}.png`));
    }
  };
  await Promise.all(Array.from({ length: FRAME_WORKERS }, () => worker()));
}

export async function renderLogoSticker(
  input: StickerLogoInput,
  deps: LogoStickerDeps,
): Promise<LogoStickerResult> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'bunnyfy-logo-sticker-'));
  const run = deps.run ?? runSubprocess;
  const configuredMax = Number(deps.maxOutputBytes ?? LOGO_STICKER_TARGET_MAX_BYTES);
  if (!Number.isFinite(configuredMax) || configuredMax <= 0) {
    throw AppError.internal('Limite inválido para sticker animado.');
  }
  const maxOutputBytes = Math.min(LOGO_STICKER_TARGET_MAX_BYTES, configuredMax);

  try {
    renderStickerLogoSvgV2(input, 0);
    await renderFrames(input, workspace);

    for (const quality of QUALITY_STEPS) {
      const outputPath = path.join(workspace, `logo-q${quality}.webp`);
      await run(deps.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-framerate', String(LOGO_STICKER_FPS),
        '-start_number', '0',
        '-i', path.join(workspace, 'frame-%03d.png'),
        '-frames:v', String(LOGO_STICKER_FRAMES),
        '-vf', 'format=rgba',
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-compression_level', '4',
        '-q:v', String(quality),
        '-loop', '0',
        '-an', '-vsync', '0',
        '-threads', '4',
        '-y', outputPath,
      ], { timeoutMs: deps.timeoutMs, maxBufferBytes: 1024 * 1024 });

      const buffer = await fs.readFile(outputPath);
      const inspected = inspectAnimatedWebp(buffer);
      if (!inspected.valid || inspected.frames !== LOGO_STICKER_FRAMES) {
        throw AppError.internal('O encoder produziu um WebP animado inválido.');
      }
      if (buffer.length <= maxOutputBytes) {
        return {
          buffer,
          mime: 'image/webp',
          width: STICKER_LOGO_SIZE,
          height: STICKER_LOGO_SIZE,
          fps: LOGO_STICKER_FPS,
          frames: LOGO_STICKER_FRAMES,
          durationSeconds: LOGO_STICKER_DURATION_SECONDS,
          animated: true,
          quality,
        };
      }
    }
    throw AppError.payloadTooLarge('O sticker animado excede o limite permitido.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable('Renderização de sticker animado indisponível no momento.');
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('Tempo esgotado ao codificar o sticker animado.');
    }
    if (error instanceof SubprocessExitError) {
      throw AppError.unavailable('Não foi possível codificar o sticker animado.');
    }
    throw AppError.internal('Não foi possível renderizar o sticker animado.', {
      renderCode: error instanceof Error ? error.name : 'unknown',
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

export const renderAnchorLogoSticker = renderLogoSticker;
