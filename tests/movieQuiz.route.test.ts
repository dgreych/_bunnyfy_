import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOVIE_QUIZ_ATTRIBUTION, type MovieQuizResult } from '../src/lib/movieQuiz.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const RESULT: MovieQuizResult = {
  category: 'movies',
  difficulty: 'easy',
  type: 'multiple-choice',
  question: 'Pergunta controlada?',
  choices: [
    { id: 'A', text: 'A' },
    { id: 'B', text: 'B' },
    { id: 'C', text: 'C' },
    { id: 'D', text: 'D' },
  ],
  correctChoiceId: 'A',
  attribution: MOVIE_QUIZ_ATTRIBUTION,
};

test('POST /v1/games/quiz exige Bearer e escopo antes da capacidade', async () => {
  const { app, close } = await createTestApp({ envOverrides: { MOVIE_QUIZ_ENABLED: 'true' } });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/games/quiz',
      payload: { category: 'movies' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'BUNNYFY_AUTH_FAILED');
  } finally {
    await close();
  }
});

test('POST /v1/games/quiz fica indisponível quando a flag está desligada', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/games/quiz',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { category: 'movies' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'BUNNYFY_TOOL_UNAVAILABLE');
  } finally {
    await close();
  }
});

test('POST /v1/games/quiz devolve contrato normalizado e aplica janela mínima', async () => {
  let difficulty: string | undefined;
  const { app, close } = await createTestApp({
    envOverrides: { MOVIE_QUIZ_ENABLED: 'true' },
    movieQuiz: async (requestedDifficulty) => {
      difficulty = requestedDifficulty;
      return RESULT;
    },
  });
  const request = {
    method: 'POST' as const,
    url: '/v1/games/quiz',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: { category: 'movies', difficulty: 'easy' },
  };
  try {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(difficulty, 'easy');
    assert.deepEqual(response.json().data, RESULT);

    const limited = await app.inject(request);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'BUNNYFY_RATE_LIMITED');
  } finally {
    await close();
  }
});

test('POST /v1/games/quiz rejeita categoria, dificuldade e campos extras', async () => {
  const { app, close } = await createTestApp({ envOverrides: { MOVIE_QUIZ_ENABLED: 'true' } });
  try {
    for (const payload of [
      { category: 'music' },
      { category: 'movies', difficulty: 'impossible' },
      { category: 'movies', extra: true },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/games/quiz',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    }
  } finally {
    await close();
  }
});
