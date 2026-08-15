import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';

import { bindClientAbort } from '../src/lib/clientAbort.ts';

function connectionPair(
  options: { requestAborted?: boolean; requestDestroyed?: boolean; responseDestroyed?: boolean } = {},
) {
  const request = Object.assign(new EventEmitter(), {
    aborted: options.requestAborted ?? false,
    destroyed: options.requestDestroyed ?? false,
  }) as unknown as IncomingMessage;
  const response = Object.assign(new EventEmitter(), {
    destroyed: options.responseDestroyed ?? false,
    writableEnded: false,
  }) as unknown as ServerResponse;
  return { request, response };
}

test('bindClientAbort nao confunde corpo consumido com abandono do cliente', () => {
  const { request, response } = connectionPair({ requestDestroyed: true });
  const binding = bindClientAbort(request, response);

  assert.equal(binding.signal.aborted, false);
  binding.detach();
});

test('bindClientAbort ja nasce cancelado quando a conexao encerrou antes do binding', () => {
  const { request, response } = connectionPair({ requestAborted: true });
  const binding = bindClientAbort(request, response);

  assert.equal(binding.signal.aborted, true);
  binding.detach();
  assert.equal(request.listenerCount('aborted'), 0);
  assert.equal(response.listenerCount('close'), 0);
});

test('bindClientAbort propaga encerramento posterior e remove listeners', () => {
  const { request, response } = connectionPair();
  const binding = bindClientAbort(request, response);

  response.emit('close');
  assert.equal(binding.signal.aborted, true);

  binding.detach();
  assert.equal(request.listenerCount('aborted'), 0);
  assert.equal(response.listenerCount('close'), 0);
});
