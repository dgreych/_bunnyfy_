import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestApp } from './helpers/testApp.ts';

test('GET /health não exige autenticação e responde ok', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ok');
  } finally {
    await close();
  }
});

test('GET /ready não exige autenticação e reporta núcleo e capacidades', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.data.status, 'ready');
    assert.equal(body.data.checks.storageWritable, true);
    assert.equal(body.data.checks.capabilities.mediaUpload, true);
    assert.equal(body.data.checks.capabilities.socialCanvas, true);
    assert.equal(typeof body.data.checks.capabilities.animatedLogos, 'boolean');
    assert.equal(typeof body.data.checks.tools.ytDlp, 'boolean');
    assert.equal(typeof body.data.checks.tools.deno, 'boolean');
    assert.equal(typeof body.data.checks.tools.ffmpeg, 'boolean');
    assert.equal(typeof body.data.checks.tools.whisperCli, 'boolean');
    assert.equal(typeof body.data.checks.models.whisper, 'boolean');
    assert.equal(typeof body.data.checks.capabilities.youtube, 'boolean');
    assert.equal(typeof body.data.checks.capabilities.transcription, 'boolean');
    assert.equal(body.data.checks.capabilities.aiChat, false);
    assert.equal(body.data.checks.capabilities.movieQuiz, false);
  } finally {
    await close();
  }
});

test('GET /ready publica apenas o booleano do quiz de cinema', async () => {
  const { app, close } = await createTestApp({ envOverrides: { MOVIE_QUIZ_ENABLED: 'true' } });
  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.checks.capabilities.movieQuiz, true);
  } finally {
    await close();
  }
});

test('GET /ready considera o egress configurado sem expor URL ou segredo', async () => {
  const workerUrl = 'https://egress-private.example.test';
  const workerSecret = 'segredo-egress-private-0123456789abcdef';
  const { app, close } = await createTestApp({
    envOverrides: {
      YOUTUBE_EGRESS_ENABLED: 'true',
      YOUTUBE_EGRESS_URL: workerUrl,
      YOUTUBE_EGRESS_SHARED_SECRET: workerSecret,
      YTDLP_PATH: '/inexistente/yt-dlp',
      FFMPEG_PATH: '/inexistente/ffmpeg',
      YOUTUBE_JS_RUNTIME: 'node',
      YOUTUBE_JS_RUNTIME_PATH: '/inexistente/node',
    },
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.checks.capabilities.youtube, true);
    assert.equal(response.body.includes(workerUrl), false);
    assert.equal(response.body.includes(workerSecret), false);
  } finally {
    await close();
  }
});

test('GET /ready considera o fallback configurado sem expor URL ou credencial', async () => {
  const fallbackUrl = 'https://fallback-private.example.test';
  const fallbackKey = 'fallback-private-key-0123456789';
  const { app, close } = await createTestApp({
    envOverrides: {
      YOUTUBE_FALLBACK_ENABLED: 'true',
      YOUTUBE_FALLBACK_BASE_URL: fallbackUrl,
      YOUTUBE_FALLBACK_API_KEY: fallbackKey,
      YTDLP_PATH: '/inexistente/yt-dlp',
      FFMPEG_PATH: '/inexistente/ffmpeg',
      YOUTUBE_JS_RUNTIME: 'node',
      YOUTUBE_JS_RUNTIME_PATH: '/inexistente/node',
    },
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.checks.capabilities.youtube, true);
    assert.equal(response.body.includes(fallbackUrl), false);
    assert.equal(response.body.includes(fallbackKey), false);
  } finally {
    await close();
  }
});

test('GET /ready expõe apenas booleano da conversa de IA quando configurada', async () => {
  const privateKey = 'provider-test-key-0123456789abcdef';
  const privateModel = 'example/private-model';
  const { app, close } = await createTestApp({
    envOverrides: {
      AI_CHAT_ENABLED: 'true',
      NVIDIA_API_KEY: privateKey,
      NVIDIA_MODEL: privateModel,
    },
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 200);
    const serialized = response.body;
    assert.equal(response.json().data.checks.capabilities.aiChat, true);
    assert.equal(serialized.includes(privateKey), false);
    assert.equal(serialized.includes(privateModel), false);
    assert.equal(serialized.toLowerCase().includes('nvidia'), false);
  } finally {
    await close();
  }
});

test('GET /ready mantém núcleo pronto sem Whisper e não expõe caminhos locais', async () => {
  const whisperCliPath = `/caminho-privado/whisper-inexistente-${process.pid}`;
  const whisperModelPath = `/caminho-privado/modelo-inexistente-${process.pid}.bin`;
  const { app, close } = await createTestApp({
    envOverrides: {
      WHISPER_CLI_PATH: whisperCliPath,
      WHISPER_MODEL_PATH: whisperModelPath,
    },
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.equal(body.data.status, 'ready');
    assert.equal(body.data.checks.storageWritable, true);
    assert.equal(body.data.checks.tools.whisperCli, false);
    assert.equal(body.data.checks.models.whisper, false);
    assert.equal(body.data.checks.capabilities.mediaUpload, true);
    assert.equal(body.data.checks.capabilities.socialCanvas, true);
    assert.equal(body.data.checks.capabilities.transcription, false);

    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(whisperCliPath), false);
    assert.equal(serialized.includes(whisperModelPath), false);
  } finally {
    await close();
  }
});

test('rota inexistente retorna 404 no envelope canônico', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/rota-que-nao-existe' });
    assert.equal(response.statusCode, 404);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'BUNNYFY_NOT_FOUND');
  } finally {
    await close();
  }
});
