import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';

import { buildLogger } from '../src/logger.ts';
import { AppError } from '../src/envelope.ts';
import type { DnsLookup } from '../src/security/ssrf.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const PUBLIC_DNS: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FAKE_RESULT = { text: 'transcrição de teste', language: 'pt', durationSeconds: 3.2 };

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json' };
}

test('POST /v1/audio/transcriptions sem Authorization retorna 401', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      payload: { mediaId: 'x'.repeat(20) },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await close();
  }
});

test('rejeita quando mediaId e url são informados juntos (XOR)', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: 'x'.repeat(20), url: 'https://example.com/a.mp3' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
  } finally {
    await close();
  }
});

test('rejeita quando nem mediaId nem url são informados (XOR)', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: {},
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await close();
  }
});

test('rejeita language inválido', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: 'x'.repeat(20), language: 'portugues' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await close();
  }
});

test('aceita language "auto" e códigos de 2 letras', async () => {
  const { app, close } = await createTestApp({ transcribe: async () => FAKE_RESULT });
  try {
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { 'content-type': 'multipart/form-data; boundary=b', authorization: `Bearer ${TEST_TOKEN}` },
      payload: Buffer.concat([
        Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'),
        Buffer.from('conteudo'),
        Buffer.from('\r\n--b--\r\n'),
      ]),
    });
    const { mediaId } = uploadResponse.json().data;

    for (const language of ['auto', 'pt', 'en']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/audio/transcriptions',
        headers: authHeaders(),
        payload: { mediaId, language },
      });
      assert.equal(response.statusCode, 200, `falhou para language=${language}`);
    }
  } finally {
    await close();
  }
});

test('mediaId inexistente retorna 404 sem chamar o adaptador de transcrição', async () => {
  let called = false;
  const { app, close } = await createTestApp({
    transcribe: async () => {
      called = true;
      return FAKE_RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: 'idQueNaoExisteAAAAAAAAAAAA' },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, 'BUNNYFY_NOT_FOUND');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('mediaId expirado retorna 404', async () => {
  const { app, close, tempStorage } = await createTestApp({
    envOverrides: { MEDIA_TTL_SECONDS: '1' },
    transcribe: async () => FAKE_RESULT,
  });
  try {
    const entry = await tempStorage.put(Readable.from(Buffer.from('audio falso')), { mimeType: 'audio/mpeg' });
    await sleep(1100);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: entry.id },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await close();
  }
});

test('mediaId malformado retorna 400 sem consultar o storage', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: '../../etc/passwd' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await close();
  }
});

test('bloqueia URL fora da política SSRF antes de chamar o adaptador', async () => {
  let called = false;
  const { app, close } = await createTestApp({
    dnsLookup: async () => [{ address: '10.0.0.5', family: 4 }],
    transcribe: async () => {
      called = true;
      return FAKE_RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { url: 'https://internal.example/audio.mp3' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_URL_BLOCKED');
    assert.equal(called, false);
  } finally {
    await close();
  }
});

test('sucesso via mediaId (adaptador injetado) devolve text/language/durationSeconds e preserva a mídia original', async () => {
  const { app, close, tempStorage } = await createTestApp({ transcribe: async () => FAKE_RESULT });
  try {
    const entry = await tempStorage.put(Readable.from(Buffer.from('audio falso')), { mimeType: 'audio/mpeg' });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: entry.id },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, FAKE_RESULT);

    // a mídia original ainda existe — a transcrição não pode apagá-la.
    const stillThere = await tempStorage.get(entry.id);
    assert.ok(stillThere);
  } finally {
    await close();
  }
});

test('sucesso via url (fetch e adaptador injetados) e limpa o arquivo de rascunho depois', async () => {
  const audioBytes = Buffer.from('conteudo de audio fake vindo de url');
  const fetchImpl = (async () =>
    new Response(audioBytes, { status: 200 })) as unknown as typeof fetch;

  let capturedInputPath: string | undefined;
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    fetchImpl,
    transcribe: async (inputPath) => {
      capturedInputPath = inputPath;
      return FAKE_RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { url: 'https://public.example/audio.mp3' },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, FAKE_RESULT);

    assert.ok(capturedInputPath);
    await assert.rejects(access(capturedInputPath));
  } finally {
    await close();
  }
});

test('URL que devolve corpo maior que o limite retorna 413', async () => {
  const bigBody = Buffer.alloc(1024, 1);
  const fetchImpl = (async () => new Response(bigBody, { status: 200 })) as unknown as typeof fetch;

  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    fetchImpl,
    envOverrides: { TRANSCRIPTION_MAX_INPUT_BYTES: '100' },
    transcribe: async () => FAKE_RESULT,
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { url: 'https://public.example/audio.mp3' },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, 'BUNNYFY_TOO_LARGE');
  } finally {
    await close();
  }
});

test('timeout do adaptador vira 504 estável', async () => {
  const { app, close, tempStorage } = await createTestApp({
    transcribe: async () => {
      throw AppError.upstreamTimeout('Transcrição excedeu o tempo limite.');
    },
  });
  try {
    const entry = await tempStorage.put(Readable.from(Buffer.from('x')), { mimeType: 'audio/mpeg' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: entry.id },
    });
    assert.equal(response.statusCode, 504);
    assert.equal(response.json().error.code, 'BUNNYFY_TIMEOUT');
    assert.equal(response.json().error.retryable, true);
  } finally {
    await close();
  }
});

test('ferramenta ausente (adaptador injetado simulando) vira 503 estável', async () => {
  const { app, close, tempStorage } = await createTestApp({
    transcribe: async () => {
      throw AppError.toolUnavailable('Transcrição indisponível no servidor (whisper-cli, modelo whisper).');
    },
  });
  try {
    const entry = await tempStorage.put(Readable.from(Buffer.from('x')), { mimeType: 'audio/mpeg' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: entry.id },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'BUNNYFY_TOOL_UNAVAILABLE');
  } finally {
    await close();
  }
});

test('áudio indecodificável (adaptador injetado simulando) vira 400 estável', async () => {
  const { app, close, tempStorage } = await createTestApp({
    transcribe: async () => {
      throw AppError.badRequest('Não foi possível decodificar o áudio enviado.');
    },
  });
  try {
    const entry = await tempStorage.put(Readable.from(Buffer.from('x')), { mimeType: 'audio/mpeg' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: entry.id },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await close();
  }
});

test('limite de concorrência: segunda transcrição simultânea recebe 429 enquanto a primeira está em andamento', async () => {
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const { app, close, tempStorage } = await createTestApp({
    envOverrides: { TRANSCRIPTION_MAX_CONCURRENCY: '1' },
    transcribe: async () => {
      await gate;
      return FAKE_RESULT;
    },
  });
  try {
    const entry = await tempStorage.put(Readable.from(Buffer.from('x')), { mimeType: 'audio/mpeg' });

    const firstRequest = app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: entry.id },
    });

    // dá tempo do primeiro pedido realmente entrar no handler e adquirir o slot.
    await sleep(30);

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { mediaId: entry.id },
    });
    assert.equal(secondResponse.statusCode, 429);
    assert.equal(secondResponse.json().error.code, 'BUNNYFY_RATE_LIMITED');

    releaseFirst?.();
    const firstResponse = await firstRequest;
    assert.equal(firstResponse.statusCode, 200);
  } finally {
    await close();
  }
});

test('logs nunca incluem texto transcrito, url completa ou caminho local', async () => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = buildLogger({ logLevel: 'info', logPretty: false }, destination);

  const secretText = 'transcricao-secreta-que-nao-pode-vazar-no-log';
  const fetchImpl = (async () => new Response(Buffer.from('audio'), { status: 200 })) as unknown as typeof fetch;

  const { app, close } = await createTestApp({
    logger,
    dnsLookup: PUBLIC_DNS,
    fetchImpl,
    transcribe: async () => ({ text: secretText, language: 'pt', durationSeconds: 1 }),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: authHeaders(),
      payload: { url: 'https://public.example/segredo-na-url?token=nao-pode-vazar' },
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await close();
  }

  const output = lines.join('\n');
  assert.ok(output.length > 0, 'esperava que algo fosse logado durante a requisição');
  assert.equal(output.includes(secretText), false);
  assert.equal(output.includes('segredo-na-url'), false);
  assert.equal(output.includes('token=nao-pode-vazar'), false);
});
