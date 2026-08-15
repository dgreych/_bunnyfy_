const baseUrl = process.env.BUNNYFY_SMOKE_BASE_URL?.trim();
const token = process.env.BUNNYFY_SMOKE_TOKEN?.trim();
const timeoutMs = Number(process.env.BUNNYFY_SMOKE_TIMEOUT_MS ?? 150_000);

if (!baseUrl || !token) {
  throw new Error('Defina BUNNYFY_SMOKE_BASE_URL e BUNNYFY_SMOKE_TOKEN no ambiente privado.');
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error('BUNNYFY_SMOKE_TIMEOUT_MS inválido.');
}

let endpoint: URL;
try {
  endpoint = new URL('/v1/ai/chat/completions', baseUrl);
} catch {
  throw new Error('BUNNYFY_SMOKE_BASE_URL inválida.');
}
if (endpoint.username || endpoint.password) {
  throw new Error('BUNNYFY_SMOKE_BASE_URL não pode conter credenciais.');
}
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
if (
  endpoint.protocol !== 'https:' &&
  !(endpoint.protocol === 'http:' && loopbackHosts.has(endpoint.hostname.toLowerCase()))
) {
  throw new Error('BUNNYFY_SMOKE_BASE_URL exige HTTPS ou HTTP local.');
}

const canonicalErrorCodes = new Set([
  'BUNNYFY_AUTH_FAILED',
  'BUNNYFY_BAD_REQUEST',
  'BUNNYFY_RATE_LIMITED',
  'BUNNYFY_TOOL_UNAVAILABLE',
  'BUNNYFY_TIMEOUT',
  'BUNNYFY_UNAVAILABLE',
  'BUNNYFY_INTERNAL_ERROR',
]);
const canonicalFinishReasons = new Set(['stop', 'length', 'content_filter', 'tool_calls', 'other']);

async function readLimitedText(response: Response, maxBytes = 1024 * 1024): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel('smoke-response-too-large').catch(() => undefined);
    throw new Error('Resposta do smoke acima do limite.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const result = (await reader.read()) as { done: boolean; value?: Uint8Array };
      if (result.done) break;
      if (!result.value) continue;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('smoke-response-too-large').catch(() => undefined);
        throw new Error('Resposta do smoke acima do limite.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const startedAt = performance.now();

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'Este é um teste sintético de disponibilidade.' },
        { role: 'user', content: 'Responda somente com OK.' },
      ],
      temperature: 0,
      maxOutputTokens: 16,
    }),
    redirect: 'error',
    signal: controller.signal,
  });

  const rawBody = await readLimitedText(response);
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = undefined;
  }

  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
  const data =
    record?.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : undefined;
  const error =
    record?.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : undefined;
  const text = typeof data?.text === 'string' ? data.text : '';

  if (!response.ok || record?.ok !== true || text.trim().length === 0) {
    console.error(
      JSON.stringify({
        ok: false,
        status: response.status,
        errorCode:
          typeof error?.code === 'string' && canonicalErrorCodes.has(error.code)
            ? error.code
            : 'INVALID_SMOKE_RESPONSE',
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        responseChars: text.length,
        finishReason:
          typeof data?.finishReason === 'string' && canonicalFinishReasons.has(data.finishReason)
            ? data.finishReason
            : null,
        usageReported: data?.usage !== null && data?.usage !== undefined,
      })}\n`,
    );
  }
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      errorCode: controller.signal.aborted ? 'SMOKE_TIMEOUT' : 'SMOKE_NETWORK_ERROR',
      durationMs: Math.round(performance.now() - startedAt),
    }),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
