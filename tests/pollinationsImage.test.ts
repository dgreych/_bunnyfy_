import assert from 'node:assert/strict';
import { test } from 'node:test';

import { requestPollinationsImage } from '../src/lib/pollinationsImage.ts';

const PNG_IMAGE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pollinations-image'),
]);

test('modo estrito mantém prompt literal e envia enhance=false por padrão', async () => {
  const prompt = 'um cachorro verde com exatamente três estrelas';
  const output = await requestPollinationsImage(prompt, {
    timeoutMs: 1_000,
    maxResponseBytes: 5_000,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(decodeURIComponent(parsed.pathname.replace('/prompt/', '')), prompt);
      assert.equal(parsed.searchParams.get('enhance'), 'false');
      return new Response(PNG_IMAGE, { headers: { 'content-type': 'image/png' } });
    },
  });
  assert.deepEqual(output, PNG_IMAGE);
});

test('reescrita antiga só é habilitada explicitamente', async () => {
  await requestPollinationsImage('prompt', {
    timeoutMs: 1_000,
    maxResponseBytes: 5_000,
    enhance: true,
    fetchImpl: async (url) => {
      assert.equal(new URL(String(url)).searchParams.get('enhance'), 'true');
      return new Response(PNG_IMAGE);
    },
  });
});
