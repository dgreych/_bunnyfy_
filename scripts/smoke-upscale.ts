import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import sharp from 'sharp';

import { AppError } from '../src/envelope.ts';
import { inspectProcessableImage } from '../src/lib/backgroundRemoval.ts';
import {
  calculateUpscaleTarget,
  runImageUpscale,
  upscaleOutputSpec,
  validateUpscaleOutput,
  type UpscaleScale,
} from '../src/lib/imageUpscale.ts';

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} inválido.`);
  return value;
}

async function generateInput(inputPath: string): Promise<void> {
  const svg = Buffer.from(`
    <svg width="1000" height="667" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#17324d"/>
          <stop offset="0.5" stop-color="#d28c45"/>
          <stop offset="1" stop-color="#f0dfbd"/>
        </linearGradient>
      </defs>
      <rect width="1000" height="667" fill="url(#g)"/>
      <circle cx="270" cy="290" r="145" fill="#e7c7a1"/>
      <rect x="520" y="160" width="300" height="330" rx="55" fill="#365f4f"/>
      <path d="M80 590 C250 430, 530 710, 920 470" stroke="#f7f1e5" stroke-width="28" fill="none"/>
    </svg>
  `);

  await sharp(svg).jpeg({ quality: 92 }).toFile(inputPath);
}

async function generateTimeoutInput(inputPath: string): Promise<void> {
  const width = 1500;
  const height = 1500;
  const data = Buffer.allocUnsafe(width * height * 3);
  let state = 0x6d2b79f5;
  for (let offset = 0; offset < data.length; offset += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[offset] = state & 0xff;
  }

  await sharp(data, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toFile(inputPath);
}

async function executeScale(
  inputPath: string,
  scale: UpscaleScale,
  deps: {
    timeoutMs: number;
    maxInputPixels: number;
    maxOutputPixels: number;
    maxOutputDimension: number;
    maxOutputBytes: number;
  },
) {
  const source = await inspectProcessableImage(inputPath, deps.maxInputPixels);
  const target = calculateUpscaleTarget(source, scale, deps);
  const spec = upscaleOutputSpec(source.format);
  const outputPath = path.join(path.dirname(inputPath), `upscale-${scale}x.${spec.extension}`);
  await fs.rm(outputPath, { force: true });

  const startedAt = performance.now();
  await runImageUpscale(inputPath, outputPath, source, scale, deps);
  const elapsedMs = performance.now() - startedAt;
  await validateUpscaleOutput(outputPath, target, spec, deps);
  const stat = await fs.stat(outputPath);
  await fs.rm(outputPath, { force: true });

  return {
    scale,
    width: target.width,
    height: target.height,
    format: spec.format,
    bytes: stat.size,
    elapsedMs: Math.round(elapsedMs),
  };
}

async function main(): Promise<void> {
  const smokeDir = process.env.UPSCALE_SMOKE_DIR?.trim() || '/tmp/bunnyfy-upscale-smoke';
  await fs.mkdir(smokeDir, { recursive: true, mode: 0o700 });
  const inputPath = path.join(smokeDir, 'input.jpg');
  const timeoutInputPath = path.join(smokeDir, 'timeout-input.png');
  const reportPath = process.env.UPSCALE_SMOKE_REPORT_PATH?.trim();
  await generateInput(inputPath);

  const deps = {
    timeoutMs: numericEnv('IMAGE_UPSCALE_TIMEOUT_MS', 30_000),
    maxInputPixels: Math.trunc(numericEnv('IMAGE_MAX_INPUT_PIXELS', 16_000_000)),
    maxOutputPixels: Math.trunc(numericEnv('IMAGE_MAX_OUTPUT_PIXELS', 36_000_000)),
    maxOutputDimension: Math.trunc(numericEnv('IMAGE_MAX_OUTPUT_DIMENSION', 16_384)),
    maxOutputBytes: Math.trunc(numericEnv('IMAGE_MAX_OUTPUT_BYTES', 20 * 1024 * 1024)),
  };

  const source = await inspectProcessableImage(inputPath, deps.maxInputPixels);
  const twoX = await executeScale(inputPath, 2, deps);
  const fourX = await executeScale(inputPath, 4, deps);

  await generateTimeoutInput(timeoutInputPath);
  const timeoutSource = await inspectProcessableImage(timeoutInputPath, deps.maxInputPixels);
  const timeoutSpec = upscaleOutputSpec(timeoutSource.format);
  const timeoutPath = path.join(smokeDir, `upscale-timeout.${timeoutSpec.extension}`);
  let timeoutConfirmed = false;
  try {
    await runImageUpscale(timeoutInputPath, timeoutPath, timeoutSource, 4, { ...deps, timeoutMs: 1000 });
  } catch (error) {
    if (error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT') timeoutConfirmed = true;
    else throw error;
  } finally {
    await Promise.all([fs.rm(timeoutPath, { force: true }), fs.rm(timeoutInputPath, { force: true })]);
  }
  if (!timeoutConfirmed) throw new Error('Timeout real do Sharp não produziu BUNNYFY_TIMEOUT.');

  const leftovers = (await fs.readdir(smokeDir)).filter((name) => name.startsWith('upscale-'));
  if (leftovers.length > 0) throw new Error(`Cleanup incompleto: ${leftovers.length} saída(s) de upscale permaneceram.`);

  const report = {
    ok: true,
    source: 'imagem determinística gerada localmente',
    input: {
      width: source.width,
      height: source.height,
      orientedWidth: source.orientedWidth,
      orientedHeight: source.orientedHeight,
      format: source.format,
    },
    twoX,
    fourX,
    timeoutConfirmed,
    cleanupConfirmed: true,
  };

  if (reportPath) await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await fs.rm(inputPath, { force: true });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch((error: unknown) => {
  if (error instanceof AppError) {
    const details = typeof error.internalDetails === 'string' ? ` (${error.internalDetails})` : '';
    process.stderr.write(`[smoke-upscale] ${error.code}: ${error.message}${details}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`[smoke-upscale] ${error.message}\n`);
  } else {
    process.stderr.write('[smoke-upscale] Falha não identificada.\n');
  }
  process.exitCode = 1;
});
