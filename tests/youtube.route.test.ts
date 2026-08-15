import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import {
  downloadYoutubeMedia,
  MINIMUM_YTDLP_VERSION,
  type YoutubeDownloadInput,
  type YoutubeDownloadResult,
} from '../src/lib/youtube.ts';
import { buildLogger } from '../src/logger.ts';
import type { DnsLookup } from '../src/security/ssrf.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const PUBLIC_DNS: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const PRIVATE_DNS: DnsLookup = async () => [{ address: '10.0.0.5', family: 4 }];
const VIDEO_ID = 'AbCdEfGhI_1';
const SECOND_VIDEO_ID = 'ZyXwVuTsRq0';
const CANONICAL_YOUTUBE_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const SHORT_YOUTUBE_URL = `https://youtu.be/${VIDEO_ID}`;

const FAKE_RESULT: YoutubeDownloadResult = {
  mediaId: 'fake-media-id-000000000000',
  mimeType: 'audio/mpeg',
  sizeBytes: 1234,
  title: 'Vídeo de teste',
  durationSeconds: 42,
  thumbnailUrl: 'https://example.com/thumb.jpg',
};

test('POST /v1/downloads/youtube/audio sem Authorization retorna 401', async () => {
  const { app, close } = await createTestApp({ dnsLookup: PUBLIC_DNS });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      payload: { url: CANONICAL_YOUTUBE_URL },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await close();
  }
});

test('POST /v1/downloads/youtube/audio sem "url" nem "query" no corpo retorna 400', async () => {
  const { app, close } = await createTestApp({ dnsLookup: PUBLIC_DNS });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: {},
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
  } finally {
    await close();
  }
});

test('contrato exige exatamente um entre "url" e "query" e rejeita campos desconhecidos', async () => {
  let downloadCalled = false;
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async () => {
      downloadCalled = true;
      return FAKE_RESULT;
    },
  });
  try {
    for (const payload of [
      { url: CANONICAL_YOUTUBE_URL, query: 'música' },
      { query: 'música', arbitrary: true },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/audio',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    }
    assert.equal(downloadCalled, false);
  } finally {
    await close();
  }
});

test('bloqueia host fora da allowlist do YouTube antes de chamar o downloader', async () => {
  let downloadCalled = false;
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async () => {
      downloadCalled = true;
      return FAKE_RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: 'https://attacker.example/not-youtube' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_URL_BLOCKED');
    assert.equal(downloadCalled, false);
  } finally {
    await close();
  }
});

test('bloqueia quando o host do YouTube resolve pra endereço privado (SSRF) antes de baixar', async () => {
  let downloadCalled = false;
  const { app, close } = await createTestApp({
    dnsLookup: PRIVATE_DNS,
    youtubeDownload: async () => {
      downloadCalled = true;
      return FAKE_RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: CANONICAL_YOUTUBE_URL },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'BUNNYFY_URL_BLOCKED');
    assert.equal(downloadCalled, false);
  } finally {
    await close();
  }
});

test('baixa com sucesso (downloader falso) e devolve envelope com mediaUrl assinada', async () => {
  let receivedInput: YoutubeDownloadInput | undefined;
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async (_kind, input) => {
      receivedInput = input;
      return FAKE_RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: CANONICAL_YOUTUBE_URL },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.title, 'Vídeo de teste');
    assert.equal(body.data.durationSeconds, 42);
    assert.equal(body.data.thumbnail, 'https://example.com/thumb.jpg');
    assert.equal(body.data.quality, null);
    assert.equal(body.data.media.mime, 'audio/mpeg');
    assert.equal(body.data.media.bytes, 1234);
    assert.ok(body.data.media.mediaUrl.startsWith('/v1/media/'));
    assert.deepEqual(receivedInput, { type: 'url', value: CANONICAL_YOUTUBE_URL });
  } finally {
    await close();
  }
});

test('URL direta é reduzida a um identificador canônico antes do subprocesso', async () => {
  const received: YoutubeDownloadInput[] = [];
  const resolvedHosts: string[] = [];
  const { app, close } = await createTestApp({
    dnsLookup: async (hostname) => {
      resolvedHosts.push(hostname);
      return [{ address: '93.184.216.34', family: 4 }];
    },
    youtubeDownload: async (_kind, input) => {
      received.push(input);
      return FAKE_RESULT;
    },
  });

  try {
    for (const url of [
      SHORT_YOUTUBE_URL,
      `https://youtube.com/shorts/${VIDEO_ID}?feature=share`,
      `https://m.youtube.com/live/${VIDEO_ID}#fragmento`,
      `https://music.youtube.com/watch?v=${VIDEO_ID}&list=descartada`,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/audio',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { url },
      });
      assert.equal(response.statusCode, 200);
    }
    assert.deepEqual(received, Array.from({ length: 4 }, () => ({
      type: 'url',
      value: CANONICAL_YOUTUBE_URL,
    })));
    assert.deepEqual(resolvedHosts, Array.from({ length: 4 }, () => 'www.youtube.com'));
  } finally {
    await close();
  }
});

test('URL direta recusa redirect, busca, subdomínio, porta, HTTP e id inválido', async () => {
  let downloadCalled = false;
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async () => {
      downloadCalled = true;
      return FAKE_RESULT;
    },
  });

  try {
    for (const url of [
      `https://youtube.com/redirect?q=http://127.0.0.1/private&v=${VIDEO_ID}`,
      `https://youtube.com/results?search_query=${VIDEO_ID}`,
      `https://evil.youtube.com/watch?v=${VIDEO_ID}`,
      `https://youtube.com:444/watch?v=${VIDEO_ID}`,
      `http://youtube.com/watch?v=${VIDEO_ID}`,
      'https://youtu.be/curto',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/audio',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { url },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_URL_BLOCKED');
    }
    assert.equal(downloadCalled, false);
  } finally {
    await close();
  }
});

test('busca textual atende o vertical de áudio sem DNS, sem ecoar consulta ou URL de origem', async () => {
  const privateQuery = 'minha consulta musical privada';
  let receivedInput: YoutubeDownloadInput | undefined;
  let receivedMaxBytes: number | undefined;
  const logLines: string[] = [];
  const logger = buildLogger(
    { logLevel: 'info', logPretty: false },
    new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(chunk.toString('utf8'));
        callback();
      },
    }),
  );
  const { app, close } = await createTestApp({
    envOverrides: {
      MEDIA_MAX_BYTES: String(5 * 1024 * 1024),
      DOWNLOAD_MAX_BYTES: String(7 * 1024 * 1024),
    },
    logger,
    dnsLookup: async () => {
      throw new Error('busca textual não deve resolver host fornecido pelo cliente');
    },
    youtubeDownload: async (_kind, input, _quality, deps) => {
      receivedInput = input;
      receivedMaxBytes = deps.maxBytes;
      return FAKE_RESULT;
    },
  });

  let responseBody = '';
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { query: `  ${privateQuery}  ` },
    });
    assert.equal(response.statusCode, 200);
    responseBody = response.body;
    assert.deepEqual(receivedInput, { type: 'query', value: privateQuery });
    assert.equal(receivedMaxBytes, 7 * 1024 * 1024);
  } finally {
    await close();
  }

  assert.equal(responseBody.includes(privateQuery), false);
  assert.equal(responseBody.includes('youtube.com/watch'), false);
  assert.equal(logLines.join('\n').includes(privateQuery), false);
});

test('busca textual limita tamanho e recusa caracteres de controle antes do downloader', async () => {
  let downloadCalled = false;
  const { app, close } = await createTestApp({
    youtubeDownload: async () => {
      downloadCalled = true;
      return FAKE_RESULT;
    },
  });
  try {
    for (const query of ['x'.repeat(201), 'linha\nseguinte']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/audio',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { query },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    }
    assert.equal(downloadCalled, false);
  } finally {
    await close();
  }
});

test('falha do subprocesso não leva consulta privada ao erro, resposta ou log da rota', async () => {
  const privateQuery = 'MARCADOR_PRIVADO_DA_BUSCA_92731';
  const logLines: string[] = [];
  const logger = buildLogger(
    { logLevel: 'info', logPretty: false },
    new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(chunk.toString('utf8'));
        callback();
      },
    }),
  );
  const { app, close } = await createTestApp({
    logger,
    youtubeDownload: async (kind, input, quality, deps) =>
      downloadYoutubeMedia(kind, input, quality, {
        ...deps,
        toolAvailable: async () => true,
        toolVersion: async () => MINIMUM_YTDLP_VERSION,
        runProcess: async () => {
          const rawError = new Error(`falha incluindo ${privateQuery}`) as Error & { cmd?: string };
          rawError.cmd = `yt-dlp ytsearch1:${privateQuery}`;
          throw rawError;
        },
      }),
  });

  let responseBody = '';
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { query: privateQuery },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'BUNNYFY_UNAVAILABLE');
    assert.equal(response.json().error.retryable, true);
    responseBody = response.body;
  } finally {
    await close();
  }

  assert.equal(responseBody.includes(privateQuery), false);
  assert.equal(logLines.join('\n').includes(privateQuery), false);
});

test('áudio aceita somente quality ausente ou "best"', async () => {
  const receivedQualities: Array<string | undefined> = [];
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async (_kind, _input, quality) => {
      receivedQualities.push(quality);
      return FAKE_RESULT;
    },
  });
  try {
    for (const quality of [undefined, 'best']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/audio',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: quality === undefined
          ? { query: 'música' }
          : { query: 'música', quality },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().data.quality, quality ?? null);
    }

    for (const quality of ['360p', '128kbps', 'BEST']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/audio',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { query: 'música', quality },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    }
    assert.deepEqual(receivedQualities, [undefined, 'best']);
  } finally {
    await close();
  }
});

test('vídeo aceita a matriz 360p/480p/720p/1080p/best e recusa qualidade desconhecida', async () => {
  const receivedQualities: Array<string | undefined> = [];
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async (_kind, _input, quality) => {
      receivedQualities.push(quality);
      return FAKE_RESULT;
    },
  });
  try {
    const allowed = ['360p', '480p', '720p', '1080p', 'best'] as const;
    for (const quality of allowed) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/video',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { url: CANONICAL_YOUTUBE_URL, quality },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().data.quality, quality);
    }

    for (const quality of ['2160p', 'auto', '720P']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/downloads/youtube/video',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { url: 'https://youtube.com/watch?v=abc', quality },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    }
    assert.deepEqual(receivedQualities, allowed);
  } finally {
    await close();
  }
});

test('vertical de vídeo aceita a mesma URL e responde 200 (downloader falso)', async () => {
  let receivedInput: YoutubeDownloadInput | undefined;
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async (_kind, input) => {
      receivedInput = input;
      return FAKE_RESULT;
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/video',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: SHORT_YOUTUBE_URL },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(receivedInput, { type: 'url', value: CANONICAL_YOUTUBE_URL });
  } finally {
    await close();
  }
});

test('ferramenta ausente (yt-dlp/ffmpeg) vira 503 estável, não derruba o processo', async () => {
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async () => {
      throw AppError.toolUnavailable('Ferramenta de download indisponível no servidor (yt-dlp).');
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: CANONICAL_YOUTUBE_URL },
    });
    assert.equal(response.statusCode, 503);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'BUNNYFY_TOOL_UNAVAILABLE');
    assert.equal(body.error.retryable, true);
  } finally {
    await close();
  }
});

test('limite de concorrência é compartilhado entre busca textual e URL direta', async () => {
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let notifyEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    notifyEntered = resolve;
  });
  let calls = 0;

  const { app, close } = await createTestApp({
    envOverrides: { YOUTUBE_DOWNLOAD_MAX_CONCURRENCY: '1' },
    dnsLookup: PUBLIC_DNS,
    youtubeDownload: async () => {
      calls += 1;
      if (calls === 1) {
        notifyEntered();
        await gate;
      }
      return FAKE_RESULT;
    },
  });

  try {
    const first = app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/audio',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { query: 'primeira busca' },
    });
    await entered;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/downloads/youtube/video',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: `https://www.youtube.com/watch?v=${SECOND_VIDEO_ID}` },
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'BUNNYFY_RATE_LIMITED');
    assert.equal(calls, 1);

    releaseFirst();
    assert.equal((await first).statusCode, 200);
  } finally {
    releaseFirst();
    await close();
  }
});
