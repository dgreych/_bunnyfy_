import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

import { AppError } from '../envelope.ts';
import { ApiKeyRegistry, type ApiKeyPrincipal } from '../security/apiKeys.ts';
import { verifyMediaAccess } from '../security/mediaSigning.ts';

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyPrincipal?: ApiKeyPrincipal;
  }
}

export type ApiKeyAuthSource = ApiKeyRegistry | readonly string[];

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Compara em tempo constante contra a lista de tokens válidos. Hasheia os
 * dois lados antes de comparar — os digests têm sempre o mesmo tamanho, então
 * não precisa de uma checagem de tamanho antecipada que vazaria o
 * comprimento do token real por timing.
 */
export function isValidApiToken(provided: string, validTokens: readonly string[]): boolean {
  const providedDigest = digest(provided);
  return validTokens.some((token) => timingSafeEqual(digest(token), providedDigest));
}

function extractBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}

function authenticateApiKey(
  provided: string,
  source: ApiKeyAuthSource,
  requiredScope?: string,
): ApiKeyPrincipal | undefined {
  if (source instanceof ApiKeyRegistry) {
    return source.authenticate(provided, requiredScope);
  }

  if (!isValidApiToken(provided, source)) return undefined;
  return { id: 'legacy', environment: 'legacy', scopes: ['*'], legacy: true };
}

/** Preenche `preHandler` de rotas que exigem só Bearer. Lança 401 se ausente/inválido. */
export function requireBearerAuth(source: ApiKeyAuthSource, requiredScope?: string) {
  // eslint-disable-next-line @typescript-eslint/require-await -- assinatura precisa ser async: Fastify trata preHandler de 1 parâmetro sem retorno de Promise como incompleto e nunca chama o handler.
  return async function bearerAuth(request: FastifyRequest): Promise<void> {
    const token = extractBearerToken(request);
    const principal = token ? authenticateApiKey(token, source, requiredScope) : undefined;
    if (!principal) {
      throw AppError.unauthorized();
    }
    request.apiKeyPrincipal = principal;
  };
}

/**
 * Preenche `preHandler` de rotas que aceitam Bearer OU uma URL assinada
 * (`?exp=&sig=`) pro mesmo recurso — usado na leitura de mídia, onde o
 * consumidor pode não conseguir anexar cabeçalho de autorização.
 */
export function requireBearerOrSignedAccess(
  source: ApiKeyAuthSource,
  signingSecret: string,
  requiredScope = 'media:read',
) {
  // eslint-disable-next-line @typescript-eslint/require-await -- mesmo motivo do bearerAuth acima.
  return async function bearerOrSignedAuth(
    request: FastifyRequest<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>,
  ): Promise<void> {
    const token = extractBearerToken(request);
    const principal = token ? authenticateApiKey(token, source, requiredScope) : undefined;
    if (principal) {
      request.apiKeyPrincipal = principal;
      return;
    }

    const { exp, sig } = request.query;
    const { id } = request.params;
    if (!exp || !sig) {
      throw AppError.unauthorized('Requer Authorization Bearer ou assinatura válida (exp/sig).');
    }

    const expiresAt = Number(exp);
    if (!Number.isFinite(expiresAt) || !verifyMediaAccess(id, expiresAt, sig, signingSecret)) {
      throw AppError.unauthorized('Assinatura inválida ou expirada.');
    }
  };
}
