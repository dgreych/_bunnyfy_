import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';

import { buildLogger, redactUrlForLog } from '../src/logger.ts';

function collectingDestination(lines: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
}

test('redactUrlForLog remove querystring mantendo o caminho', () => {
  assert.equal(redactUrlForLog('/v1/media/abc?exp=1&sig=deadbeef'), '/v1/media/abc?[redacted]');
  assert.equal(redactUrlForLog('/health'), '/health');
});

test('logger nunca grava token/authorization/sig cru, mesmo em campos aninhados', () => {
  const lines: string[] = [];
  const logger = buildLogger({ logLevel: 'info', logPretty: false }, collectingDestination(lines));

  const secretToken = 'super-secret-bearer-token-nao-pode-vazar';
  logger.info(
    {
      authorization: `Bearer ${secretToken}`,
      token: secretToken,
      req: { method: 'GET', url: '/v1/media/abc', id: 'req-x', headers: { authorization: `Bearer ${secretToken}`, 'user-agent': 'teste' } },
      nested: { sig: 'assinatura-secreta-nao-pode-vazar' },
    },
    'evento de teste',
  );

  const output = lines.join('\n');
  assert.equal(output.includes(secretToken), false);
  assert.equal(output.includes('assinatura-secreta-nao-pode-vazar'), false);
  assert.ok(output.includes('[redacted]'));
});

test('serializer de req nunca inclui headers no log, só method/url/requestId', () => {
  const lines: string[] = [];
  const logger = buildLogger({ logLevel: 'info', logPretty: false }, collectingDestination(lines));

  logger.info(
    {
      req: {
        method: 'GET',
        url: '/v1/media/abc?exp=1&sig=deadbeef',
        id: 'req-1',
        headers: { authorization: 'Bearer nao-pode-aparecer' },
      },
    },
    'requisição recebida',
  );

  const parsed = JSON.parse(lines[0]!);
  assert.deepEqual(parsed.req, { method: 'GET', url: '/v1/media/abc?[redacted]', requestId: 'req-1' });
  assert.equal(JSON.stringify(parsed).includes('nao-pode-aparecer'), false);
});

test('logger redige credenciais e conteúdo privado de IA em qualquer payload conhecido', () => {
  const lines: string[] = [];
  const logger = buildLogger({ logLevel: 'info', logPretty: false }, collectingDestination(lines));
  const privateKey = 'provider-private-key-nao-pode-vazar';
  const privatePrompt = 'prompt privado nao pode vazar';
  const privateCompletion = 'resposta privada nao pode vazar';

  logger.info({
    apiKey: privateKey,
    nvidiaApiKey: privateKey,
    payload: { messages: [{ role: 'user', content: privatePrompt }] },
    result: { completion: privateCompletion },
  });

  const output = lines.join('\n');
  assert.equal(output.includes(privateKey), false);
  assert.equal(output.includes(privatePrompt), false);
  assert.equal(output.includes(privateCompletion), false);
});
