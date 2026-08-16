import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import { requestCloudflareImage } from '../src/lib/cloudflareImage.ts';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const API_TOKEN = 'cloudflare-test-token-0123456789';
const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const PNG_IMAGE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('cloudflare-image'),
]);

function deps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    model: MODEL,
    timeoutMs: 1_000,
    maxResponseBytes: 10_000,
    maxOutputBytes: 5_000,
    fetchImpl,
  };
}

test('envia prompt literal em multipart e decodifica result.image Base64', async () => {
  const prompt = 'um gato azul, exatamente dois olhos, sem texto';
  const output = await requestCloudflareImage(prompt, 768, 1024, deps(async (url, init) => {
    assert.equal(
      String(url),
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`,
    );
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${API_TOKEN}`);
    assert.equal(init?.redirect, 'error');
    const form = init?.body as FormData;
    assert.equal(form.get('prompt'), prompt);
    assert.equal(form.get('width'), '768');
    assert.equal(form.get('height'), '1024');
    return new Response(JSON.stringify({ success: true, result: { image: PNG_IMAGE.toString('base64') } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));

  assert.deepEqual(output, PNG_IMAGE);
});

test('aceita data URI e resposta binária sem confiar no nome do modelo', async () => {
  const encoded = `data:image/png;base64,${PNG_IMAGE.toString('base64')}`;
  const fromDataUri = await requestCloudflareImage('prompt', 512, 512, deps(async () =>
    new Response(JSON.stringify({ result: { image: encoded } }), {
      headers: { 'content-type': 'application/json' },
    })));
  assert.deepEqual(fromDataUri, PNG_IMAGE);

  const raw = await requestCloudflareImage('prompt', 512, 512, deps(async () =>
    new Response(PNG_IMAGE, { headers: { 'content-type': 'image/png' } })));
  assert.deepEqual(raw, PNG_IMAGE);
});

test('429 e 5xx são transitórios; erro de autenticação não é', async () => {
  for (const status of [429, 500, 503]) {
    await assert.rejects(
      requestCloudflareImage('prompt', 512, 512, deps(async () => new Response(null, { status }))),
      (error: unknown) => error instanceof AppError
        && error.code === 'BUNNYFY_UNAVAILABLE'
        && error.retryable
        && !error.message.includes('Cloudflare'),
    );
  }

  await assert.rejects(
    requestCloudflareImage('prompt', 512, 512, deps(async () => new Response(null, { status: 401 }))),
    (error: unknown) => error instanceof AppError
      && error.code === 'BUNNYFY_UNAVAILABLE'
      && !error.retryable
      && !error.message.includes(API_TOKEN),
  );
});

test('recusa Base64 inválido e corpo acima do teto', async () => {
  await assert.rejects(
    requestCloudflareImage('prompt', 512, 512, deps(async () =>
      new Response(JSON.stringify({ result: { image: '*não-é-base64*' } }), {
        headers: { 'content-type': 'application/json' },
      }))),
    (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_UNAVAILABLE',
  );

  await assert.rejects(
    requestCloudflareImage('prompt', 512, 512, {
      ...deps(async () => new Response('x'.repeat(200), {
        headers: { 'content-type': 'application/json', 'content-length': '200' },
      })),
      maxResponseBytes: 100,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TOO_LARGE',
  );
});

test('honra timeout e AbortSignal do chamador', async () => {
  const neverCompletes: typeof fetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
      else signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });

  await assert.rejects(
    requestCloudflareImage('prompt', 512, 512, { ...deps(neverCompletes), timeoutMs: 5 }),
    (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT',
  );

  const caller = new AbortController();
  caller.abort();
  await assert.rejects(
    requestCloudflareImage('prompt', 512, 512, { ...deps(neverCompletes), signal: caller.signal }),
    (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT',
  );
});
