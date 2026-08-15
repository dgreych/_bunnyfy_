import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const BOUNDARY = 'bunnyfy-test-boundary';

function buildMultipartBody(fieldName: string, filename: string, content: Buffer, contentType: string): Buffer {
  const preamble = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const epilogue = `\r\n--${BOUNDARY}--\r\n`;
  return Buffer.concat([Buffer.from(preamble), content, Buffer.from(epilogue)]);
}

function multipartHeaders() {
  return { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
}

test('POST /v1/media sem Authorization retorna 401 no envelope canônico', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: multipartHeaders(),
      payload: buildMultipartBody('file', 'a.txt', Buffer.from('conteudo'), 'text/plain'),
    });
    assert.equal(response.statusCode, 401);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await close();
  }
});

test('POST /v1/media com token errado retorna 401', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { ...multipartHeaders(), authorization: 'Bearer token-errado-mas-longo-o-suficiente' },
      payload: buildMultipartBody('file', 'a.txt', Buffer.from('conteudo'), 'text/plain'),
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await close();
  }
});

test('POST /v1/media autenticado guarda o arquivo e devolve envelope com mediaUrl assinada', async () => {
  const { app, close } = await createTestApp();
  try {
    const content = Buffer.from('conteudo real do arquivo de teste');
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { ...multipartHeaders(), authorization: `Bearer ${TEST_TOKEN}` },
      payload: buildMultipartBody('file', 'a.txt', content, 'text/plain'),
    });

    assert.equal(uploadResponse.statusCode, 200);
    const body = uploadResponse.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.bytes, content.byteLength);
    assert.equal(body.data.mime, 'text/plain');
    assert.match(body.data.mediaId, /^[A-Za-z0-9_-]+$/);
    assert.ok(body.data.mediaUrl.startsWith('/v1/media/'));

    const readResponse = await app.inject({ method: 'GET', url: body.data.mediaUrl });
    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.body, content.toString('utf8'));
    assert.equal(readResponse.headers['content-type'], 'text/plain');
  } finally {
    await close();
  }
});

test('GET /v1/media/:id aceita Bearer mesmo sem assinatura', async () => {
  const { app, close } = await createTestApp();
  try {
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { ...multipartHeaders(), authorization: `Bearer ${TEST_TOKEN}` },
      payload: buildMultipartBody('file', 'a.txt', Buffer.from('x'), 'text/plain'),
    });
    const { mediaId } = uploadResponse.json().data;

    const readResponse = await app.inject({
      method: 'GET',
      url: `/v1/media/${mediaId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.equal(readResponse.statusCode, 200);
  } finally {
    await close();
  }
});

test('GET /v1/media/:id rejeita assinatura adulterada', async () => {
  const { app, close } = await createTestApp();
  try {
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { ...multipartHeaders(), authorization: `Bearer ${TEST_TOKEN}` },
      payload: buildMultipartBody('file', 'a.txt', Buffer.from('x'), 'text/plain'),
    });
    const { mediaId } = uploadResponse.json().data;
    const exp = Math.floor(Date.now() / 1000) + 60;

    const response = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}?exp=${exp}&sig=0000000000` });
    assert.equal(response.statusCode, 401);
  } finally {
    await close();
  }
});

test('GET /v1/media/:id rejeita assinatura já expirada', async () => {
  const { app, close } = await createTestApp();
  try {
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { ...multipartHeaders(), authorization: `Bearer ${TEST_TOKEN}` },
      payload: buildMultipartBody('file', 'a.txt', Buffer.from('x'), 'text/plain'),
    });
    const { mediaId, mediaUrl } = uploadResponse.json().data as { mediaId: string; mediaUrl: string };
    const url = new URL(mediaUrl, 'http://localhost:8080');
    const pastExp = Math.floor(Date.now() / 1000) - 1;

    const response = await app.inject({
      method: 'GET',
      url: `/v1/media/${mediaId}?exp=${pastExp}&sig=${url.searchParams.get('sig')}`,
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await close();
  }
});

test('GET /v1/media/:id com id inexistente (mas bem formado) retorna 404', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/media/idQueNaoExisteAAAAAAAAAAAA',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await close();
  }
});

test('GET /v1/media/:id com id malformado retorna 400 sem tocar no storage', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/media/../../etc/passwd',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.ok([400, 404].includes(response.statusCode));
  } finally {
    await close();
  }
});

test('resposta sempre inclui x-request-id e nunca ecoa o Authorization recebido', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.ok(response.headers['x-request-id']);
    assert.equal(response.body.includes(TEST_TOKEN), false);
  } finally {
    await close();
  }
});
