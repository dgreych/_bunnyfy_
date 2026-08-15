import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import { requestPollinationsImage } from '../lib/pollinationsImage.ts';
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
  pollinationsApiToken?: string;
  imageGenTimeoutMs: number;
  generateImage?: (prompt: string, width: number, height: number) => Promise<Buffer>;
}

const generateBodySchema = z.object({
  prompt: z.string().min(1).max(600),
  width: z.number().int().min(64).max(1536).optional(),
  height: z.number().int().min(64).max(1536).optional(),
});

/**
 * Endpoint genérico de geração de imagem por prompt livre — reaproveitado
 * pela arte de cartas da Taverna e pelo futuro comando `!imagem` do
 * WhatsApp. Não valida conteúdo do prompt: quem chama (Gyomei) decide
 * quem tem acesso ao comando antes de repassar o pedido.
 */
export function registerImageGenerateRoutes(app: FastifyInstance, deps: ImageGenerateRouteDeps): void {
  const generateImage = deps.generateImage ?? ((prompt: string, width: number, height: number) => requestPollinationsImage(prompt, {
    apiToken: deps.pollinationsApiToken,
    timeoutMs: deps.imageGenTimeoutMs,
    maxResponseBytes: deps.maxOutputBytes * 2,
    width,
    height,
  }));

  app.post('/v1/images/generate', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async (request) => {
    const parsed = generateBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Corpo da requisição inválido para geração de imagem.');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de geração de imagem ocupada. Tente novamente em instantes.');
    }
    try {
      const width = parsed.data.width ?? 768;
      const height = parsed.data.height ?? 768;
      const output = await generateImage(parsed.data.prompt, width, height);
      if (output.length === 0 || output.length > deps.maxOutputBytes) {
        throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
      }
      const entry = await deps.tempStorage.put(Readable.from(output), {
        mimeType: 'image/png',
        originalName: 'generated-image.png',
      });
      const media = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
      return okEnvelope({ media, width, height }, envelopeMeta(request));
    } finally {
      deps.limiter.release();
    }
  });
}
