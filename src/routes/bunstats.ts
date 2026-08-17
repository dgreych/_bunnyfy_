import type { FastifyInstance } from 'fastify';

import { envelopeMeta } from '../context.ts';
import { okEnvelope } from '../envelope.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';

export interface BunstatsRouteDeps {
  apiKeys: ApiKeyAuthSource;
}

/**
 * Canário transitório (BUN-020 retry) só para provar o deploy via GitHub
 * Actions do lado da BunnyFy. Fora de docs/catálogo público; remover após
 * o aceite.
 */
export function registerBunstatsRoutes(app: FastifyInstance, deps: BunstatsRouteDeps): void {
  app.get('/v1/_internal/bunstats', { preHandler: requireBearerAuth(deps.apiKeys) }, (request) =>
    okEnvelope({ nonce: 'BUNSTATS_ACTIONS_20260816_0011' }, envelopeMeta(request)));
}
