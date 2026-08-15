import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';

import { buildLogger } from '../src/logger.ts';
import type { AiChatResult } from '../src/lib/aiChat.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const AI_ENV = {
  AI_CHAT_ENABLED: 'true',
  NVIDIA_API_KEY: 'provider-test-key-0123456789abcdef',
  NVIDIA_MODEL: 'example/model',
  NVIDIA_ALLOWED_MODELS: 'example/model,example/fast',
};

const RESULT: AiChatResult = {
  text: 'Resposta segura',
  finishReason: 'stop',
  usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
};

function authHeaders(token = TEST_TOKEN) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

test('POST /v1/ai/chat/completions exige Bearer antes de avaliar a capacidade', async () => {
  const { app, close } = await createTestApp({ envOverrides: AI_ENV, aiChat: async () => RESULT });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      payload: { messages: [{ role: 'user', content: 'Olá' }] },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions exige escopo ai:chat sem distinguir chave inválida', async () => {
  const scopedKey = `bf_test_${'s'.repeat(43)}`;
  let called = false;
  const { app, close } = await createTestApp({
    envOverrides: {
      ...AI_ENV,
      BUNNYFY_API_TOKENS: '',
      BUNNYFY_API_KEYS: JSON.stringify([{ id: 'media-only', key: scopedKey, scopes: ['media:write'] }]),
    },
    aiChat: async () => {
      called = true;
      return RESULT;
    },
  });

  try {
    const payload = { messages: [{ role: 'user', content: 'Olá' }] };
    const withoutScope = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: { authorization: `Bearer ${scopedKey}` },
      payload,
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: { authorization: 'Bearer chave-invalida' },
      payload,
    });

    assert.equal(withoutScope.statusCode, 401);
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(withoutScope.json().error, invalid.json().error);
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions fica indisponível sem ativação e segredo no ambiente', async () => {
  let called = false;
  const { app, close } = await createTestApp({
    aiChat: async () => {
      called = true;
      return RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: 'Olá' }] },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'BUNNYFY_TOOL_UNAVAILABLE');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions valida, limita e devolve somente o contrato BunnyFy', async () => {
  let capturedMessages: unknown;
  let capturedControls: unknown;
  const { app, close } = await createTestApp({
    envOverrides: AI_ENV,
    aiChat: async (messages, controls) => {
      capturedMessages = messages;
      capturedControls = controls;
      return RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: {
        messages: [
          { role: 'system', content: 'Seja breve.' },
          { role: 'user', content: 'Olá' },
        ],
        temperature: 0.3,
        maxOutputTokens: 64,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(capturedMessages, [
      { role: 'system', content: 'Seja breve.' },
      { role: 'user', content: 'Olá' },
    ]);
    assert.deepEqual(capturedControls, { temperature: 0.3, maxOutputTokens: 64 });

    const body = response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, RESULT);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes('NVIDIA'), false);
    assert.equal(serialized.includes(AI_ENV.NVIDIA_API_KEY), false);
    assert.equal(serialized.includes(AI_ENV.NVIDIA_MODEL), false);
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions preserva conteúdo e usa o teto configurado como default', async () => {
  const originalContent = '\n  bloco com espaços preservados  \n';
  let capturedMessages: unknown;
  let capturedControls: unknown;
  const { app, close } = await createTestApp({
    envOverrides: AI_ENV,
    aiChat: async (messages, controls) => {
      capturedMessages = messages;
      capturedControls = controls;
      return RESULT;
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: originalContent }] },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(capturedMessages, [{ role: 'user', content: originalContent }]);
    assert.deepEqual(capturedControls, { temperature: 0.7, maxOutputTokens: 2_000 });
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions aceita somente modelos da allowlist interna', async () => {
  let selectedModel: string | undefined;
  const { app, close } = await createTestApp({
    envOverrides: AI_ENV,
    aiChat: async (_messages, _controls, deps) => {
      selectedModel = deps.model;
      return RESULT;
    },
  });
  try {
    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: 'Olá' }], model: 'example/fast' },
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(selectedModel, 'example/fast');

    const denied = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: 'Olá' }], model: 'example/unlisted' },
    });
    assert.equal(denied.statusCode, 400);
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions recusa endpoint, headers e campos arbitrários do cliente', async () => {
  const { app, close } = await createTestApp({ envOverrides: AI_ENV, aiChat: async () => RESULT });
  try {
    for (const extra of [
      { endpoint: 'https://example.com' },
      { headers: { authorization: 'segredo' } },
      { stream: true },
      { tools: [] },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ai/chat/completions',
        headers: authHeaders(),
        payload: { messages: [{ role: 'user', content: 'Olá' }], ...extra },
      });
      assert.equal(response.statusCode, 400, `campo aceito indevidamente: ${Object.keys(extra)[0]}`);
      assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    }
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions aplica limites por mensagem, total, quantidade e saída', async () => {
  const { app, close } = await createTestApp({
    envOverrides: {
      ...AI_ENV,
      AI_CHAT_MAX_MESSAGES: '2',
      AI_CHAT_MAX_MESSAGE_CHARS: '5',
      AI_CHAT_MAX_TOTAL_CHARS: '8',
      AI_CHAT_MAX_OUTPUT_TOKENS: '10',
    },
    aiChat: async () => RESULT,
  });
  try {
    const invalidPayloads = [
      { messages: [{ role: 'user', content: '123456' }] },
      { messages: [{ role: 'user', content: '12345' }, { role: 'assistant', content: '12345' }] },
      { messages: [{ role: 'user', content: '1' }, { role: 'assistant', content: '2' }, { role: 'user', content: '3' }] },
      { messages: [{ role: 'tool', content: '1' }] },
      { messages: [{ role: 'user', content: '1' }, { role: 'system', content: '2' }, { role: 'user', content: '3' }] },
      { messages: [{ role: 'system', content: '1' }, { role: 'system', content: '2' }, { role: 'user', content: '3' }] },
      { messages: [{ role: 'user', content: '1' }, { role: 'assistant', content: '2' }] },
      { messages: [{ role: 'user', content: '1' }], maxOutputTokens: 11 },
    ];

    for (const payload of invalidPayloads) {
      const response = await app.inject({ method: 'POST', url: '/v1/ai/chat/completions', headers: authHeaders(), payload });
      assert.equal(response.statusCode, 400);
    }
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions limita a taxa global antes de consumir nova chamada externa', async () => {
  let calls = 0;
  const { app, close } = await createTestApp({
    envOverrides: { ...AI_ENV, AI_CHAT_MAX_REQUESTS_PER_MINUTE: '1' },
    aiChat: async () => {
      calls += 1;
      return RESULT;
    },
  });

  try {
    const request = {
      method: 'POST' as const,
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: 'Olá' }] },
    };
    assert.equal((await app.inject(request)).statusCode, 200);

    const limited = await app.inject(request);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'BUNNYFY_RATE_LIMITED');
    assert.equal(calls, 1);
  } finally {
    await close();
  }
});

test('POST /v1/ai/chat/completions devolve 429 quando toda a concorrência está ocupada', async () => {
  let signalStarted!: () => void;
  let releaseFirst!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const { app, close } = await createTestApp({
    envOverrides: { ...AI_ENV, AI_CHAT_MAX_CONCURRENCY: '1' },
    aiChat: async () => {
      signalStarted();
      await release;
      return RESULT;
    },
  });

  try {
    const first = app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: 'primeira' }] },
    });
    await started;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: 'segunda' }] },
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'BUNNYFY_RATE_LIMITED');

    releaseFirst();
    assert.equal((await first).statusCode, 200);
  } finally {
    releaseFirst();
    await close();
  }
});

test('POST /v1/ai/chat/completions isola concorrência por consumidor sem quebrar o limite global', async () => {
  const consumerAKey = `bf_test_${'a'.repeat(43)}`;
  const consumerBKey = `bf_test_${'b'.repeat(43)}`;
  let signalStarted!: () => void;
  let releaseFirst!: () => void;
  let calls = 0;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const { app, close } = await createTestApp({
    envOverrides: {
      ...AI_ENV,
      BUNNYFY_API_TOKENS: '',
      BUNNYFY_API_KEYS: JSON.stringify([
        { id: 'consumer-a', key: consumerAKey, scopes: ['ai:chat'] },
        { id: 'consumer-b', key: consumerBKey, scopes: ['ai:chat'] },
      ]),
      AI_CHAT_MAX_CONCURRENCY: '2',
      AI_CHAT_MAX_CONCURRENCY_PER_CONSUMER: '1',
    },
    aiChat: async (messages) => {
      calls += 1;
      if (messages[0]?.content === 'primeira-a') {
        signalStarted();
        await release;
      }
      return RESULT;
    },
  });

  try {
    const first = app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(consumerAKey),
      payload: { messages: [{ role: 'user', content: 'primeira-a' }] },
    });
    await started;

    const blockedSameConsumer = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(consumerAKey),
      payload: { messages: [{ role: 'user', content: 'segunda-a' }] },
    });
    assert.equal(blockedSameConsumer.statusCode, 429);

    const otherConsumer = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(consumerBKey),
      payload: { messages: [{ role: 'user', content: 'primeira-b' }] },
    });
    assert.equal(otherConsumer.statusCode, 200);
    assert.equal(calls, 2);

    releaseFirst();
    assert.equal((await first).statusCode, 200);
  } finally {
    releaseFirst();
    await close();
  }
});

test('POST /v1/ai/chat/completions isola janela por consumidor moderno e legado', async () => {
  const modernKey = `bf_test_${'m'.repeat(43)}`;
  const legacyKey = 'legacy-consumer-token-0123456789';
  let calls = 0;
  const { app, close } = await createTestApp({
    envOverrides: {
      ...AI_ENV,
      BUNNYFY_API_TOKENS: legacyKey,
      BUNNYFY_API_KEYS: JSON.stringify([{ id: 'modern-consumer', key: modernKey, scopes: ['ai:chat'] }]),
      AI_CHAT_MAX_REQUESTS_PER_MINUTE_PER_CONSUMER: '1',
    },
    aiChat: async () => {
      calls += 1;
      return RESULT;
    },
  });

  try {
    const requestFor = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/ai/chat/completions',
        headers: authHeaders(token),
        payload: { messages: [{ role: 'user', content: 'Olá' }] },
      });

    assert.equal((await requestFor(modernKey)).statusCode, 200);
    assert.equal((await requestFor(modernKey)).statusCode, 429);
    assert.equal((await requestFor(legacyKey)).statusCode, 200);
    assert.equal((await requestFor(legacyKey)).statusCode, 429);
    assert.equal(calls, 2);
  } finally {
    await close();
  }
});

test('logs da rota nunca incluem prompt, resposta, credencial ou modelo', async () => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = buildLogger({ logLevel: 'info', logPretty: false }, destination);
  const privatePrompt = 'prompt-privado-nao-pode-vazar';
  const privateAnswer = 'resposta-privada-nao-pode-vazar';

  const { app, close } = await createTestApp({
    envOverrides: AI_ENV,
    logger,
    aiChat: async () => ({ ...RESULT, text: privateAnswer }),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/ai/chat/completions',
      headers: authHeaders(),
      payload: { messages: [{ role: 'user', content: privatePrompt }] },
    });
    assert.equal(response.statusCode, 200);

    const output = lines.join('\n');
    assert.equal(output.includes(privatePrompt), false);
    assert.equal(output.includes(privateAnswer), false);
    assert.equal(output.includes(AI_ENV.NVIDIA_API_KEY), false);
    assert.equal(output.includes(AI_ENV.NVIDIA_MODEL), false);
  } finally {
    await close();
  }
});
