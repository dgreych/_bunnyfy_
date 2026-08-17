import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import type { ApiKeyAuthSource } from '../plugins/auth.ts';
import { requireBearerAuth } from '../plugins/auth.ts';
import type { TempStorage } from '../storage/tempStorage.ts';
import {
  nexoCharacterRenderViewSchema,
  nexoCircleRenderViewSchema,
  nexoEncounterRenderViewSchema,
  nexoLocationRenderViewSchema,
  type NexoCharacterRenderView,
  type NexoCircleRenderView,
  type NexoEncounterRenderView,
  type NexoLocationRenderView,
} from '../nexoGame/contracts/renderView.ts';
import {
  NEXO_RENDER_DIMENSIONS,
  renderNexoCharacter,
  renderNexoCircle,
  renderNexoEncounter,
  renderNexoLocation,
} from '../nexoGame/rendering/NexoRenderer.ts';
import { buildMediaDescriptor } from './media.ts';

const circleBodySchema = z.object({ view: nexoCircleRenderViewSchema }).strict();
const characterBodySchema = z.object({ view: nexoCharacterRenderViewSchema }).strict();
const encounterBodySchema = z.object({ view: nexoEncounterRenderViewSchema }).strict();
const locationBodySchema = z.object({ view: nexoLocationRenderViewSchema }).strict();

export interface NexoGameRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  maxOutputBytes: number;
  maxStateBytes: number;
  renderCircle?: (view: NexoCircleRenderView) => Promise<Buffer>;
  renderCharacter?: (view: NexoCharacterRenderView) => Promise<Buffer>;
  renderEncounter?: (view: NexoEncounterRenderView) => Promise<Buffer>;
  renderLocation?: (view: NexoLocationRenderView) => Promise<Buffer>;
}

function assertPayloadSize(value: unknown, maxBytes: number): void {
  const size = Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
  if (size > maxBytes) {
    throw AppError.payloadTooLarge('Render View NEXO excede o limite permitido.');
  }
}

async function finalizeOutput(
  request: FastifyRequest,
  deps: NexoGameRouteDeps,
  output: Buffer,
  originalName: string,
) {
  if (output.length === 0 || output.length > deps.maxOutputBytes) {
    throw AppError.payloadTooLarge('Imagem NEXO gerada excede o limite permitido.');
  }

  const entry = await deps.tempStorage.put(Readable.from(output), {
    mimeType: 'image/png',
    originalName: `${originalName}.png`,
  });
  const media = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
  return okEnvelope({ ...NEXO_RENDER_DIMENSIONS, media }, envelopeMeta(request));
}

async function renderWithLimiter<T>(
  request: FastifyRequest,
  deps: NexoGameRouteDeps,
  view: T,
  render: (view: T) => Promise<Buffer>,
  outputName: string,
): Promise<unknown> {
  assertPayloadSize(view, deps.maxStateBytes);
  if (!deps.limiter.tryAcquire()) {
    throw AppError.tooManyRequests('Capacidade de renderização NEXO ocupada. Tente novamente em instantes.');
  }

  try {
    let output: Buffer;
    try {
      output = await render(view);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.internal('Não foi possível renderizar a visão NEXO.', {
        renderCode: error instanceof Error ? error.name : 'unknown',
      });
    }
    return await finalizeOutput(request, deps, output, outputName);
  } finally {
    deps.limiter.release();
  }
}

export function registerNexoGameRoutes(app: FastifyInstance, deps: NexoGameRouteDeps): void {
  const renderCircle = deps.renderCircle ?? renderNexoCircle;
  const renderCharacter = deps.renderCharacter ?? renderNexoCharacter;
  const renderEncounter = deps.renderEncounter ?? renderNexoEncounter;
  const renderLocation = deps.renderLocation ?? renderNexoLocation;

  app.post('/v1/games/nexo/circle', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = circleBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar o círculo NEXO.');
    return renderWithLimiter(request, deps, parsed.data.view, renderCircle, 'nexo-circle');
  });

  app.post('/v1/games/nexo/character', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = characterBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar o personagem NEXO.');
    return renderWithLimiter(request, deps, parsed.data.view, renderCharacter, 'nexo-character');
  });

  app.post('/v1/games/nexo/encounter', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = encounterBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar o encontro NEXO.');
    return renderWithLimiter(request, deps, parsed.data.view, renderEncounter, 'nexo-encounter');
  });

  app.post('/v1/games/nexo/location', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = locationBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar o local NEXO.');
    return renderWithLimiter(request, deps, parsed.data.view, renderLocation, 'nexo-location');
  });
}
