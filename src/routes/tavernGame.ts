import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import type { TempStorage } from '../storage/tempStorage.ts';
import {
  tavernBoardRenderBodySchema,
  tavernHandRenderBodySchema,
  tavernSceneRenderBodySchema,
  type TavernBoardRenderView,
  type TavernHandRenderView,
  type TavernSceneRenderView,
} from '../tavernGame/contracts/renderView.ts';
import { TavernAssetRegistry } from '../tavernGame/rendering/TavernAssetRegistry.ts';
import { VNextBoardRenderer } from '../tavernGame/rendering/VNextBoardRenderer.ts';
import { VNextHandRenderer } from '../tavernGame/rendering/VNextHandRenderer.ts';
import { VNextSceneRenderer } from '../tavernGame/rendering/VNextSceneRenderer.ts';
import { buildMediaDescriptor } from './media.ts';

const BOARD_WIDTH = 1200;
const BOARD_HEIGHT = 940;
const HAND_WIDTH = 720;
const HAND_HEIGHT = 960;
const SCENE_WIDTH = 1200;
const SCENE_HEIGHT = 675;

export interface TavernGameRouteDeps {
  tempStorage: TempStorage;
  apiKeys: ApiKeyAuthSource;
  mediaSigningSecret: string;
  mediaTtlSeconds: number;
  limiter: ConcurrencyLimiter;
  maxOutputBytes: number;
  maxStateBytes: number;
  assets?: TavernAssetRegistry;
  /** Injetáveis em teste, pra não depender do Jimp real. */
  renderBoard?: (view: TavernBoardRenderView) => Promise<Buffer>;
  renderHand?: (view: TavernHandRenderView, page?: number) => Promise<Buffer>;
  renderScene?: (view: TavernSceneRenderView) => Promise<Buffer>;
}

// Mesa, mão e cenas aceitam somente Render Views versionadas e allowlisted:
// nenhum JID, telefone, seed, ordem de deck ou mão adversária cruza a
// fronteira da API.

function assertPayloadSize(value: unknown, maxBytes: number, label: string): void {
  const size = Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
  if (size > maxBytes) {
    throw AppError.payloadTooLarge(`${label} excede o limite permitido.`);
  }
}

function handPageFromQuery(query: unknown): number {
  if (query === undefined || query === null) return 1;
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw AppError.badRequest('Página inválida para renderizar a mão.');
  }
  const rawPage = (query as { page?: unknown }).page;
  if (rawPage === undefined) return 1;
  if (rawPage !== '1' && rawPage !== '2' && rawPage !== 1 && rawPage !== 2) {
    throw AppError.badRequest('Página inválida para renderizar a mão.');
  }
  return Number(rawPage);
}

export function registerTavernGameRoutes(app: FastifyInstance, deps: TavernGameRouteDeps): void {
  const assets = deps.assets ?? new TavernAssetRegistry();
  const boardRenderer = new VNextBoardRenderer({ assets });
  const handRenderer = new VNextHandRenderer({ assets });
  const sceneRenderer = new VNextSceneRenderer({ assets });

  const renderBoard = deps.renderBoard ?? (view => boardRenderer.render(view) as Promise<Buffer>);
  const renderHand = deps.renderHand ?? ((view, page = 1) => handRenderer.render(view, { page }) as Promise<Buffer>);
  const renderScene = deps.renderScene ?? (view => sceneRenderer.render(view) as Promise<Buffer>);

  async function finalizeOutput(
    request: FastifyRequest,
    output: Buffer,
    originalName: string,
    width: number,
    height: number,
  ) {
    if (output.length === 0 || output.length > deps.maxOutputBytes) {
      throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
    }
    const entry = await deps.tempStorage.put(Readable.from(output), {
      mimeType: 'image/png',
      originalName: `${originalName}.png`,
    });
    const media = buildMediaDescriptor(deps, entry, deps.mediaTtlSeconds);
    return okEnvelope({ width, height, media }, envelopeMeta(request));
  }

  app.post('/v1/games/tavern/board', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = tavernBoardRenderBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar a mesa da Taverna.');
    assertPayloadSize(parsed.data.view, deps.maxStateBytes, 'Visão da partida');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de renderização da Taverna ocupada. Tente novamente em instantes.');
    }
    try {
      let output: Buffer;
      try {
        output = await renderBoard(parsed.data.view);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.internal('Não foi possível renderizar a mesa da Taverna.', {
          renderCode: error instanceof Error ? error.name : 'unknown',
        });
      }
      return await finalizeOutput(request, output, 'tavern-board', BOARD_WIDTH, BOARD_HEIGHT);
    } finally {
      deps.limiter.release();
    }
  });

  app.post('/v1/games/tavern/hand', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = tavernHandRenderBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar a mão da Taverna.');
    assertPayloadSize(parsed.data.view, deps.maxStateBytes, 'Visão privada da mão');
    const page = handPageFromQuery(request.query);

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de renderização da Taverna ocupada. Tente novamente em instantes.');
    }
    try {
      let output: Buffer;
      try {
        output = await renderHand(parsed.data.view, page);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.internal('Não foi possível renderizar a mão da Taverna.', {
          renderCode: error instanceof Error ? error.name : 'unknown',
        });
      }
      return await finalizeOutput(request, output, `tavern-hand-p${page}`, HAND_WIDTH, HAND_HEIGHT);
    } finally {
      deps.limiter.release();
    }
  });

  app.post('/v1/games/tavern/scene', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = tavernSceneRenderBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar a cena da Taverna.');
    assertPayloadSize(parsed.data.view, deps.maxStateBytes, 'Visão da cena');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de renderização da Taverna ocupada. Tente novamente em instantes.');
    }
    try {
      let output: Buffer;
      try {
        output = await renderScene(parsed.data.view);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.internal('Não foi possível renderizar a cena da Taverna.', {
          renderCode: error instanceof Error ? error.name : 'unknown',
        });
      }
      return await finalizeOutput(request, output, `tavern-scene-${parsed.data.view.sceneKind}`, SCENE_WIDTH, SCENE_HEIGHT);
    } finally {
      deps.limiter.release();
    }
  });
}
