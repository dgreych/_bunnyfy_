import { createHash } from 'node:crypto';

import { AppError } from '../envelope.ts';
import { requestCloudflareImage } from './cloudflareImage.ts';
import { validateGeneratedImage } from './imageGenerationResponse.ts';
import { requestPollinationsImage } from './pollinationsImage.ts';

export type ImageGenerationMode = 'pollinations' | 'cloudflare-canary' | 'cloudflare-primary';

export interface ImageGenerationInput {
  prompt: string;
  width: number;
  height: number;
  signal?: AbortSignal;
}

export type ImageGenerator = (input: ImageGenerationInput) => Promise<Buffer>;

export interface ImageGenerationDeps {
  mode: ImageGenerationMode;
  timeoutMs: number;
  maxOutputBytes: number;
  canaryPercent: number;
  pollinationsApiToken?: string;
  pollinationsEnhance: boolean;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  cloudflareModel: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

function canUseCloudflareDimensions(width: number, height: number): boolean {
  return width >= 256 && width <= 1920 && height >= 256 && height <= 1920;
}

export function imageGenerationCanaryBucket(input: Pick<ImageGenerationInput, 'prompt' | 'width' | 'height'>): number {
  const digest = createHash('sha256')
    .update(input.prompt)
    .update('\0')
    .update(String(input.width))
    .update('x')
    .update(String(input.height))
    .digest();
  return digest.readUInt16BE(0) % 100;
}

function shouldTryCloudflare(input: ImageGenerationInput, deps: ImageGenerationDeps): boolean {
  if (deps.mode === 'pollinations' || !canUseCloudflareDimensions(input.width, input.height)) return false;
  if (deps.mode === 'cloudflare-primary') return true;
  return imageGenerationCanaryBucket(input) < deps.canaryPercent;
}

export function createImageGenerator(deps: ImageGenerationDeps): ImageGenerator {
  if (deps.mode !== 'pollinations' && (!deps.cloudflareAccountId || !deps.cloudflareApiToken)) {
    throw AppError.internal('Configuração interna da geração de imagem está incompleta.');
  }

  const pollinations = async (input: ImageGenerationInput): Promise<Buffer> => {
    const output = await requestPollinationsImage(input.prompt, {
      apiToken: deps.pollinationsApiToken,
      timeoutMs: deps.timeoutMs,
      maxResponseBytes: deps.maxOutputBytes,
      width: input.width,
      height: input.height,
      enhance: deps.pollinationsEnhance,
      fetchImpl: deps.fetchImpl,
      signal: input.signal,
    });
    validateGeneratedImage(output, deps.maxOutputBytes);
    return output;
  };

  const cloudflare = async (input: ImageGenerationInput): Promise<Buffer> => {
    const output = await requestCloudflareImage(input.prompt, input.width, input.height, {
      accountId: deps.cloudflareAccountId!,
      apiToken: deps.cloudflareApiToken!,
      model: deps.cloudflareModel,
      timeoutMs: deps.timeoutMs,
      maxResponseBytes: deps.maxOutputBytes * 2,
      maxOutputBytes: deps.maxOutputBytes,
      fetchImpl: deps.fetchImpl,
      signal: input.signal,
    });
    validateGeneratedImage(output, deps.maxOutputBytes);
    return output;
  };

  return async (input) => {
    if (!shouldTryCloudflare(input, deps)) return pollinations(input);

    try {
      return await cloudflare(input);
    } catch (error) {
      if (input.signal?.aborted || !(error instanceof AppError) || !error.retryable) throw error;
      return pollinations(input);
    }
  };
}
