import { Readable } from 'node:stream';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import type { TempStorage } from '../storage/tempStorage.ts';
import { TavernAssetRegistry } from '../tavernGame/rendering/TavernAssetRegistry.ts';
import { VNextBoardRenderer } from '../tavernGame/rendering/VNextBoardRenderer.ts';
import { VNextHandRenderer } from '../tavernGame/rendering/VNextHandRenderer.ts';
import { VNextSceneRenderer } from '../tavernGame/rendering/VNextSceneRenderer.ts';
import { buildMediaDescriptor } from './media.ts';

const BOARD_WIDTH = 1200;
const BOARD_HEIGHT = 940;
const HAND_WIDTH = 1200;
const HAND_HEIGHT = 820;
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
  renderBoard?: (state: unknown, options: { playerNames: Record<string, string> }) => Promise<Buffer>;
  renderHand?: (state: unknown, playerId: string) => Promise<Buffer>;
  renderScene?: (kind: (typeof SCENE_KINDS)[number], payload: Record<string, unknown>) => Promise<Buffer>;
}

// O estado da partida e os payloads de cena são propriedade do domínio da
// Tavern (nazuna-gyomei) e não são revalidados campo a campo aqui — a
// BunnyFy só renderiza pixels a partir do que já foi validado e persistido
// do outro lado. A checagem de tamanho evita abuso; o renderer real (porte
// verbatim dos arquivos `VNext*Renderer` de nazuna-gyomei) é quem decide se
// a forma dos dados é utilizável.
const jsonRecordSchema = z.record(z.string(), z.unknown());

const boardBodySchema = z.object({
  state: jsonRecordSchema,
  playerNames: z.record(z.string(), z.string()).optional(),
});

const handBodySchema = z.object({
  state: jsonRecordSchema,
  playerId: z.string().min(1).max(191),
});

const SCENE_KINDS = ['invite', 'mulligan', 'turn', 'victory'] as const;
const sceneBodySchema = z.object({
  kind: z.enum(SCENE_KINDS),
  payload: jsonRecordSchema.optional(),
});

function assertPayloadSize(value: unknown, maxBytes: number, label: string): void {
  const size = Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
  if (size > maxBytes) {
    throw AppError.payloadTooLarge(`${label} excede o limite permitido.`);
  }
}

export function registerTavernGameRoutes(app: FastifyInstance, deps: TavernGameRouteDeps): void {
  const assets = deps.assets ?? new TavernAssetRegistry();
  const boardRenderer = new VNextBoardRenderer({ assets });
  const handRenderer = new VNextHandRenderer({ assets });
  const sceneRenderer = new VNextSceneRenderer({ assets });

  const renderBoard = deps.renderBoard ?? ((state, options) => boardRenderer.render(state, options) as Promise<Buffer>);
  const renderHand = deps.renderHand ?? ((state, playerId) => handRenderer.render(state, playerId) as Promise<Buffer>);

  const sceneRenderMethods: Record<(typeof SCENE_KINDS)[number], (payload: Record<string, unknown>) => Promise<Buffer>> = {
    invite: payload => sceneRenderer.renderInvite(payload),
    mulligan: payload => sceneRenderer.renderMulligan(payload),
    turn: payload => sceneRenderer.renderTurn(payload),
    victory: payload => sceneRenderer.renderVictory(payload),
  };

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
    const parsed = boardBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar a mesa da Taverna.');
    assertPayloadSize(parsed.data.state, deps.maxStateBytes, 'Estado da partida');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de renderização da Taverna ocupada. Tente novamente em instantes.');
    }
    try {
      let output: Buffer;
      try {
        output = await renderBoard(parsed.data.state, { playerNames: parsed.data.playerNames ?? {} });
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
    const parsed = handBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar a mão da Taverna.');
    assertPayloadSize(parsed.data.state, deps.maxStateBytes, 'Estado da partida');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de renderização da Taverna ocupada. Tente novamente em instantes.');
    }
    try {
      let output: Buffer;
      try {
        output = await renderHand(parsed.data.state, parsed.data.playerId);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.internal('Não foi possível renderizar a mão da Taverna.', {
          renderCode: error instanceof Error ? error.name : 'unknown',
        });
      }
      return await finalizeOutput(request, output, 'tavern-hand', HAND_WIDTH, HAND_HEIGHT);
    } finally {
      deps.limiter.release();
    }
  });

  app.post('/v1/games/tavern/scene', { preHandler: requireBearerAuth(deps.apiKeys, 'canvas:write') }, async request => {
    const parsed = sceneBodySchema.safeParse(request.body);
    if (!parsed.success) throw AppError.badRequest('Dados inválidos para renderizar a cena da Taverna.');
    assertPayloadSize(parsed.data.payload, deps.maxStateBytes, 'Payload da cena');

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de renderização da Taverna ocupada. Tente novamente em instantes.');
    }
    try {
      let output: Buffer;
      try {
        output = deps.renderScene
          ? await deps.renderScene(parsed.data.kind, parsed.data.payload ?? {})
          : await sceneRenderMethods[parsed.data.kind](parsed.data.payload ?? {});
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.internal('Não foi possível renderizar a cena da Taverna.', {
          renderCode: error instanceof Error ? error.name : 'unknown',
        });
      }
      return await finalizeOutput(request, output, `tavern-scene-${parsed.data.kind}`, SCENE_WIDTH, SCENE_HEIGHT);
    } finally {
      deps.limiter.release();
    }
  });
}
