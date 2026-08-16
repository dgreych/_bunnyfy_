import { AppError } from '../envelope.ts';
import { readResponseBodyWithLimit } from './imageGenerationResponse.ts';

export const POLLINATIONS_IMAGE_ENDPOINT = 'https://image.pollinations.ai/prompt';

export interface PollinationsImageDeps {
  apiToken?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  width?: number;
  height?: number;
  model?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  endpoint?: string;
  enhance?: boolean;
}

/**
 * Pollinations.ai é público e não exige token — anônimo aceita ~1
 * requisição a cada 15s por IP, e devolve marca d'água. Registrar em
 * auth.pollinations.ai dá um Bearer token que remove a marca e sobe o
 * limite; opcional aqui de propósito, pra funcionar mesmo antes do
 * cadastro.
 */
export async function requestPollinationsImage(prompt: string, deps: PollinationsImageDeps): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);
  const abortFromCaller = (): void => controller.abort();
  if (deps.signal?.aborted) abortFromCaller();
  else deps.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.endpoint ?? POLLINATIONS_IMAGE_ENDPOINT;
  const params = new URLSearchParams({
    width: String(deps.width ?? 768),
    height: String(deps.height ?? 768),
    model: deps.model ?? 'flux',
    nologo: 'true',
    // Reescrita silenciosa muda o pedido e foi a causa observada de prompt
    // drift. O padrão estrito preserva o texto literal; a compatibilidade
    // antiga só volta mediante configuração explícita.
    enhance: deps.enhance === true ? 'true' : 'false',
  });
  const url = `${base}/${encodeURIComponent(prompt)}?${params.toString()}`;

  try {
    const headers: Record<string, string> = { accept: 'image/*' };
    if (deps.apiToken) headers.authorization = `Bearer ${deps.apiToken}`;

    const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      await response.body?.cancel('upstream-status').catch(() => undefined);
      throw new AppError({
        statusCode: 503,
        code: 'BUNNYFY_UNAVAILABLE',
        message: 'Capacidade de geração de imagem temporariamente indisponível.',
        retryable: response.status >= 500 || response.status === 429,
        internalDetails: { upstreamStatus: response.status },
      });
    }
    const buffer = await readResponseBodyWithLimit(response, deps.maxResponseBytes);
    if (buffer.length === 0) throw AppError.unavailable('Geração de imagem devolveu corpo vazio.');
    return buffer;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw AppError.upstreamTimeout('Tempo esgotado aguardando a geração de imagem.');
    }
    throw new AppError({
      statusCode: 503,
      code: 'BUNNYFY_UNAVAILABLE',
      message: 'Capacidade de geração de imagem temporariamente indisponível.',
      retryable: true,
      internalDetails: { reason: 'upstream_network_error' },
    });
  } finally {
    clearTimeout(timeout);
    deps.signal?.removeEventListener('abort', abortFromCaller);
  }
}
