import fs from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import {
  inspectProcessableImage,
  runBackgroundRemoval,
  validateBackgroundRemovalOutput,
  type BackgroundRemovalDeps,
} from '../lib/backgroundRemoval.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import {
  calculateUpscaleTarget,
  runImageUpscale,
  upscaleOutputSpec,
  validateUpscaleOutput,
  type UpscaleScale,
} from '../lib/imageUpscale.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import { generateOpaqueId, type TempStorage } from '../storage/tempStorage.ts';
import { buildMediaDescriptor, OPAQUE_ID_PATTERN } from './media.ts';

const mediaBodySchema = z.object({
  mediaId: z.string().regex(OPAQUE_ID_PATTERN, 'mediaId inválido'),
});

const upscaleBodySchema = mediaBodySchema.extend({
  scale: z.union([z.literal(2), z.literal(4)]),
});

export interface ImageProcessingRouteDeps extends BackgroundRemovalDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  maxInputPixels: number;
  maxOutputPixels: number;
  maxOutputDimension: number;
  maxOutputBytes: number;
  upscaleTimeoutMs: number;
  removeBackground?: typeof runBackgroundRemoval;
  upscaleImage?: typeof runImageUpscale;
}

function acquireImageSlot(deps: ImageProcessingRouteDeps): void {
  if (!deps.limiter.tryAcquire()) {
    throw AppError.tooManyRequests('Capacidade de processamento de imagens ocupada. Tente novamente em instantes.');
  }
}

export function registerImageProcessingRoutes(app: FastifyInstance, deps: ImageProcessingRouteDeps): void {
  app.post('/v1/images/remove-background', { preHandler: requireBearerAuth(deps.apiKeys, 'images:write') }, async (request) => {
    const parsed = mediaBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.badRequest('Informe um mediaId válido.');
    }

    acquireImageSlot(deps);
    const outputId = generateOpaqueId();
    const outputPath = `${deps.tempStorage.pathFor(outputId)}.png`;
    let registered = false;

    try {
      const sourceEntry = await deps.tempStorage.get(parsed.data.mediaId);
      if (!sourceEntry) {
        throw AppError.notFound('Imagem não encontrada ou expirada.');
      }

      const sourceInfo = await inspectProcessableImage(sourceEntry.filePath, deps.maxInputPixels);
      const removeBackground = deps.removeBackground ?? runBackgroundRemoval;
      await removeBackground(sourceEntry.filePath, outputPath, deps);

      const outputInfo = await validateBackgroundRemovalOutput(
        outputPath,
        sourceInfo,
        deps.maxOutputBytes,
        deps.maxOutputPixels,
      );

      const outputEntry = await deps.tempStorage.registerExisting(outputId, outputPath, {
        mimeType: 'image/png',
        originalName: 'background-removed.png',
      });
      registered = true;

      return okEnvelope(
        {
          width: outputInfo.width,
          height: outputInfo.height,
          media: buildMediaDescriptor(deps, outputEntry, deps.mediaTtlSeconds),
        },
        envelopeMeta(request),
      );
    } finally {
      deps.limiter.release();
      if (!registered) {
        await fs.rm(outputPath, { force: true }).catch(() => undefined);
      }
    }
  });

  app.post('/v1/images/upscale', { preHandler: requireBearerAuth(deps.apiKeys, 'images:write') }, async (request) => {
    const parsed = upscaleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.badRequest('Informe mediaId válido e scale igual a 2 ou 4.');
    }

    acquireImageSlot(deps);
    const scale: UpscaleScale = parsed.data.scale;
    let outputPath: string | undefined;
    let registered = false;

    try {
      const sourceEntry = await deps.tempStorage.get(parsed.data.mediaId);
      if (!sourceEntry) {
        throw AppError.notFound('Imagem não encontrada ou expirada.');
      }

      const sourceInfo = await inspectProcessableImage(sourceEntry.filePath, deps.maxInputPixels);
      const upscaleDeps = {
        timeoutMs: deps.upscaleTimeoutMs,
        maxInputPixels: deps.maxInputPixels,
        maxOutputPixels: deps.maxOutputPixels,
        maxOutputDimension: deps.maxOutputDimension,
        maxOutputBytes: deps.maxOutputBytes,
      };
      const target = calculateUpscaleTarget(sourceInfo, scale, upscaleDeps);
      const outputSpec = upscaleOutputSpec(sourceInfo.format);
      const outputId = generateOpaqueId();
      outputPath = `${deps.tempStorage.pathFor(outputId)}.${outputSpec.extension}`;

      const upscaleImage = deps.upscaleImage ?? runImageUpscale;
      await upscaleImage(sourceEntry.filePath, outputPath, sourceInfo, scale, upscaleDeps);
      await validateUpscaleOutput(outputPath, target, outputSpec, upscaleDeps);

      const outputEntry = await deps.tempStorage.registerExisting(outputId, outputPath, {
        mimeType: outputSpec.mimeType,
        originalName: `upscaled-${scale}x.${outputSpec.extension}`,
      });
      registered = true;

      return okEnvelope(
        {
          width: target.width,
          height: target.height,
          scale,
          media: buildMediaDescriptor(deps, outputEntry, deps.mediaTtlSeconds),
        },
        envelopeMeta(request),
      );
    } finally {
      deps.limiter.release();
      if (!registered && outputPath) {
        await fs.rm(outputPath, { force: true }).catch(() => undefined);
      }
    }
  });
}
