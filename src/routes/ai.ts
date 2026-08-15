import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import {
  requestAiChat,
  type AiChatControls,
  type AiChatDeps,
  type AiChatMessage,
  type AiChatResult,
} from '../lib/aiChat.ts';
import { bindClientAbort } from '../lib/clientAbort.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import type { KeyedConcurrencyLimiter, KeyedSlidingWindowRateLimiter } from '../lib/keyedLimiters.ts';
import type { SlidingWindowRateLimiter } from '../lib/slidingWindowRateLimiter.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';

export interface AiChatRouteDeps extends AiChatDeps {
  enabled: boolean;
  apiKeys: ApiKeyAuthSource;
  limiter: ConcurrencyLimiter;
  rateLimiter: SlidingWindowRateLimiter;
  consumerLimiter: KeyedConcurrencyLimiter;
  consumerRateLimiter: KeyedSlidingWindowRateLimiter;
  maxMessages: number;
  maxMessageChars: number;
  maxTotalChars: number;
  maxOutputTokens: number;
  allowedModels: readonly string[];
  requestChat?: (
    messages: readonly AiChatMessage[],
    controls: AiChatControls,
    deps: AiChatDeps,
  ) => Promise<AiChatResult>;
}

function buildRequestSchema(deps: AiChatRouteDeps) {
  const messageSchema = z
    .object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z
        .string()
        .min(1)
        .max(deps.maxMessageChars)
        .refine((content) => content.trim().length > 0, 'mensagem vazia'),
    })
    .strict();

  return z
    .object({
      messages: z.array(messageSchema).min(1).max(deps.maxMessages),
      temperature: z.number().min(0).max(1).default(0.7),
      maxOutputTokens: z.number().int().positive().max(deps.maxOutputTokens).default(deps.maxOutputTokens),
      model: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9._/-]+$/)
        .refine((model) => deps.allowedModels.includes(model), 'modelo não permitido')
        .optional(),
    })
    .strict()
    .refine(
      (value) => value.messages.reduce((total, message) => total + message.content.length, 0) <= deps.maxTotalChars,
      { message: 'Conteúdo total das mensagens excede o limite permitido.' },
    )
    .refine(
      (value) =>
        value.messages.every((message, index) => message.role !== 'system' || index === 0) &&
        value.messages.filter((message) => message.role === 'system').length <= 1,
      { message: 'A mensagem de sistema, quando usada, deve ser única e ocupar a primeira posição.' },
    )
    .refine((value) => value.messages.at(-1)?.role === 'user', {
      message: 'A última mensagem precisa ser do usuário.',
    });
}

export function registerAiChatRoutes(app: FastifyInstance, deps: AiChatRouteDeps): void {
  const requestSchema = buildRequestSchema(deps);

  app.post('/v1/ai/chat/completions', { preHandler: requireBearerAuth(deps.apiKeys, 'ai:chat') }, async (request, reply) => {
    if (!deps.enabled || !deps.apiKey || !deps.model) {
      throw AppError.toolUnavailable('Capacidade de IA indisponível no servidor.');
    }

    const parsedBody = requestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      throw AppError.badRequest('Corpo inválido para a conversa de IA.', parsedBody.error.issues);
    }

    const consumerId = request.apiKeyPrincipal?.id;
    if (consumerId === undefined) {
      throw AppError.unauthorized();
    }

    if (!deps.consumerLimiter.tryAcquire(consumerId)) {
      throw AppError.tooManyRequests('Limite de conversas simultâneas atingido, tente novamente em instantes.');
    }

    if (!deps.limiter.tryAcquire()) {
      deps.consumerLimiter.release(consumerId);
      throw AppError.tooManyRequests('Limite de conversas simultâneas atingido, tente novamente em instantes.');
    }

    const inputChars = parsedBody.data.messages.reduce((total, message) => total + message.content.length, 0);
    const clientAbort = bindClientAbort(request.raw, reply.raw);

    try {
      if (!deps.consumerRateLimiter.tryConsume(consumerId)) {
        throw AppError.tooManyRequests('Limite temporário de conversas atingido, tente novamente em instantes.');
      }

      if (!deps.rateLimiter.tryConsume()) {
        throw AppError.tooManyRequests('Limite temporário de conversas atingido, tente novamente em instantes.');
      }

      const requestChat = deps.requestChat ?? requestAiChat;
      const providerDeps: AiChatDeps = {
        apiKey: deps.apiKey,
        model: parsedBody.data.model ?? deps.model,
        timeoutMs: deps.timeoutMs,
        maxResponseBytes: deps.maxResponseBytes,
        fetchImpl: deps.fetchImpl,
        endpoint: deps.endpoint,
        signal: clientAbort.signal,
      };
      const result = await requestChat(
        parsedBody.data.messages,
        {
          temperature: parsedBody.data.temperature,
          maxOutputTokens: parsedBody.data.maxOutputTokens,
        },
        providerDeps,
      );

      request.log.info(
        {
          capability: 'aiChat',
          consumerId: request.apiKeyPrincipal?.id,
          consumerEnvironment: request.apiKeyPrincipal?.environment,
          inputMessages: parsedBody.data.messages.length,
          inputChars,
          outputChars: result.text.length,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        },
        'capacidade concluída',
      );

      return okEnvelope(
        {
          text: result.text,
          finishReason: result.finishReason,
          usage: result.usage,
        },
        envelopeMeta(request),
      );
    } finally {
      clientAbort.detach();
      deps.limiter.release();
      deps.consumerLimiter.release(consumerId);
    }
  });
}
