import fs from 'node:fs/promises';

import sharp from 'sharp';

import { AppError } from '../envelope.ts';
import type { ImageInfo } from './backgroundRemoval.ts';

export type UpscaleScale = 2 | 4;

export interface UpscaleDeps {
  timeoutMs: number;
  maxInputPixels: number;
  maxOutputPixels: number;
  maxOutputDimension: number;
  maxOutputBytes: number;
}

export interface UpscaleTarget {
  width: number;
  height: number;
  pixels: number;
}

export interface UpscaleOutputSpec {
  format: 'jpeg' | 'png' | 'webp';
  extension: 'jpg' | 'png' | 'webp';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export function upscaleOutputSpec(sourceFormat: string): UpscaleOutputSpec {
  if (sourceFormat === 'jpeg') return { format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' };
  if (sourceFormat === 'webp') return { format: 'webp', extension: 'webp', mimeType: 'image/webp' };
  return { format: 'png', extension: 'png', mimeType: 'image/png' };
}

export function calculateUpscaleTarget(source: ImageInfo, scale: UpscaleScale, deps: Pick<UpscaleDeps, 'maxOutputPixels' | 'maxOutputDimension'>): UpscaleTarget {
  const width = source.orientedWidth * scale;
  const height = source.orientedHeight * scale;

  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw AppError.payloadTooLarge('Dimensões resultantes excedem o limite permitido.');
  }
  if (width > deps.maxOutputDimension || height > deps.maxOutputDimension) {
    throw AppError.payloadTooLarge('Dimensões resultantes excedem o limite permitido.');
  }

  const pixelsBig = BigInt(source.orientedWidth) * BigInt(source.orientedHeight) * BigInt(scale) * BigInt(scale);
  if (pixelsBig > BigInt(deps.maxOutputPixels)) {
    throw AppError.payloadTooLarge('Imagem ampliada excede o limite de pixels permitido.');
  }

  return { width, height, pixels: Number(pixelsBig) };
}

export async function runImageUpscale(
  inputPath: string,
  outputPath: string,
  source: ImageInfo,
  scale: UpscaleScale,
  deps: UpscaleDeps,
): Promise<void> {
  const target = calculateUpscaleTarget(source, scale, deps);
  const output = upscaleOutputSpec(source.format);
  const timeoutSeconds = Math.max(1, Math.ceil(deps.timeoutMs / 1000));

  try {
    let pipeline = sharp(inputPath, { limitInputPixels: deps.maxInputPixels, failOn: 'error' })
      .autoOrient()
      .resize(target.width, target.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .timeout({ seconds: timeoutSeconds });

    if (output.format === 'jpeg') pipeline = pipeline.jpeg({ quality: 90, progressive: true });
    else if (output.format === 'webp') pipeline = pipeline.webp({ quality: 90 });
    else pipeline = pipeline.png({ compressionLevel: 6 });

    await pipeline.toFile(outputPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'falha desconhecida do Sharp';
    if (/timeout/i.test(reason)) {
      throw new AppError({
        statusCode: 504,
        code: 'BUNNYFY_TIMEOUT',
        message: 'Ampliação de imagem excedeu o tempo limite.',
        retryable: true,
        internalDetails: `sharp upscale timeout: ${reason}`,
        cause: error,
      });
    }
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Não foi possível ampliar a imagem.',
      retryable: true,
      internalDetails: `sharp upscale: ${reason}`,
      cause: error,
    });
  }
}

export async function validateUpscaleOutput(
  outputPath: string,
  target: UpscaleTarget,
  expected: UpscaleOutputSpec,
  deps: Pick<UpscaleDeps, 'maxOutputBytes' | 'maxOutputPixels'>,
): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(outputPath);
  } catch {
    throw AppError.unavailable('A ampliação não produziu uma imagem.');
  }

  if (!stat.isFile() || stat.size === 0) {
    throw AppError.unavailable('A ampliação produziu uma saída inválida.');
  }
  if (stat.size > deps.maxOutputBytes) {
    throw AppError.payloadTooLarge('Imagem ampliada excede o limite de bytes permitido.');
  }

  try {
    const metadata = await sharp(outputPath, { limitInputPixels: deps.maxOutputPixels, failOn: 'error' }).metadata();
    if (metadata.format !== expected.format || metadata.width !== target.width || metadata.height !== target.height) {
      throw new Error('invalid-upscale-output');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unavailable('A ampliação produziu uma saída inválida.');
  }
}
