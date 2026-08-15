import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConcurrencyLimiter } from '../src/lib/concurrencyLimiter.ts';

test('tryAcquire permite até o máximo e recusa depois', () => {
  const limiter = new ConcurrencyLimiter(2);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), false);
  assert.equal(limiter.activeCount, 2);
});

test('release libera espaço pra uma nova aquisição', () => {
  const limiter = new ConcurrencyLimiter(1);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), false);
  limiter.release();
  assert.equal(limiter.activeCount, 0);
  assert.equal(limiter.tryAcquire(), true);
});

test('release nunca deixa o contador negativo', () => {
  const limiter = new ConcurrencyLimiter(1);
  limiter.release();
  limiter.release();
  assert.equal(limiter.activeCount, 0);
  assert.equal(limiter.tryAcquire(), true);
});
