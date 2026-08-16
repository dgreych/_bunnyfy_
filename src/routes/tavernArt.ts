import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import type { ImageGenerator } from '../lib/imageGeneration.ts';
import { validateGeneratedImage } from '../lib/imageGenerationResponse.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import type { TempStorage } from '../storage/tempStorage.ts';
import { buildMediaDescriptor } from './media.ts';

export interface TavernArtRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  maxOutputBytes: number;
  generateImage: ImageGenerator;
}

const CLASS_PROMPT_STYLE: Record<string, string> = {
  GUARDIAN: 'cold blued steel and grey stone, stalwart defensive pose, protective ward',
  EXILE: 'burnt ember and rusted iron, aggressive weathered leather, quick and dangerous',
  STORM: 'deep violet arcane lightning, ritual circles, crackling energy',
  ORACLE: 'aged parchment and candlelight, mystic tavern relic',
  SHAMAN: 'moss, bone totems and firelight, primal ritual craft',
  PROFANE: 'shadow and dried blood, forbidden ritual iconography',
};

const artBodySchema = z.object({
  cardName: z.string().min(1).max(120),
  classId: z.string().min(1).max(40).optional(),
  flavor: z.string().max(300).optional(),
});

export function buildCardArtPrompt(input: { cardName: string; classId?: string; flavor?: string }): string {
  const style = (input.classId && CLASS_PROMPT_STYLE[input.classId.toUpperCase()]) || 'dark fantasy tavern relic';
  const flavor = input.flavor ? `, ${input.flavor}` : '';
  return (
    `dark fantasy trading card game illustration of "${input.cardName}"${flavor}, ${style}, ` +
    'moody torchlit ritual tavern atmosphere, painted concept art, single centered subject, ' +
    'dramatic lighting, high detail, no text, no watermark, no signature, no border, no frame'
  );
}

export function registerTavernArtRoutes(app: FastifyInstance, deps: TavernArtRouteDeps): void {
  app.post('/v1/games/tavern/art', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async (request) => {
    const parsed = artBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Corpo da requisição inválido para geração de arte.');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de geração de arte da Taverna ocupada. Tente novamente em instantes.');
    }
    try {
      const prompt = buildCardArtPrompt(parsed.data);
      const output = await deps.generateImage({ prompt, width: 768, height: 1024 });
      const sniffed = validateGeneratedImage(output, deps.maxOutputBytes);
      const extension = sniffed.format === 'jpeg' ? 'jpg' : sniffed.format;
      const entry = await deps.tempStorage.put(Readable.from(output), {
        mimeType: sniffed.mime,
        originalName: `tavern-card-art.${extension}`,
      });
      const media = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
      return okEnvelope({ media }, envelopeMeta(request));
    } finally {
      deps.limiter.release();
    }
  });
}
