import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SocialDownloadResult } from '../src/lib/socialDownload.ts';
import type { YtDlpVideoDownloadResult } from '../src/lib/ytdlpVideoDownload.ts';
import type { DnsLookup } from '../src/security/ssrf.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const PUBLIC_DNS: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const FAKE_YTDLP_RESULT: YtDlpVideoDownloadResult = {
  mediaId: 'fake-ytdlp-media-000000000',
  mimeType: 'video/mp4',
  sizeBytes: 4321,
  title: 'Vídeo de teste',
  durationSeconds: 30,
  thumbnailUrl: 'https://example.com/thumb.jpg',
};

const FAKE_SCRAPED_RESULT: SocialDownloadResult = {
  mediaId: 'fake-scraped-media-000000',
  mimeType: 'video/mp4',
  sizeBytes: 8765,
  title: 'Vídeo raspado',
  durationSeconds: 20,
  thumbnailUrl: 'https://example.com/thumb2.jpg',
};

const ROUTES: Array<{ path: string; kind: 'ytdlp' | 'scraped'; url: string }> = [
  { path: '/v1/downloads/facebook', kind: 'ytdlp', url: 'https://www.facebook.com/watch/?v=123' },
  { path: '/v1/downloads/pinterest', kind: 'ytdlp', url: 'https://www.pinterest.com/pin/123/' },
  { path: '/v1/downloads/tiktok', kind: 'scraped', url: 'https://www.tiktok.com/@user/video/123' },
  { path: '/v1/downloads/kwai', kind: 'scraped', url: 'https://www.kwai.com/@user/video/123' },
];

for (const route of ROUTES) {
  test(`POST ${route.path} sem Authorization retorna 401`, async () => {
    const { app, close } = await createTestApp({ dnsLookup: PUBLIC_DNS });
    try {
      const response = await app.inject({ method: 'POST', url: route.path, payload: { url: route.url } });
      assert.equal(response.statusCode, 401);
    } finally {
      await close();
    }
  });

  test(`POST ${route.path} sem "url" no corpo retorna 400`, async () => {
    const { app, close } = await createTestApp({ dnsLookup: PUBLIC_DNS });
    try {
      const response = await app.inject({
        method: 'POST',
        url: route.path,
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: {},
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_BAD_REQUEST');
    } finally {
      await close();
    }
  });

  test(`POST ${route.path} rejeita host fora da allowlist do provedor antes de baixar`, async () => {
    let downloaderCalled = false;
    const { app, close } = await createTestApp({
      dnsLookup: PUBLIC_DNS,
      downloadYtDlpVideo: async () => { downloaderCalled = true; return FAKE_YTDLP_RESULT; },
      downloadScrapedSocialMedia: async () => { downloaderCalled = true; return FAKE_SCRAPED_RESULT; },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: route.path,
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { url: 'https://outrosite-qualquer.com/video/1' },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'BUNNYFY_URL_BLOCKED');
      assert.equal(downloaderCalled, false);
    } finally {
      await close();
    }
  });

  test(`POST ${route.path} baixa com sucesso (downloader falso) e devolve envelope com mediaUrl assinada`, async () => {
    const expected = route.kind === 'ytdlp' ? FAKE_YTDLP_RESULT : FAKE_SCRAPED_RESULT;
    let receivedUrl: string | undefined;
    const { app, close } = await createTestApp({
      dnsLookup: PUBLIC_DNS,
      downloadYtDlpVideo: async (url) => { receivedUrl = url; return FAKE_YTDLP_RESULT; },
      downloadScrapedSocialMedia: async (_provider, url) => { receivedUrl = url; return FAKE_SCRAPED_RESULT; },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: route.path,
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { url: route.url },
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.title, expected.title);
      assert.equal(body.data.durationSeconds, expected.durationSeconds);
      assert.equal(body.data.media.mime, expected.mimeType);
      assert.match(body.data.media.mediaUrl, /^\/v1\/media\//);
      assert.equal(receivedUrl, route.url);
    } finally {
      await close();
    }
  });
}

test('limite de concorrência é compartilhado entre os downloaders sociais', async () => {
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const { app, close } = await createTestApp({
    dnsLookup: PUBLIC_DNS,
    envOverrides: { SOCIAL_DOWNLOAD_MAX_CONCURRENCY: '1' },
    downloadYtDlpVideo: async () => {
      await gate;
      return FAKE_YTDLP_RESULT;
    },
  });
  try {
    const first = app.inject({
      method: 'POST',
      url: '/v1/downloads/facebook',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: 'https://www.facebook.com/watch/?v=1' },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await app.inject({
      method: 'POST',
      url: '/v1/downloads/pinterest',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      payload: { url: 'https://www.pinterest.com/pin/1/' },
    });
    assert.equal(second.statusCode, 429);
    releaseFirst?.();
    const firstResponse = await first;
    assert.equal(firstResponse.statusCode, 200);
  } finally {
    await close();
  }
});
