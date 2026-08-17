import fs from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import {
  createStickerFromMedia,
  renderStickerCanvas,
  STICKER_SIZE,
  type StickerProcessDeps,
  type StickerProcessResult,
} from '../lib/stickers.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import { generateOpaqueId, type TempStorage } from '../storage/tempStorage.ts';
import { buildMediaDescriptor, OPAQUE_ID_PATTERN } from './media.ts';

const safeText = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  }),
  'texto contém caracteres de controle',
);

const mediaStickerSchema = z.object({
  mediaId: z.string().regex(OPAQUE_ID_PATTERN, 'mediaId inválido'),
  kind: z.enum(['static', 'animated']),
  fit: z.enum(['contain', 'cover']).default('contain'),
}).strict();

const canvasStickerSchema = z.object({
  template: z.enum(['text', 'quote', 'badge']),
  text: safeText(180),
  title: safeText(32).optional(),
  footer: safeText(48).optional(),
  theme: z.enum(['honey', 'midnight', 'mint', 'rose']).default('honey'),
}).strict();

export interface StickerRouteDeps extends StickerProcessDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  maxInputBytes: number;
  processSticker?: typeof createStickerFromMedia;
  renderCanvas?: typeof renderStickerCanvas;
}

function acquireStickerSlot(deps: StickerRouteDeps): void {
  if (!deps.limiter.tryAcquire()) {
    throw AppError.tooManyRequests('Capacidade de criação de figurinhas ocupada. Tente novamente em instantes.');
  }
}

function stickerResponse(
  request: Parameters<typeof envelopeMeta>[0],
  deps: StickerRouteDeps,
  entry: Awaited<ReturnType<TempStorage['put']>>,
  result: StickerProcessResult,
  template?: string,
) {
  return okEnvelope({
    ...(template ? { template } : {}),
    width: result.width,
    height: result.height,
    animated: result.animated,
    durationSeconds: result.durationSeconds,
    media: buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds),
  }, envelopeMeta(request));
}

export function registerStickerRoutes(app: FastifyInstance, deps: StickerRouteDeps): void {
  app.post('/v1/stickers', { preHandler: requireBearerAuth(deps.apiKeys, 'stickers:write') }, async (request) => {
    const parsed = mediaStickerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.badRequest('Informe mediaId, kind e fit válidos para a figurinha.');
    }

    acquireStickerSlot(deps);
    const outputId = generateOpaqueId();
    const outputPath = `${deps.tempStorage.pathFor(outputId)}.webp`;
    let registered = false;
    try {
      const source = await deps.tempStorage.get(parsed.data.mediaId);
      if (!source) throw AppError.notFound('Mídia não encontrada ou expirada.');
      if (source.sizeBytes > deps.maxInputBytes) {
        throw AppError.payloadTooLarge('Mídia excede o limite de entrada para figurinha.');
      }

      const processSticker = deps.processSticker ?? createStickerFromMedia;
      const result = await processSticker(
        source.filePath,
        outputPath,
        parsed.data.kind,
        parsed.data.fit,
        deps,
      );
      const entry = await deps.tempStorage.registerExisting(outputId, outputPath, {
        mimeType: 'image/webp',
        originalName: parsed.data.kind === 'animated' ? 'animated-sticker.webp' : 'sticker.webp',
      });
      registered = true;
      return stickerResponse(request, deps, entry, result);
    } finally {
      deps.limiter.release();
      if (!registered) await fs.rm(outputPath, { force: true }).catch(() => undefined);
    }
  });

  app.post('/v1/stickers/canvas', { preHandler: requireBearerAuth(deps.apiKeys, 'stickers:write') }, async (request) => {
    const parsed = canvasStickerSchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para a figurinha Canvas.');

    acquireStickerSlot(deps);
    try {
      const render = deps.renderCanvas ?? renderStickerCanvas;
      const output = await render(parsed.data);
      if (output.length === 0 || output.length > deps.maxOutputBytes) {
        throw AppError.payloadTooLarge('A figurinha Canvas excede o limite de bytes permitido.');
      }
      const entry = await deps.tempStorage.put(Readable.from(output), {
        mimeType: 'image/webp',
        originalName: `${parsed.data.template}-sticker.webp`,
      });
      return stickerResponse(request, deps, entry, {
        width: STICKER_SIZE,
        height: STICKER_SIZE,
        animated: false,
        durationSeconds: null,
      }, parsed.data.template);
    } finally {
      deps.limiter.release();
    }
  });
}
