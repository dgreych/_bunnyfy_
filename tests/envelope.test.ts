import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError, errEnvelope, okEnvelope } from '../src/envelope.ts';

test('okEnvelope monta o envelope de sucesso canônico', () => {
  const envelope = okEnvelope({ hello: 'world' }, { requestId: 'req-1', durationMs: 12.5 });
  assert.deepEqual(envelope, {
    ok: true,
    data: { hello: 'world' },
    error: null,
    meta: { requestId: 'req-1', durationMs: 12.5 },
  });
});

test('errEnvelope monta o envelope de erro canônico', () => {
  const envelope = errEnvelope(
    { code: 'bad_request', message: 'algo errado', retryable: false },
    { requestId: 'req-2', durationMs: 1 },
  );
  assert.equal(envelope.ok, false);
  assert.equal(envelope.data, null);
  assert.deepEqual(envelope.error, { code: 'bad_request', message: 'algo errado', retryable: false });
});

test('AppError.toPayload nunca inclui internalDetails', () => {
  const error = AppError.internal('falhou', { stackInterno: 'segredo-de-implementacao' });
  const payload = error.toPayload();
  assert.deepEqual(payload, { code: 'BUNNYFY_INTERNAL_ERROR', message: 'falhou', retryable: false });
  assert.equal('internalDetails' in payload, false);
});

test('fábricas de AppError usam o statusCode e retryable esperados', () => {
  assert.equal(AppError.unauthorized().statusCode, 401);
  assert.equal(AppError.badRequest('x').statusCode, 400);
  assert.equal(AppError.notFound().statusCode, 404);
  assert.equal(AppError.payloadTooLarge().statusCode, 413);
  assert.equal(AppError.tooManyRequests().retryable, true);
  assert.equal(AppError.toolUnavailable().statusCode, 503);
  assert.equal(AppError.unavailable().statusCode, 503);
  assert.equal(AppError.upstreamTimeout().retryable, true);
  assert.equal(AppError.blockedUrl().statusCode, 400);
});

test('códigos de erro batem com docs/GYOMEI_COMPATIBILITY.md (contrato com o cliente Gyomei)', () => {
  assert.equal(AppError.unauthorized().code, 'BUNNYFY_AUTH_FAILED');
  assert.equal(AppError.badRequest('x').code, 'BUNNYFY_BAD_REQUEST');
  assert.equal(AppError.notFound().code, 'BUNNYFY_NOT_FOUND');
  assert.equal(AppError.payloadTooLarge().code, 'BUNNYFY_TOO_LARGE');
  assert.equal(AppError.tooManyRequests().code, 'BUNNYFY_RATE_LIMITED');
  assert.equal(AppError.blockedUrl().code, 'BUNNYFY_URL_BLOCKED');
  assert.equal(AppError.notFound().code, 'BUNNYFY_NOT_FOUND');
  assert.equal(AppError.toolUnavailable().code, 'BUNNYFY_TOOL_UNAVAILABLE');
  assert.equal(AppError.unavailable().code, 'BUNNYFY_UNAVAILABLE');
  assert.equal(AppError.upstreamTimeout().code, 'BUNNYFY_TIMEOUT');
  assert.equal(AppError.internal('x').code, 'BUNNYFY_INTERNAL_ERROR');
});
