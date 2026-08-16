import { AppError } from '../envelope.ts';
import { decodeBase64Image, readResponseBodyWithLimit } from './imageGenerationResponse.ts';

export const CLOUDFLARE_IMAGE_API_ROOT = 'https://api.cloudflare.com/client/v4/accounts';
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

export interface CloudflareImageDeps {
  accountId: string;
  apiToken: string;
  model: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxOutputBytes: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
}

function imageFromEnvelope(body: Buffer, maxOutputBytes: number): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw AppError.unavailable('Resposta inválida da geração de imagem.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw AppError.unavailable('Resposta inválida da geração de imagem.');
  }

  const envelope = parsed as Record<string, unknown>;
  const result = envelope.result;
  let encoded: string | undefined;
  if (typeof result === 'string') encoded = result;
  else if (result && typeof result === 'object' && !Array.isArray(result)) {
    const image = (result as Record<string, unknown>).image;
    if (typeof image === 'string') encoded = image;
  }
  if (!encoded && typeof envelope.image === 'string') encoded = envelope.image;
  if (!encoded) throw AppError.unavailable('Resposta inválida da geração de imagem.');

  return decodeBase64Image(encoded, maxOutputBytes);
}

export async function requestCloudflareImage(
  prompt: string,
  width: number,
  height: number,
  deps: CloudflareImageDeps,
): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);
  const abortFromCaller = (): void => controller.abort();
  if (deps.signal?.aborted) abortFromCaller();
  else deps.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(width));
  form.append('height', String(height));

  const endpoint = `${CLOUDFLARE_IMAGE_API_ROOT}/${deps.accountId}/ai/run/${deps.model}`;
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.apiToken}`,
        accept: 'application/json, image/*',
      },
      body: form,
      signal: controller.signal,
      redirect: 'error',
    });

    if (!response.ok) {
      await response.body?.cancel('upstream-status').catch(() => undefined);
      throw new AppError({
        statusCode: 503,
        code: 'BUNNYFY_UNAVAILABLE',
        message: 'Capacidade de geração de imagem temporariamente indisponível.',
        retryable: response.status === 429 || response.status >= 500,
        internalDetails: { upstreamStatus: response.status },
      });
    }

    const body = await readResponseBodyWithLimit(response, deps.maxResponseBytes);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType?.startsWith('image/')) return body;
    return imageFromEnvelope(body, deps.maxOutputBytes);
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
