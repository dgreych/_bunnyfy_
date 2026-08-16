import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import { createImageGenerator, imageGenerationCanaryBucket } from '../src/lib/imageGeneration.ts';

const PNG_IMAGE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('provider-neutral-image'),
]);
const BASE_DEPS = {
  mode: 'cloudflare-canary' as const,
  timeoutMs: 1_000,
  maxOutputBytes: 5_000,
  canaryPercent: 100,
  pollinationsEnhance: false,
  cloudflareAccountId: '0123456789abcdef0123456789abcdef',
  cloudflareApiToken: 'cloudflare-test-token-0123456789',
  cloudflareModel: '@cf/black-forest-labs/flux-2-klein-4b',
};

function cloudflareSuccess(): Response {
  return new Response(JSON.stringify({ result: { image: PNG_IMAGE.toString('base64') } }), {
    headers: { 'content-type': 'application/json' },
  });
}

test('canário 100 usa Cloudflare sem alterar o contrato binário', async () => {
  const calls: string[] = [];
  const generate = createImageGenerator({
    ...BASE_DEPS,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return cloudflareSuccess();
    },
  });

  const output = await generate({ prompt: 'prompt estrito', width: 768, height: 768 });
  assert.deepEqual(output, PNG_IMAGE);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /api\.cloudflare\.com/);
});

test('429/5xx/timeout transitórios usam fallback, mas 401 não mascara configuração', async () => {
  for (const status of [429, 500]) {
    const calls: string[] = [];
    const generate = createImageGenerator({
      ...BASE_DEPS,
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).includes('api.cloudflare.com')) return new Response(null, { status });
        return new Response(PNG_IMAGE);
      },
    });
    assert.deepEqual(await generate({ prompt: 'fallback', width: 768, height: 768 }), PNG_IMAGE);
    assert.equal(calls.length, 2);
    assert.match(calls[1]!, /image\.pollinations\.ai/);
  }

  let calls = 0;
  const unauthorized = createImageGenerator({
    ...BASE_DEPS,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 401 });
    },
  });
  await assert.rejects(
    unauthorized({ prompt: 'sem máscara', width: 768, height: 768 }),
    (error: unknown) => error instanceof AppError && !error.retryable,
  );
  assert.equal(calls, 1);
});

test('dimensão incompatível e modo baseline permanecem no adaptador de fallback', async () => {
  for (const mode of ['pollinations', 'cloudflare-primary'] as const) {
    const calls: string[] = [];
    const generate = createImageGenerator({
      ...BASE_DEPS,
      mode,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(PNG_IMAGE);
      },
    });
    await generate({ prompt: 'pequena', width: mode === 'pollinations' ? 768 : 128, height: 768 });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /image\.pollinations\.ai/);
  }
});

test('bucket do canário é determinístico e não exige registrar o prompt', () => {
  const input = { prompt: 'mesmo prompt', width: 768, height: 768 };
  const first = imageGenerationCanaryBucket(input);
  assert.equal(imageGenerationCanaryBucket(input), first);
  assert.ok(first >= 0 && first <= 99);
});

test('mídia 200 que não é imagem dispara fallback em vez de ser publicada', async () => {
  const calls: string[] = [];
  const generate = createImageGenerator({
    ...BASE_DEPS,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('api.cloudflare.com')) {
        return new Response(JSON.stringify({ result: { image: Buffer.from('html').toString('base64') } }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(PNG_IMAGE);
    },
  });
  assert.deepEqual(await generate({ prompt: 'imagem válida', width: 768, height: 768 }), PNG_IMAGE);
  assert.equal(calls.length, 2);
});
