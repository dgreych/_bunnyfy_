import fs from 'node:fs/promises';
import path from 'node:path';

import sharp, { type Metadata } from 'sharp';

import { AppError } from '../envelope.ts';
import { runSubprocess, SubprocessTimeoutError, ToolNotFoundError } from './subprocess.ts';

const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

export type BackgroundRemovalModel = 'silueta' | 'u2netp' | 'isnet-general-use';

export interface ImageInfo {
  width: number;
  height: number;
  orientedWidth: number;
  orientedHeight: number;
  format: string;
}

export interface BackgroundRemovalDeps {
  rembgPath: string;
  model: BackgroundRemovalModel;
  modelDir: string;
  timeoutMs: number;
  ompNumThreads: number;
}

export function backgroundRemovalModelPath(modelDir: string, model: BackgroundRemovalModel): string {
  return path.join(modelDir, `${model}.onnx`);
}

export async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0) return false;
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirma dimensões/formato e força uma decodificação real via libvips. O
 * limite de pixels é aplicado antes da decodificação pesada.
 */
export async function inspectProcessableImage(inputPath: string, maxInputPixels: number): Promise<ImageInfo> {
  let metadata: Metadata;
  try {
    const image = sharp(inputPath, { limitInputPixels: false, failOn: 'error' });
    metadata = await image.metadata();

    if (!metadata.width || !metadata.height || !metadata.format || !ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
      throw new Error('unsupported-image');
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new Error('animated-image');
    }

    const pixels = metadata.width * metadata.height;
    if (!Number.isSafeInteger(pixels) || pixels > maxInputPixels) {
      throw AppError.payloadTooLarge('Imagem excede o limite de pixels permitido.');
    }

    await image.stats();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.badRequest('Mídia informada não é uma imagem estática válida e suportada.');
  }

  return {
    width: metadata.width,
    height: metadata.height,
    orientedWidth: metadata.autoOrient?.width ?? metadata.width,
    orientedHeight: metadata.autoOrient?.height ?? metadata.height,
    format: metadata.format,
  };
}

/** Executa apenas a ferramenta local. Validação e registro de saída ficam na rota. */
export async function runBackgroundRemoval(
  inputPath: string,
  outputPath: string,
  deps: BackgroundRemovalDeps,
): Promise<void> {
  const modelPath = backgroundRemovalModelPath(deps.modelDir, deps.model);
  if (!(await isReadableFile(modelPath))) {
    throw AppError.toolUnavailable('Modelo de remoção de fundo não está provisionado.');
  }

  try {
    await runSubprocess(deps.rembgPath, ['i', '-m', deps.model, inputPath, outputPath], {
      timeoutMs: deps.timeoutMs,
      maxBufferBytes: 1024 * 1024,
      env: {
        ...process.env,
        U2NET_HOME: deps.modelDir,
        OMP_NUM_THREADS: String(deps.ompNumThreads),
      },
    });
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable('Ferramenta de remoção de fundo não está instalada.');
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('Remoção de fundo excedeu o tempo limite.');
    }
    throw AppError.unavailable('Não foi possível remover o fundo da imagem.');
  }
}

export async function validateBackgroundRemovalOutput(
  outputPath: string,
  source: Pick<ImageInfo, 'width' | 'height'>,
  maxOutputBytes: number,
  maxOutputPixels: number,
): Promise<ImageInfo> {
  let stat;
  try {
    stat = await fs.stat(outputPath);
  } catch {
    throw AppError.unavailable('A ferramenta de remoção de fundo não produziu uma imagem.');
  }

  if (!stat.isFile() || stat.size === 0) {
    throw AppError.unavailable('A ferramenta de remoção de fundo produziu uma saída inválida.');
  }
  if (stat.size > maxOutputBytes) {
    throw AppError.payloadTooLarge('Imagem resultante excede o limite de bytes permitido.');
  }

  try {
    const metadata = await sharp(outputPath, { limitInputPixels: false, failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('missing-output-dimensions');
    }

    const pixels = metadata.width * metadata.height;
    if (!Number.isSafeInteger(pixels) || pixels > maxOutputPixels) {
      throw AppError.payloadTooLarge('Imagem resultante excede o limite de pixels permitido.');
    }

    if (
      metadata.format !== 'png' ||
      !metadata.hasAlpha ||
      metadata.width !== source.width ||
      metadata.height !== source.height
    ) {
      throw new Error('invalid-output');
    }

    return {
      width: metadata.width,
      height: metadata.height,
      orientedWidth: metadata.width,
      orientedHeight: metadata.height,
      format: metadata.format,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unavailable('A ferramenta de remoção de fundo produziu uma saída inválida.');
  }
}
