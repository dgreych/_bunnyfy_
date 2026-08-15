import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KeyedConcurrencyLimiter, KeyedSlidingWindowRateLimiter } from '../src/lib/keyedLimiters.ts';

test('KeyedConcurrencyLimiter isola concorrencia e libera somente a identidade correta', () => {
  const limiter = new KeyedConcurrencyLimiter(1);

  assert.equal(limiter.tryAcquire('consumer-a'), true);
  assert.equal(limiter.tryAcquire('consumer-a'), false);
  assert.equal(limiter.tryAcquire('consumer-b'), true);
  assert.equal(limiter.activeCount('consumer-a'), 1);
  assert.equal(limiter.activeCount('consumer-b'), 1);

  limiter.release('consumer-a');
  assert.equal(limiter.activeCount('consumer-a'), 0);
  assert.equal(limiter.activeCount('consumer-b'), 1);
  assert.equal(limiter.tryAcquire('consumer-a'), true);
});

test('KeyedSlidingWindowRateLimiter mantem janela estrita independente por identidade', () => {
  const limiter = new KeyedSlidingWindowRateLimiter(2, 60_000);

  assert.equal(limiter.tryConsume('consumer-a', 1_000), true);
  assert.equal(limiter.tryConsume('consumer-a', 1_001), true);
  assert.equal(limiter.tryConsume('consumer-a', 60_999), false);
  assert.equal(limiter.tryConsume('consumer-b', 60_999), true);
  assert.equal(limiter.tryConsume('consumer-a', 61_000), true);
});

test('limitadores por chave recusam configuracao invalida', () => {
  assert.throws(() => new KeyedConcurrencyLimiter(0), /maxConcurrencyPerKey/);
  assert.throws(() => new KeyedSlidingWindowRateLimiter(0, 60_000), /maxRequestsPerKey/);
  assert.throws(() => new KeyedSlidingWindowRateLimiter(1, 0), /windowMs/);
});
