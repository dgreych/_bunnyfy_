import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import sharp from 'sharp';

import { AppError } from '../src/envelope.ts';
import {
  backgroundRemovalModelPath,
  inspectProcessableImage,
  runBackgroundRemoval,
  validateBackgroundRemovalOutput,
  type BackgroundRemovalModel,
} from '../src/lib/backgroundRemoval.ts';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}.`);
  return value;
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} inválido.`);
  return value;
}

function modelEnv(): BackgroundRemovalModel {
  const value = process.env.REMBG_MODEL?.trim() || 'silueta';
  if (value !== 'silueta' && value !== 'u2netp') throw new Error('REMBG_MODEL inválido para o smoke.');
  return value;
}

async function inspectAlpha(outputPath: string): Promise<{ transparentRatio: number; opaqueRatio: number; hasMixedAlpha: boolean }> {
  const { data, info } = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  if (channels < 4) throw new Error('Saída não possui canal alpha após decodificação.');

  let transparent = 0;
  let opaque = 0;
  const pixels = info.width * info.height;
  for (let offset = 3; offset < data.length; offset += channels) {
    const alpha = data[offset] ?? 255;
    if (alpha < 16) transparent += 1;
    if (alpha > 239) opaque += 1;
  }

  const transparentRatio = transparent / pixels;
  const opaqueRatio = opaque / pixels;
  return {
    transparentRatio,
    opaqueRatio,
    hasMixedAlpha: transparentRatio > 0.01 && opaqueRatio > 0.01,
  };
}

async function main(): Promise<void> {
  const inputPath = requiredEnv('BACKGROUND_SMOKE_INPUT_PATH');
  const rembgPath = requiredEnv('REMBG_PATH');
  const modelDir = requiredEnv('REMBG_MODEL_DIR');
  const reportPath = process.env.BACKGROUND_SMOKE_REPORT_PATH?.trim();
  const model = modelEnv();
  const timeoutMs = numericEnv('BACKGROUND_REMOVAL_TIMEOUT_MS', 120_000);
  const ompNumThreads = Math.trunc(numericEnv('REMBG_OMP_NUM_THREADS', 2));
  const maxInputPixels = Math.trunc(numericEnv('IMAGE_MAX_INPUT_PIXELS', 16_000_000));
  const maxOutputPixels = Math.trunc(numericEnv('IMAGE_MAX_OUTPUT_PIXELS', 32_000_000));
  const maxOutputBytes = Math.trunc(numericEnv('IMAGE_MAX_OUTPUT_BYTES', 20 * 1024 * 1024));

  const modelPath = backgroundRemovalModelPath(modelDir, model);
  const modelStat = await fs.stat(modelPath);
  if (!modelStat.isFile() || modelStat.size === 0) throw new Error('Modelo rembg não está provisionado.');

  const source = await inspectProcessableImage(inputPath, maxInputPixels);
  const outputPath = path.join(path.dirname(inputPath), 'background-removed.png');
  const timeoutOutputPath = path.join(path.dirname(inputPath), 'background-timeout.png');
  await Promise.all([fs.rm(outputPath, { force: true }), fs.rm(timeoutOutputPath, { force: true })]);

  const deps = { rembgPath, model, modelDir, timeoutMs, ompNumThreads };
  const startedAt = performance.now();
  await runBackgroundRemoval(inputPath, outputPath, deps);
  const elapsedMs = performance.now() - startedAt;

  const validated = await validateBackgroundRemovalOutput(outputPath, source, maxOutputBytes, maxOutputPixels);
  const outputStat = await fs.stat(outputPath);
  const alpha = await inspectAlpha(outputPath);
  if (!alpha.hasMixedAlpha) {
    throw new Error('Saída real não demonstrou fundo transparente e objeto opaco suficientes para o smoke.');
  }

  let timeoutConfirmed = false;
  try {
    await runBackgroundRemoval(inputPath, timeoutOutputPath, { ...deps, timeoutMs: 1 });
  } catch (error) {
    if (error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT') timeoutConfirmed = true;
    else throw error;
  } finally {
    await fs.rm(timeoutOutputPath, { force: true });
  }
  if (!timeoutConfirmed) throw new Error('Timeout real não produziu BUNNYFY_TIMEOUT.');

  await fs.rm(outputPath, { force: true });
  const cleanupConfirmed = !(await fs
    .access(outputPath)
    .then(() => true)
    .catch(() => false));
  if (!cleanupConfirmed) throw new Error('Cleanup da saída do smoke falhou.');

  const report = {
    ok: true,
    model,
    modelBytes: modelStat.size,
    input: { width: source.width, height: source.height, format: source.format },
    output: {
      width: validated.width,
      height: validated.height,
      format: validated.format,
      bytes: outputStat.size,
      transparentRatio: Number(alpha.transparentRatio.toFixed(4)),
      opaqueRatio: Number(alpha.opaqueRatio.toFixed(4)),
    },
    elapsedMs: Math.round(elapsedMs),
    timeoutConfirmed,
    cleanupConfirmed,
  };

  if (reportPath) await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch((error: unknown) => {
  if (error instanceof AppError) {
    process.stderr.write(`[smoke-background-removal] ${error.code}: ${error.message}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`[smoke-background-removal] ${error.message}\n`);
  } else {
    process.stderr.write('[smoke-background-removal] Falha não identificada.\n');
  }
  process.exitCode = 1;
});
