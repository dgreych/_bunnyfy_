import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import { NVIDIA_CHAT_ENDPOINT, requestAiChat, type AiChatDeps } from '../src/lib/aiChat.ts';

const MESSAGES = [{ role: 'user' as const, content: 'Responda apenas OK.' }];
const CONTROLS = { temperature: 0.4, maxOutputTokens: 120 };
const TEST_KEY = 'provider-test-key-0123456789abcdef';

function deps(overrides: Partial<AiChatDeps> = {}): AiChatDeps {
  return {
    apiKey: TEST_KEY,
    model: 'example/model',
    timeoutMs: 1_000,
    maxResponseBytes: 1024 * 1024,
    ...overrides,
  };
}

test('requestAiChat usa endpoint e configuração internos e normaliza a resposta', async () => {
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requestedInit = init;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const result = await requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl }));

  assert.equal(requestedUrl, NVIDIA_CHAT_ENDPOINT);
  assert.equal(requestedInit?.redirect, 'error');
  assert.equal(new Headers(requestedInit?.headers).get('authorization'), `Bearer ${TEST_KEY}`);
  const sentBody = requestedInit?.body;
  assert.ok(typeof sentBody === 'string');
  assert.deepEqual(JSON.parse(sentBody), {
    model: 'example/model',
    messages: MESSAGES,
    temperature: 0.4,
    max_tokens: 120,
    stream: false,
  });
  assert.deepEqual(result, {
    text: 'OK',
    finishReason: 'stop',
    usage: { inputTokens: 7, outputTokens: 1, totalTokens: 8 },
  });
});

test('requestAiChat falha antes da rede quando credencial ou modelo não estão configurados', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}');
  }) as typeof fetch;

  for (const override of [{ apiKey: undefined }, { model: undefined }]) {
    await assert.rejects(
      requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl, ...override })),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TOOL_UNAVAILABLE',
    );
  }
  assert.equal(calls, 0);
});

test('requestAiChat traduz status do provedor sem devolver corpo ou identidade externa', async () => {
  const cases = [
    { status: 401, code: 'BUNNYFY_TOOL_UNAVAILABLE', retryable: false },
    { status: 429, code: 'BUNNYFY_RATE_LIMITED', retryable: true },
    { status: 500, code: 'BUNNYFY_UNAVAILABLE', retryable: true },
    { status: 422, code: 'BUNNYFY_UNAVAILABLE', retryable: false },
  ];

  for (const item of cases) {
    const privateDetail = `private-upstream-detail-${item.status}`;
    const fetchImpl = (async () => new Response(privateDetail, { status: item.status })) as typeof fetch;

    await assert.rejects(
      requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl })),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, item.code);
        assert.equal(error.retryable, item.retryable);
        assert.equal(error.message.includes(privateDetail), false);
        assert.equal(error.message.toLowerCase().includes('nvidia'), false);
        return true;
      },
    );
  }
});

test('requestAiChat cancela a chamada quando o timeout é atingido', async () => {
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })) as typeof fetch;

  await assert.rejects(
    requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl, timeoutMs: 10 })),
    (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT',
  );
});

test('requestAiChat propaga o cancelamento do cliente para a chamada externa', async () => {
  const caller = new AbortController();
  let upstreamAborted = false;
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          upstreamAborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        },
        { once: true },
      );
    })) as typeof fetch;

  const pending = requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl, signal: caller.signal }));
  caller.abort();

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_UNAVAILABLE',
  );
  assert.equal(upstreamAborted, true);
});

test('requestAiChat recusa JSON inválido, resposta vazia e corpo acima do teto', async () => {
  const fetches: Array<typeof fetch> = [
    async () => new Response('{invalido', { status: 200 }),
    async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
        headers: { 'content-length': '9999' },
      })),
  ];

  for (const fetchImpl of fetches) {
    await assert.rejects(
      requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl, maxResponseBytes: 64 })),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_UNAVAILABLE',
    );
  }
});

test('requestAiChat limita stream sem Content-Length e não recomenda retry do mesmo corpo', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(40));
      controller.close();
    },
  });
  const fetchImpl = (async () => new Response(stream, { status: 200 })) as typeof fetch;

  await assert.rejects(
    requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl, maxResponseBytes: 64 })),
    (error: unknown) =>
      error instanceof AppError && error.code === 'BUNNYFY_UNAVAILABLE' && error.retryable === false,
  );
});

test('requestAiChat normaliza finishReason desconhecido e ignora contagem numérica insegura', async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'OK' }, finish_reason: 'provider_private_reason' }],
        usage: {
          prompt_tokens: Number.MAX_SAFE_INTEGER + 1,
          completion_tokens: 1,
          total_tokens: Number.MAX_SAFE_INTEGER + 2,
        },
      }),
      { status: 200 },
    )) as typeof fetch;

  const result = await requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl }));
  assert.equal(result.finishReason, 'other');
  assert.equal(result.usage, null);
});

test('requestAiChat sanitiza falha de rede sem preservar erro, chave ou detalhe privado', async () => {
  const privateDetail = `network-private-${TEST_KEY}`;
  const fetchImpl = (async () => {
    throw new Error(privateDetail);
  }) as typeof fetch;

  await assert.rejects(
    requestAiChat(MESSAGES, CONTROLS, deps({ fetchImpl })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'BUNNYFY_UNAVAILABLE');
      assert.equal(error.message.includes(privateDetail), false);
      assert.equal(error.cause, undefined);
      assert.deepEqual(error.internalDetails, { reason: 'upstream_network_error' });
      return true;
    },
  );
});
