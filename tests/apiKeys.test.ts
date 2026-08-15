import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { test } from 'node:test';

import {
  ApiKeyConfigurationError,
  generateApiKey,
  hasApiKeyScope,
  isBunnyFyApiKey,
  parseApiKeysJson,
} from '../src/security/apiKeys.ts';

const LIVE_KEY = `bf_live_${'A'.repeat(43)}`;
const TEST_KEY = `bf_test_${'b'.repeat(43)}`;
const LEGACY_TOKEN = 'token-legado-comprido-123456789';

function configurationJson() {
  return JSON.stringify([
    { id: 'gyomei-production', key: LIVE_KEY, scopes: ['ai:chat', 'images:*'] },
    { id: 'integration-tests', key: TEST_KEY, scopes: ['media:read'] },
  ]);
}

test('gera chaves identificáveis bf_test e bf_live com segredo aleatório suficiente', () => {
  const testKey = generateApiKey('test');
  const liveKey = generateApiKey('live');

  assert.match(testKey, /^bf_test_[A-Za-z0-9_-]{43}$/);
  assert.match(liveKey, /^bf_live_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(testKey, generateApiKey('test'));
  assert.equal(isBunnyFyApiKey(testKey), true);
  assert.equal(isBunnyFyApiKey(liveKey), true);
  assert.equal(isBunnyFyApiKey('bf_live_curta'), false);
  assert.equal(isBunnyFyApiKey(`outro_${'x'.repeat(43)}`), false);
});

test('parser cria registros com id, ambiente e escopos sem reter segredo cru observável', () => {
  const registry = parseApiKeysJson(configurationJson());

  assert.equal(registry.size, 2);
  assert.deepEqual(registry.authenticate(LIVE_KEY), {
    id: 'gyomei-production',
    environment: 'live',
    scopes: ['ai:chat', 'images:*'],
    legacy: false,
  });
  assert.deepEqual(registry.authenticate(TEST_KEY), {
    id: 'integration-tests',
    environment: 'test',
    scopes: ['media:read'],
    legacy: false,
  });

  const serialized = `${JSON.stringify(registry)} ${inspect(registry, { showHidden: true })}`;
  assert.equal(serialized.includes(LIVE_KEY), false);
  assert.equal(serialized.includes(TEST_KEY), false);
});

test('autenticação compara digests de tamanho fixo e rejeita valores diferentes sem lançar', () => {
  const registry = parseApiKeysJson(configurationJson());

  assert.equal(registry.authenticate(''), undefined);
  assert.equal(registry.authenticate('x'), undefined);
  assert.equal(registry.authenticate(`${LIVE_KEY}x`), undefined);
  assert.equal(registry.authenticate(`bf_live_${'C'.repeat(43)}`), undefined);
});

test('escopos aceitam somente correspondência exata, global ou wildcard de família', () => {
  assert.equal(hasApiKeyScope(['ai:chat'], 'ai:chat'), true);
  assert.equal(hasApiKeyScope(['ai:chat'], 'ai:completion'), false);
  assert.equal(hasApiKeyScope(['images:*'], 'images:upscale'), true);
  assert.equal(hasApiKeyScope(['images:*'], 'images:canvas:welcome'), true);
  assert.equal(hasApiKeyScope(['images:*'], 'images'), false);
  assert.equal(hasApiKeyScope(['images:*'], 'image:upscale'), false);
  assert.equal(hasApiKeyScope(['*'], 'qualquer:capacidade'), true);
  assert.equal(hasApiKeyScope(['AI:*'], 'ai:chat'), false);
  assert.equal(hasApiKeyScope(['images:*'], 'images:*:invalido'), false);
});

test('authenticate torna chave inválida e falta de escopo indistinguíveis', () => {
  const registry = parseApiKeysJson(configurationJson());

  assert.equal(registry.authenticate('chave-inexistente', 'ai:chat'), undefined);
  assert.equal(registry.authenticate(TEST_KEY, 'ai:chat'), undefined);
  assert.equal(registry.authenticate(LIVE_KEY, 'ai:chat')?.id, 'gyomei-production');
  assert.equal(registry.authenticate(LIVE_KEY, 'images:upscale')?.id, 'gyomei-production');
});

test('tokens legados são opcionais e recebem somente metadado explícito de transição com escopo global', () => {
  const withoutLegacy = parseApiKeysJson(configurationJson());
  assert.equal(withoutLegacy.authenticate(LEGACY_TOKEN, 'ai:chat'), undefined);

  const withLegacy = parseApiKeysJson(configurationJson(), { legacyTokens: [LEGACY_TOKEN] });
  assert.deepEqual(withLegacy.authenticate(LEGACY_TOKEN, 'ai:chat'), {
    id: 'legacy-1',
    environment: 'legacy',
    scopes: ['*'],
    legacy: true,
  });
});

test('parser aceita lista moderna ausente durante transição quando há token legado', () => {
  const registry = parseApiKeysJson(undefined, { legacyTokens: [LEGACY_TOKEN] });

  assert.equal(registry.size, 1);
  assert.equal(registry.authenticate(LEGACY_TOKEN, 'media:write')?.legacy, true);
});

test('parser rejeita JSON, formato, campos e escopos inválidos sem ecoar a chave', () => {
  const invalidInputs = [
    `[${JSON.stringify({ id: 'cliente', key: LIVE_KEY, scopes: ['ai:chat'] })},${LIVE_KEY}]`,
    JSON.stringify({ id: 'cliente', key: LIVE_KEY, scopes: ['ai:chat'] }),
    JSON.stringify([{ id: 'cliente', key: `bf_live_${'x'.repeat(20)}`, scopes: ['ai:chat'] }]),
    JSON.stringify([{ id: 'cliente inválido', key: LIVE_KEY, scopes: ['ai:chat'] }]),
    JSON.stringify([{ id: 'cliente', key: LIVE_KEY, scopes: [] }]),
    JSON.stringify([{ id: 'cliente', key: LIVE_KEY, scopes: ['ai:*:chat'] }]),
    JSON.stringify([{ id: 'cliente', key: LIVE_KEY, scopes: ['ai:chat', 'ai:chat'] }]),
    JSON.stringify([{ id: 'cliente', key: LIVE_KEY, scopes: ['ai:chat'], secret: LIVE_KEY }]),
    JSON.stringify([{ id: 'cliente', key: `bf_live_${'SUBSTITUA'.padEnd(43, 'x')}`, scopes: ['ai:chat'] }]),
  ];

  for (const raw of invalidInputs) {
    assert.throws(
      () => parseApiKeysJson(raw),
      (error: unknown) => {
        assert.ok(error instanceof ApiKeyConfigurationError);
        assert.equal(error.message.includes(LIVE_KEY), false);
        assert.equal(error.message, 'BUNNYFY_API_KEYS possui configuração inválida.');
        return true;
      },
    );
  }
});

test('parser rejeita ids, chaves e tokens legados duplicados sem incluir segredo no erro', () => {
  const duplicateCases = [
    JSON.stringify([
      { id: 'mesmo-id', key: LIVE_KEY, scopes: ['ai:chat'] },
      { id: 'mesmo-id', key: TEST_KEY, scopes: ['media:read'] },
    ]),
    JSON.stringify([
      { id: 'cliente-a', key: LIVE_KEY, scopes: ['ai:chat'] },
      { id: 'cliente-b', key: LIVE_KEY, scopes: ['media:read'] },
    ]),
  ];

  for (const raw of duplicateCases) {
    assert.throws(() => parseApiKeysJson(raw), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(LIVE_KEY), false);
      return true;
    });
  }

  assert.throws(
    () => parseApiKeysJson('[]', { legacyTokens: [LEGACY_TOKEN, LEGACY_TOKEN] }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(LEGACY_TOKEN), false);
      return true;
    },
  );
});
