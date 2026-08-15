import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import {
  LOGO_STICKER_DURATION_SECONDS,
  LOGO_STICKER_FPS,
  LOGO_STICKER_FRAMES,
  renderLogoSticker,
  type LogoStickerResult,
} from '../lib/logoStickerRenderer.ts';
import {
  STICKER_LOGO_MODELS,
  type StickerLogoInput,
} from '../lib/logoStickerVisualAll.ts';
import { STICKER_LOGO_SIZE } from '../lib/logoStickerVisual.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import type { TempStorage } from '../storage/tempStorage.ts';
import { buildMediaDescriptor } from './media.ts';

const ONE_TEXT_MODELS = new Set<string>([
  'darkgreen', 'glitch', 'write', 'advanced', 'typography',
  'pixel', 'neon', 'flag', 'americanflag', 'deleting',
]);

const logoSchema = z.object({
  model: z.enum(STICKER_LOGO_MODELS),
  texts: z.array(z.string().trim().min(1).max(40)).min(1).max(2),
}).strict().superRefine((value, context) => {
  const expected = ONE_TEXT_MODELS.has(value.model) ? 1 : 2;
  if (value.texts.length !== expected) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `O modelo exige ${expected} texto(s).`, path: ['texts'] });
  }
  const max = expected === 1 ? 40 : 28;
  value.texts.forEach((text, index) => {
    if ([...text].length > max) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Texto excede ${max} caracteres.`, path: ['texts', index] });
    }
  });
});

export interface LogoRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  ffmpegPath: string;
  timeoutMs: number;
  maxOutputBytes: number;
  render?: (input: StickerLogoInput) => Promise<LogoStickerResult>;
}

export function registerLogoRoute(app: FastifyInstance, deps: LogoRouteDeps): void {
  app.post('/v1/images/logo', { preHandler: requireBearerAuth(deps.apiKeys, 'images:write') }, async (request) => {
    const parsed = logoSchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para o logotipo.');
    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de logos ocupada. Tente novamente em instantes.');
    }

    try {
      const render = deps.render ?? ((input) => renderLogoSticker(input, {
        ffmpegPath: deps.ffmpegPath,
        timeoutMs: deps.timeoutMs,
        maxOutputBytes: deps.maxOutputBytes,
      }));
      const result = await render(parsed.data);
      if (!Buffer.isBuffer(result.buffer) || result.buffer.length === 0 || result.buffer.length > deps.maxOutputBytes) {
        throw AppError.payloadTooLarge('O sticker animado excede o limite permitido.');
      }
      if (result.mime !== 'image/webp') throw AppError.internal('Formato inválido retornado pelo renderizador.');

      const entry = await deps.tempStorage.put(Readable.from(result.buffer), {
        mimeType: result.mime,
        originalName: `${parsed.data.model}.webp`,
      });
      const media = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
      return okEnvelope({
        model: parsed.data.model,
        animated: true,
        format: 'sticker',
        width: result.width || STICKER_LOGO_SIZE,
        height: result.height || STICKER_LOGO_SIZE,
        fps: result.fps || LOGO_STICKER_FPS,
        frames: result.frames || LOGO_STICKER_FRAMES,
        durationSeconds: result.durationSeconds || LOGO_STICKER_DURATION_SECONDS,
        media,
      }, envelopeMeta(request));
    } finally {
      deps.limiter.release();
    }
  });
}
