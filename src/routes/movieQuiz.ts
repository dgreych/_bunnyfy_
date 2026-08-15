import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import {
  requestMovieQuiz,
  type MovieQuizDeps,
  type MovieQuizDifficulty,
  type MovieQuizResult,
} from '../lib/movieQuiz.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import type { SlidingWindowRateLimiter } from '../lib/slidingWindowRateLimiter.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';

const bodySchema = z.object({
  category: z.literal('movies'),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
}).strict();

export interface MovieQuizRouteDeps extends MovieQuizDeps {
  enabled: boolean;
  apiKeys: ApiKeyAuthSource;
  limiter: ConcurrencyLimiter;
  rateLimiter: SlidingWindowRateLimiter;
  requestQuiz?: (
    difficulty: MovieQuizDifficulty | undefined,
    deps: MovieQuizDeps,
  ) => Promise<MovieQuizResult>;
}

export function registerMovieQuizRoute(app: FastifyInstance, deps: MovieQuizRouteDeps): void {
  app.post('/v1/games/quiz', { preHandler: requireBearerAuth(deps.apiKeys, 'games:read') }, async (request) => {
    if (!deps.enabled) {
      throw AppError.toolUnavailable('Quiz de cinema indisponível no servidor.');
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.badRequest('Informe category="movies" e difficulty válida, quando usada.');
    }
    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Capacidade de quiz ocupada. Tente novamente em instantes.');
    }

    try {
      if (!deps.rateLimiter.tryConsume()) {
        throw AppError.tooManyRequests('Aguarde alguns segundos antes de pedir outra pergunta.');
      }
      const requestQuiz = deps.requestQuiz ?? requestMovieQuiz;
      const result = await requestQuiz(parsed.data.difficulty, {
        timeoutMs: deps.timeoutMs,
        maxResponseBytes: deps.maxResponseBytes,
        fetchImpl: deps.fetchImpl,
        randomIndex: deps.randomIndex,
      });
      return okEnvelope(result, envelopeMeta(request));
    } finally {
      deps.limiter.release();
    }
  });
}
