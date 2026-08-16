import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import { assessImagePromptSafety, type ImageModerationDeps, type ImageModerationResult } from '../lib/imageModeration.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import type { ImageGenerator } from '../lib/imageGeneration.ts';
import { validateGeneratedImage } from '../lib/imageGenerationResponse.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import type { TempStorage } from '../storage/tempStorage.ts';
import { buildMediaDescriptor } from './media.ts';

export interface ImageGenerateRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  maxOutputBytes: number;
  generateImage: ImageGenerator;
  moderation: ImageModerationDeps;
  assessSafety?: (prompt: string, deps: ImageModerationDeps) => Promise<ImageModerationResult>;
}

const generateBodySchema = z.object({
  prompt: z.string().min(1).max(600),
  width: z.number().int().min(64).max(1536).optional(),
  height: z.number().int().min(64).max(1536).optional(),
});

/**
 * Endpoint genérico de geração de imagem por prompt livre — reaproveitado
 * pela arte de cartas da Taverna e pelo comando `!imagem` do WhatsApp.
 * Todo prompt passa pelo guardrail de conteúdo (assessImagePromptSafety)
 * antes de qualquer geração — bloqueia sexualização de menores sempre, e
 * conteúdo sexual explícito adulto em geral, independente de quem chama.
 */
export function registerImageGenerateRoutes(app: FastifyInstance, deps: ImageGenerateRouteDeps): void {
  const assessSafety = deps.assessSafety ?? assessImagePromptSafety;

  app.post('/v1/images/generate', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async (request) => {
    const parsed = generateBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Corpo da requisição inválido para geração de imagem.');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de geração de imagem ocupada. Tente novamente em instantes.');
    }
    try {
      const moderation = await assessSafety(parsed.data.prompt, deps.moderation);
      if (!moderation.allowed) {
        request.log.warn({ capability: 'imageGenerate', verdict: moderation.verdict }, 'prompt de imagem recusado pelo guardrail de conteúdo');
        throw AppError.badRequest('Esse pedido de imagem não pode ser atendido.');
      }

      const width = parsed.data.width ?? 768;
      const height = parsed.data.height ?? 768;
      const output = await deps.generateImage({ prompt: parsed.data.prompt, width, height });
      const sniffed = validateGeneratedImage(output, deps.maxOutputBytes);
      const extension = sniffed.format === 'jpeg' ? 'jpg' : sniffed.format;
      const entry = await deps.tempStorage.put(Readable.from(output), {
        mimeType: sniffed.mime,
        originalName: `generated-image.${extension}`,
      });
      const media = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
      return okEnvelope({ media, width, height }, envelopeMeta(request));
    } finally {
      deps.limiter.release();
    }
  });
}
