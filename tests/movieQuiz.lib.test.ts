import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import { requestMovieQuiz } from '../src/lib/movieQuiz.ts';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

function upstream(overrides: Record<string, unknown> = {}) {
  return {
    response_code: 0,
    results: [{
      type: b64('multiple'),
      difficulty: b64('medium'),
      category: b64('Entertainment: Film'),
      question: b64('Qual alternativa é a correta?'),
      correct_answer: b64('Correta'),
      incorrect_answers: [b64('Errada 1'), b64('Errada 2'), b64('Errada 3')],
      ...overrides,
    }],
  };
}

test('requestMovieQuiz fixa categoria, normaliza base64 e embaralha sem perder a resposta', async () => {
  let observedUrl = '';
  const result = await requestMovieQuiz('medium', {
    timeoutMs: 1_000,
    maxResponseBytes: 64 * 1024,
    randomIndex: () => 0,
    fetchImpl: async (input) => {
      assert.ok(input instanceof URL);
      observedUrl = input.toString();
      return new Response(JSON.stringify(upstream()), { status: 200 });
    },
  });

  const url = new URL(observedUrl);
  assert.equal(url.origin, 'https://opentdb.com');
  assert.equal(url.pathname, '/api.php');
  assert.equal(url.searchParams.get('amount'), '1');
  assert.equal(url.searchParams.get('category'), '11');
  assert.equal(url.searchParams.get('type'), 'multiple');
  assert.equal(url.searchParams.get('encode'), 'base64');
  assert.equal(url.searchParams.get('difficulty'), 'medium');
  assert.equal(result.category, 'movies');
  assert.equal(result.question, 'Qual alternativa é a correta?');
  assert.equal(result.correctChoiceId, 'D');
  assert.equal(result.choices.find((choice) => choice.id === 'D')?.text, 'Correta');
  assert.equal(result.attribution.license, 'CC BY-SA 4.0');
});

test('requestMovieQuiz recusa categoria, alternativas e base64 fora do contrato', async () => {
  const invalidPayloads = [
    upstream({ category: b64('Entertainment: Music') }),
    upstream({ incorrect_answers: [b64('Errada 1')] }),
    upstream({ correct_answer: '***' }),
    upstream({ incorrect_answers: [b64('Correta'), b64('Errada 2'), b64('Errada 3')] }),
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      requestMovieQuiz(undefined, {
        timeoutMs: 1_000,
        maxResponseBytes: 64 * 1024,
        fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
      }),
      (error: unknown) => error instanceof AppError && error.statusCode === 503,
    );
  }
});

test('requestMovieQuiz sanitiza falha de rede e traduz timeout', async () => {
  await assert.rejects(
    requestMovieQuiz(undefined, {
      timeoutMs: 1_000,
      maxResponseBytes: 64 * 1024,
      fetchImpl: async () => { throw new Error('segredo-em-erro'); },
    }),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'BUNNYFY_UNAVAILABLE'
      && !JSON.stringify(error).includes('segredo-em-erro'),
  );

  await assert.rejects(
    requestMovieQuiz(undefined, {
      timeoutMs: 5,
      maxResponseBytes: 64 * 1024,
      fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    }),
    (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT',
  );
});
