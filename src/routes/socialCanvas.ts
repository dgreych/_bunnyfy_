import fs from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { ZodType, ZodTypeDef } from 'zod';

import {
  achievementCardSchema,
  compatibilityCardSchema,
  profileCardSchema,
  rankingCardSchema,
  renderSocialCard,
  SOCIAL_CARD_HEIGHT,
  SOCIAL_CARD_MAX_INPUT_PIXELS,
  SOCIAL_CARD_WIDTH,
  welcomeCardSchema,
  type AvatarMap,
  type SocialCardInput,
  type SocialCardKind,
  type WelcomeCardInput,
} from '../canvas/index.ts';
import {
  renderWelcomeCardV2,
  WELCOME_CARD_HEIGHT,
  WELCOME_CARD_WIDTH,
} from '../canvas/renderWelcomeCardV2.ts';
import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import type { TempStorage } from '../storage/tempStorage.ts';
import { buildMediaDescriptor } from './media.ts';

const ALLOWED_AVATAR_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

export interface SocialCanvasRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  maxAvatarBytes: number;
  maxTotalAvatarBytes: number;
  maxOutputBytes: number;
  render?: typeof renderSocialCard;
}

interface SocialRouteDefinition {
  path: string;
  kind: SocialCardKind;
  schema: ZodType<SocialCardInput, ZodTypeDef, unknown>;
}

const ROUTES: SocialRouteDefinition[] = [
  { path: '/v1/images/welcome-card', kind: 'welcome', schema: welcomeCardSchema },
  { path: '/v1/images/profile-card', kind: 'profile', schema: profileCardSchema },
  { path: '/v1/images/compatibility-card', kind: 'compatibility', schema: compatibilityCardSchema },
  { path: '/v1/images/ranking-card', kind: 'ranking', schema: rankingCardSchema },
  { path: '/v1/images/achievement-card', kind: 'achievement', schema: achievementCardSchema },
];

function collectVisualMediaIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectVisualMediaIds(item, ids);
    return ids;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'avatarMediaId' || key === 'backgroundMediaId') && typeof child === 'string') ids.add(child);
    else collectVisualMediaIds(child, ids);
  }
  return ids;
}

async function loadAvatarMap(input: SocialCardInput, deps: SocialCanvasRouteDeps): Promise<AvatarMap> {
  const avatars = new Map<string, Buffer>();
  const mediaIds = collectVisualMediaIds(input);
  let totalAvatarBytes = 0;

  for (const mediaId of mediaIds) {
    const entry = await deps.tempStorage.get(mediaId);
    if (!entry) throw AppError.notFound('Avatar não encontrado ou expirado.');
    if (entry.sizeBytes > deps.maxAvatarBytes) {
      throw AppError.payloadTooLarge('Avatar excede o limite permitido.');
    }

    totalAvatarBytes += entry.sizeBytes;
    if (totalAvatarBytes > deps.maxTotalAvatarBytes) {
      throw AppError.payloadTooLarge('Conjunto de avatares excede o limite permitido.');
    }

    const buffer = await fs.readFile(entry.filePath);
    try {
      const metadata = await sharp(buffer, {
        limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS,
        failOn: 'error',
      }).metadata();
      if (!metadata.format || !ALLOWED_AVATAR_FORMATS.has(metadata.format)) {
        throw new Error('unsupported-avatar-format');
      }
    } catch {
      throw AppError.badRequest('Avatar não é uma imagem válida ou suportada.');
    }
    avatars.set(mediaId, buffer);
  }

  return avatars;
}

function canvasDimensions(kind: SocialCardKind): { width: number; height: number } {
  if (kind === 'welcome') {
    return { width: WELCOME_CARD_WIDTH, height: WELCOME_CARD_HEIGHT };
  }
  return { width: SOCIAL_CARD_WIDTH, height: SOCIAL_CARD_HEIGHT };
}

const defaultRender: typeof renderSocialCard = async (kind, input, avatars) => {
  if (kind === 'welcome') {
    return renderWelcomeCardV2(input as WelcomeCardInput, avatars);
  }
  return renderSocialCard(kind, input, avatars);
};

export function registerSocialCanvasRoutes(app: FastifyInstance, deps: SocialCanvasRouteDeps): void {
  const render = deps.render ?? defaultRender;

  for (const definition of ROUTES) {
    app.post(definition.path, { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async (request) => {
      const parsed = definition.schema.safeParse(request.body);
      if (!parsed.success) {
        throw AppError.badRequest('Dados inválidos para o modelo visual.');
      }

      if (!deps.limiter.tryAcquire()) {
        throw AppError.tooManyRequests('Capacidade de renderização ocupada. Tente novamente em instantes.');
      }

      try {
        const avatars = await loadAvatarMap(parsed.data, deps);
        let output: Buffer;
        try {
          output = await render(definition.kind, parsed.data, avatars);
        } catch (error) {
          throw AppError.internal('Não foi possível renderizar o card.', {
            renderCode: error instanceof Error ? error.name : 'unknown',
          });
        }

        if (output.length === 0 || output.length > deps.maxOutputBytes) {
          throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
        }

        const entry = await deps.tempStorage.put(Readable.from(output), {
          mimeType: 'image/png',
          originalName: `${definition.kind}.png`,
        });
        const media = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
        const dimensions = canvasDimensions(definition.kind);

        return okEnvelope(
          {
            template: definition.kind,
            width: dimensions.width,
            height: dimensions.height,
            media,
          },
          envelopeMeta(request),
        );
      } finally {
        deps.limiter.release();
      }
    });
  }
}
