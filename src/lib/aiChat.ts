import { AppError } from '../envelope.ts';

export const NVIDIA_CHAT_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

export type AiChatRole = 'system' | 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatControls {
  temperature: number;
  maxOutputTokens: number;
}

export interface AiChatUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type AiChatFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'other' | null;

export interface AiChatResult {
  text: string;
  finishReason: AiChatFinishReason;
  usage: AiChatUsage | null;
}

export interface AiChatDeps {
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Somente para teste unitário; o runtime usa sempre o endpoint fixo. */
  endpoint?: string;
}

type StreamReadResult = {
  done: boolean;
  value?: Uint8Array;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function discardResponse(response: Response, reason: string): Promise<void> {
  await response.body?.cancel(reason).catch(() => undefined);
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await discardResponse(response, 'response-too-large');
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Capacidade de IA temporariamente indisponível.',
      retryable: false,
      internalDetails: { reason: 'upstream_response_too_large' },
    });
  }

  if (!response.body) {
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Capacidade de IA temporariamente indisponível.',
      retryable: true,
      internalDetails: { reason: 'upstream_response_without_body' },
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const result = (await reader.read()) as StreamReadResult;
      if (result.done) break;
      if (!result.value) continue;

      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('response-too-large').catch(() => undefined);
        throw new AppError({
          statusCode: 503,
          code: 'BUNNYFY_UNAVAILABLE',
          message: 'Capacidade de IA temporariamente indisponível.',
          retryable: false,
          internalDetails: { reason: 'upstream_response_too_large' },
        });
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function upstreamStatusError(status: number): AppError {
  const internalDetails = { upstreamStatus: status };

  if (status === 408 || status === 504) {
    return new AppError({
      statusCode: 504,
      code: 'BUNNYFY_TIMEOUT',
      message: 'Tempo esgotado ao processar a solicitação de IA.',
      retryable: true,
      internalDetails,
    });
  }

  if (status === 429) {
    return new AppError({
      statusCode: 429,
      code: 'BUNNYFY_RATE_LIMITED',
      message: 'Capacidade de IA temporariamente limitada, tente novamente em instantes.',
      retryable: true,
      internalDetails,
    });
  }

  if (status === 401 || status === 403 || status === 404 || status === 410) {
    return new AppError({
      statusCode: 503,
      code: 'BUNNYFY_TOOL_UNAVAILABLE',
      message: 'Capacidade de IA indisponível no servidor.',
      retryable: false,
      internalDetails,
    });
  }

  return new AppError({
    statusCode: 503,
    code: 'BUNNYFY_UNAVAILABLE',
    message: 'Capacidade de IA temporariamente indisponível.',
    retryable: status >= 500 || status === 409 || status === 425,
    internalDetails,
  });
}

function normalizeFinishReason(value: unknown): AiChatFinishReason {
  if (value === null || value === undefined) return null;
  if (value === 'stop' || value === 'length' || value === 'content_filter' || value === 'tool_calls') {
    return value;
  }
  return 'other';
}

function parseUsage(value: unknown): AiChatUsage | null {
  if (!isRecord(value)) return null;
  const inputTokens = value.prompt_tokens;
  const outputTokens = value.completion_tokens;
  const totalTokens = value.total_tokens;

  if (
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    !Number.isSafeInteger(totalTokens) ||
    (inputTokens as number) < 0 ||
    (outputTokens as number) < 0 ||
    (totalTokens as number) < 0
  ) {
    return null;
  }

  return {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number,
  };
}

function parseChatResponse(rawBody: string): AiChatResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Capacidade de IA temporariamente indisponível.',
      retryable: true,
      internalDetails: { reason: 'upstream_invalid_json' },
    });
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.choices) || !isRecord(parsed.choices[0])) {
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Capacidade de IA temporariamente indisponível.',
      retryable: true,
      internalDetails: { reason: 'upstream_invalid_shape' },
    });
  }

  const firstChoice = parsed.choices[0];
  const message = firstChoice.message;
  const content = isRecord(message) ? message.content : undefined;

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Capacidade de IA temporariamente indisponível.',
      retryable: true,
      internalDetails: { reason: 'upstream_empty_completion' },
    });
  }

  return {
    text: content,
    finishReason: normalizeFinishReason(firstChoice.finish_reason),
    usage: parseUsage(parsed.usage),
  };
}

/**
 * Adaptador interno do provedor. O consumidor nunca escolhe endpoint, modelo,
 * headers nem credencial; todos esses valores pertencem ao ambiente BunnyFy.
 */
export async function requestAiChat(
  messages: readonly AiChatMessage[],
  controls: AiChatControls,
  deps: AiChatDeps,
): Promise<AiChatResult> {
  const apiKey = deps.apiKey?.trim();
  const model = deps.model?.trim();
  if (!apiKey || !model) {
    throw AppError.toolUnavailable('Capacidade de IA indisponível no servidor.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (deps.signal?.aborted) {
    abortFromCaller();
  } else {
    deps.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(deps.endpoint ?? NVIDIA_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: controls.temperature,
        max_tokens: controls.maxOutputTokens,
        stream: false,
      }),
      signal: controller.signal,
      redirect: 'error',
    });

    if (!response.ok) {
      await discardResponse(response, 'upstream-status');
      throw upstreamStatusError(response.status);
    }

    return parseChatResponse(await readResponseWithLimit(response, deps.maxResponseBytes));
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (timedOut) {
      throw AppError.upstreamTimeout('Tempo esgotado ao processar a solicitação de IA.');
    }

    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw AppError.unavailable('Solicitação de IA cancelada.');
    }

    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Capacidade de IA temporariamente indisponível.',
      retryable: true,
      internalDetails: { reason: 'upstream_network_error' },
    });
  } finally {
    clearTimeout(timeout);
    deps.signal?.removeEventListener('abort', abortFromCaller);
  }
}
