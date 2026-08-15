import { AppError } from '../envelope.ts';

export const POLLINATIONS_IMAGE_ENDPOINT = 'https://image.pollinations.ai/prompt';

export interface PollinationsImageDeps {
  apiToken?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  width?: number;
  height?: number;
  model?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  endpoint?: string;
}

type StreamReadResult = {
  done: boolean;
  value?: Uint8Array;
};

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel('response-too-large').catch(() => undefined);
    throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
  }
  if (!response.body) throw AppError.unavailable('Resposta da geração de imagem sem corpo.');

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
        throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
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
    // O modelo segue prompt em inglês com mais fidelidade; enhance deixa
    // o próprio Pollinations reescrever/detalhar o prompt antes de gerar,
    // o que também ajuda quando o texto original não está em inglês.
    enhance: 'true',
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
    const buffer = await readBodyWithLimit(response, deps.maxResponseBytes);
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
