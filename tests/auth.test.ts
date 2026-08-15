import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isValidApiToken } from '../src/plugins/auth.ts';
import { signMediaAccess, verifyMediaAccess } from '../src/security/mediaSigning.ts';

const VALID_TOKENS = ['token-um-bem-longo-123456', 'token-dois-bem-longo-654321'];

test('isValidApiToken aceita qualquer token da lista', () => {
  assert.equal(isValidApiToken(VALID_TOKENS[0]!, VALID_TOKENS), true);
  assert.equal(isValidApiToken(VALID_TOKENS[1]!, VALID_TOKENS), true);
});

test('isValidApiToken rejeita token fora da lista', () => {
  assert.equal(isValidApiToken('token-invalido', VALID_TOKENS), false);
});

test('isValidApiToken rejeita string vazia e não lança com tamanhos diferentes', () => {
  assert.equal(isValidApiToken('', VALID_TOKENS), false);
  assert.doesNotThrow(() => isValidApiToken('x', VALID_TOKENS));
});

const SECRET = 'segredo-de-teste-com-32-caracteres-ok';

test('verifyMediaAccess aceita assinatura correta e não expirada', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signMediaAccess('media-id-1', exp, SECRET);
  assert.equal(verifyMediaAccess('media-id-1', exp, sig, SECRET), true);
});

test('verifyMediaAccess rejeita assinatura expirada', () => {
  const exp = Math.floor(Date.now() / 1000) - 5;
  const sig = signMediaAccess('media-id-1', exp, SECRET);
  assert.equal(verifyMediaAccess('media-id-1', exp, sig, SECRET), false);
});

test('verifyMediaAccess rejeita assinatura de outro id (não reaproveitável entre mídias)', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signMediaAccess('media-id-1', exp, SECRET);
  assert.equal(verifyMediaAccess('media-id-2', exp, sig, SECRET), false);
});

test('verifyMediaAccess rejeita assinatura adulterada', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signMediaAccess('media-id-1', exp, SECRET);
  const tampered = sig.slice(0, -2) + (sig.slice(-2) === '00' ? '11' : '00');
  assert.equal(verifyMediaAccess('media-id-1', exp, tampered, SECRET), false);
});

test('verifyMediaAccess rejeita segredo errado', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signMediaAccess('media-id-1', exp, SECRET);
  assert.equal(verifyMediaAccess('media-id-1', exp, sig, 'outro-segredo-completamente-diferente'), false);
});
