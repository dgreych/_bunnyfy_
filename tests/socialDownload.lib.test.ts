import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import {
  downloadScrapedSocialMedia,
  SOCIAL_PROVIDER_ALLOWED_HOSTS,
  type SocialScrapeDeps,
} from '../src/lib/socialDownload.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

const PUBLIC_ADDRESS = '93.184.216.34';
const fakeDnsLookup = async () => [{ address: PUBLIC_ADDRESS, family: 4 }];

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function withDeps(
  run: (deps: SocialScrapeDeps, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-social-scrape-test-'));
  const tempStorage = new TempStorage({
    dir,
    ttlMs: 60_000,
    maxBytes: 10 * 1024 * 1024,
    sweepIntervalMs: 3_600_000,
  });
  await tempStorage.init();

  const deps: SocialScrapeDeps = {
    tempStorage,
    timeoutMs: 10_000,
    maxBytes: 10 * 1024 * 1024,
    dnsLookup: fakeDnsLookup,
  };

  try {
    await run(deps, dir);
  } finally {
    await tempStorage.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('allowlist restringe a URL de entrada aos domínios do próprio provedor', () => {
  assert.deepEqual(SOCIAL_PROVIDER_ALLOWED_HOSTS.tiktok, ['tiktok.com']);
  assert.deepEqual(SOCIAL_PROVIDER_ALLOWED_HOSTS.kwai, ['kwai.com']);
});

test('URL fora da allowlist do provedor é bloqueada antes de qualquer requisição', async () => {
  await withDeps(async (deps) => {
    deps.fetchImpl = async () => {
      throw new Error('não deveria fazer nenhuma requisição de rede');
    };
    await assert.rejects(
      () => downloadScrapedSocialMedia('tiktok', 'https://outrosite.com/video/1', deps),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_URL_BLOCKED',
    );
  });
});

test('TikTok resolve via tikwm.com e baixa o vídeo sem marca d\'água', async () => {
  await withDeps(async (deps) => {
    const calls: string[] = [];
    deps.fetchImpl = async (input) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes('tikwm.com')) {
        return jsonResponse({
          code: 0,
          data: {
            title: 'Vídeo de teste',
            duration: 15,
            cover: 'https://p.tiktokcdn.com/cover.jpg',
            play: 'https://v.tiktokcdn.com/sem-marca.mp4',
          },
        });
      }
      assert.equal(url, 'https://v.tiktokcdn.com/sem-marca.mp4');
      return new Response(Buffer.alloc(256), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    };

    const result = await downloadScrapedSocialMedia(
      'tiktok',
      'https://www.tiktok.com/@user/video/123',
      deps,
    );
    assert.equal(result.sizeBytes, 256);
    assert.equal(result.title, 'Vídeo de teste');
    assert.equal(result.durationSeconds, 15);
    assert.equal(calls.length, 2);
  });
});

test('TikTok: resposta de erro da API vira erro canônico sem derrubar o processo', async () => {
  await withDeps(async (deps) => {
    deps.fetchImpl = async () => jsonResponse({ code: -1, msg: 'Url parsing is failed!' });
    await assert.rejects(
      () => downloadScrapedSocialMedia('tiktok', 'https://www.tiktok.com/@user/video/123', deps),
      (error: unknown) => error instanceof AppError,
    );
  });
});

test('Kwai extrai a URL de vídeo do estado inicial embutido na página pública', async () => {
  await withDeps(async (deps) => {
    const calls: string[] = [];
    deps.fetchImpl = async (input) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes('kwai.com')) {
        // Reproduz o formato real: objeto serializado pelo Nuxt sem aspas nas
        // chaves (não é JSON-LD isolado), barras escapadas como /, mais
        // <title> e og:image nos metadados de SEO.
        const html = '<html><head>'
          + '<title>Vídeo do Kwai| Kwai</title>'
          + '<meta property="og:image" content="https://cdn.kwai.net/thumb.jpg">'
          + '<script>window.__NUXT__=(function(){return {name:"Vídeo do Kwai",'
          + 'contentUrl:"https:\\u002F\\u002Fcdn.kwai.net\\u002Fvideo.mp4",'
          + 'duration:"PT1M5S"}})();</script>'
          + '</head><body></body></html>';
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      assert.equal(url, 'https://cdn.kwai.net/video.mp4');
      return new Response(Buffer.alloc(512), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    };

    const result = await downloadScrapedSocialMedia(
      'kwai',
      'https://www.kwai.com/@user/video/456',
      deps,
    );
    assert.equal(result.sizeBytes, 512);
    assert.equal(result.title, 'Vídeo do Kwai');
    assert.equal(result.durationSeconds, 65);
    assert.equal(calls.length, 2);
  });
});

test('Kwai: página sem contentUrl vira erro canônico', async () => {
  await withDeps(async (deps) => {
    deps.fetchImpl = async () => new Response('<html><body>não encontrado</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    await assert.rejects(
      () => downloadScrapedSocialMedia('kwai', 'https://www.kwai.com/@user/video/456', deps),
      (error: unknown) => error instanceof AppError,
    );
  });
});

test('vídeo resolvido acima do limite de bytes é recusado antes de gravar', async () => {
  await withDeps(async (deps) => {
    deps.maxBytes = 100;
    deps.fetchImpl = async (input) => {
      const url = requestUrl(input);
      if (url.includes('tikwm.com')) {
        return jsonResponse({
          code: 0,
          data: { title: 'x', duration: 1, play: 'https://v.tiktokcdn.com/grande.mp4' },
        });
      }
      return new Response(Buffer.alloc(10), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '999999' },
      });
    };
    await assert.rejects(
      () => downloadScrapedSocialMedia('tiktok', 'https://www.tiktok.com/@user/video/123', deps),
      (error: unknown) => error instanceof AppError && error.statusCode === 413,
    );
  });
});
