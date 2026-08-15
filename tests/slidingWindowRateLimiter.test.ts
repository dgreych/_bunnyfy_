import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SlidingWindowRateLimiter } from '../src/lib/slidingWindowRateLimiter.ts';

test('SlidingWindowRateLimiter aceita somente o máximo dentro da janela', () => {
  const limiter = new SlidingWindowRateLimiter(2, 60_000);
  assert.equal(limiter.tryConsume(1_000), true);
  assert.equal(limiter.tryConsume(1_001), true);
  assert.equal(limiter.tryConsume(60_999), false);
});

test('SlidingWindowRateLimiter libera cada chamada apenas depois da janela completa', () => {
  const limiter = new SlidingWindowRateLimiter(2, 60_000);
  assert.equal(limiter.tryConsume(1_000), true);
  assert.equal(limiter.tryConsume(2_000), true);

  assert.equal(limiter.tryConsume(61_000), true);
  assert.equal(limiter.tryConsume(61_999), false);
  assert.equal(limiter.tryConsume(62_000), true);
});

test('SlidingWindowRateLimiter recusa configuração inválida', () => {
  assert.throws(() => new SlidingWindowRateLimiter(0, 60_000), /maxRequests/);
  assert.throws(() => new SlidingWindowRateLimiter(1, 0), /windowMs/);
});
