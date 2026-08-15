import { randomInt } from 'node:crypto';

import { AppError } from '../envelope.ts';
import { readBodyWithLimit } from '../security/ssrf.ts';

const ENDPOINT = 'https://opentdb.com/api.php';
const MOVIE_CATEGORY_ID = '11';
const MAX_TEXT_CHARS = 600;

export const MOVIE_QUIZ_ATTRIBUTION = Object.freeze({
  name: 'Open Trivia Database',
  url: 'https://opentdb.com/',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
});

export type MovieQuizDifficulty = 'easy' | 'medium' | 'hard';

export interface MovieQuizChoice {
  id: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export interface MovieQuizResult {
  category: 'movies';
  difficulty: MovieQuizDifficulty;
  type: 'multiple-choice';
  question: string;
  choices: MovieQuizChoice[];
  correctChoiceId: MovieQuizChoice['id'];
  attribution: typeof MOVIE_QUIZ_ATTRIBUTION;
}

export interface MovieQuizDeps {
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
  randomIndex?: (upperExclusive: number) => number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function decodeBase64Text(value: unknown, field: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 4_000
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw AppError.unavailable(`Conteúdo de quiz inválido (${field}).`);
  }

  const decoded = Buffer.from(value, 'base64').toString('utf8').trim();
  if (
    decoded.length === 0
    || decoded.length > MAX_TEXT_CHARS
    || [...decoded].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw AppError.unavailable(`Conteúdo de quiz inválido (${field}).`);
  }
  return decoded;
}

function parseDifficulty(value: unknown): MovieQuizDifficulty {
  const decoded = decodeBase64Text(value, 'difficulty').toLowerCase();
  if (decoded === 'easy' || decoded === 'medium' || decoded === 'hard') return decoded;
  throw AppError.unavailable('Conteúdo de quiz com dificuldade inválida.');
}

function shuffledChoices(
  correct: string,
  incorrect: string[],
  pickIndex: (upperExclusive: number) => number,
): { choices: MovieQuizChoice[]; correctChoiceId: MovieQuizChoice['id'] } {
  const values = [correct, ...incorrect];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const selected = pickIndex(index + 1);
    if (!Number.isInteger(selected) || selected < 0 || selected > index) {
      throw AppError.internal('Gerador aleatório retornou índice inválido.');
    }
    [values[index], values[selected]] = [values[selected]!, values[index]!];
  }

  const ids = ['A', 'B', 'C', 'D'] as const;
  const choices = values.map((text, index) => ({ id: ids[index]!, text }));
  const correctChoice = choices.find((choice) => choice.text === correct);
  if (!correctChoice) throw AppError.internal('Resposta correta ausente após embaralhamento.');
  return { choices, correctChoiceId: correctChoice.id };
}

export async function requestMovieQuiz(
  difficulty: MovieQuizDifficulty | undefined,
  deps: MovieQuizDeps,
): Promise<MovieQuizResult> {
  const endpoint = new URL(ENDPOINT);
  endpoint.searchParams.set('amount', '1');
  endpoint.searchParams.set('category', MOVIE_CATEGORY_ID);
  endpoint.searchParams.set('type', 'multiple');
  endpoint.searchParams.set('encode', 'base64');
  if (difficulty) endpoint.searchParams.set('difficulty', difficulty);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw AppError.upstreamTimeout('O quiz de cinema excedeu o tempo limite.');
    }
    throw AppError.unavailable('O quiz de cinema está temporariamente indisponível.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    await response.body?.cancel('movie-quiz-upstream-status').catch(() => undefined);
    throw AppError.unavailable('O quiz de cinema está temporariamente indisponível.');
  }

  let raw: Buffer;
  try {
    raw = await readBodyWithLimit(response, deps.maxResponseBytes);
  } catch {
    throw AppError.unavailable('O quiz de cinema retornou uma resposta inválida.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw AppError.unavailable('O quiz de cinema retornou uma resposta inválida.');
  }

  const root = asRecord(payload);
  const results = root?.results;
  if (root?.response_code !== 0 || !Array.isArray(results) || results.length !== 1) {
    throw AppError.unavailable('Nenhuma pergunta de cinema está disponível agora.');
  }
  const item = asRecord(results[0]);
  if (!item || decodeBase64Text(item.type, 'type') !== 'multiple') {
    throw AppError.unavailable('Conteúdo de quiz em formato incompatível.');
  }

  const category = decodeBase64Text(item.category, 'category');
  if (category !== 'Entertainment: Film') {
    throw AppError.unavailable('Conteúdo de quiz fora da categoria solicitada.');
  }
  const question = decodeBase64Text(item.question, 'question');
  const correct = decodeBase64Text(item.correct_answer, 'correct_answer');
  if (!Array.isArray(item.incorrect_answers) || item.incorrect_answers.length !== 3) {
    throw AppError.unavailable('Conteúdo de quiz sem alternativas válidas.');
  }
  const incorrect = item.incorrect_answers.map((choice, index) =>
    decodeBase64Text(choice, `incorrect_answer_${index}`));
  const allAnswers = [correct, ...incorrect];
  if (new Set(allAnswers).size !== allAnswers.length) {
    throw AppError.unavailable('Conteúdo de quiz com alternativas duplicadas.');
  }

  const shuffled = shuffledChoices(
    correct,
    incorrect,
    deps.randomIndex ?? ((upperExclusive) => randomInt(upperExclusive)),
  );
  return {
    category: 'movies',
    difficulty: parseDifficulty(item.difficulty),
    type: 'multiple-choice',
    question,
    ...shuffled,
    attribution: MOVIE_QUIZ_ATTRIBUTION,
  };
}
