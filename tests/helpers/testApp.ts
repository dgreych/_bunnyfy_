import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { buildApp, type BuildAppOptions } from '../../src/app.ts';
import { buildConfig, type AppConfig } from '../../src/config.ts';
import type { TempStorage } from '../../src/storage/tempStorage.ts';

export const TEST_TOKEN = 'test-token-0123456789abcdef';
export const TEST_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef0123';

export interface TestAppHandle {
  app: FastifyInstance;
  tempStorage: TempStorage;
  config: AppConfig;
  mediaDir: string;
  close: () => Promise<void>;
}

export async function createTestApp(options?: {
  envOverrides?: Record<string, string>;
  youtubeDownload?: BuildAppOptions['youtubeDownload'];
  youtubeEgressFetch?: BuildAppOptions['youtubeEgressFetch'];
  youtubeFallbackFetch?: BuildAppOptions['youtubeFallbackFetch'];
  transcribe?: BuildAppOptions['transcribe'];
  removeBackground?: BuildAppOptions['removeBackground'];
  upscaleImage?: BuildAppOptions['upscaleImage'];
  dnsLookup?: BuildAppOptions['dnsLookup'];
  fetchImpl?: BuildAppOptions['fetchImpl'];
  aiChat?: BuildAppOptions['aiChat'];
  generateImage?: BuildAppOptions['generateImage'];
  imageGenerationFetch?: BuildAppOptions['imageGenerationFetch'];
  movieQuiz?: BuildAppOptions['movieQuiz'];
  renderLogoSticker?: BuildAppOptions['renderLogoSticker'];
  logger?: BuildAppOptions['logger'];
  downloadYtDlpVideo?: BuildAppOptions['downloadYtDlpVideo'];
  downloadScrapedSocialMedia?: BuildAppOptions['downloadScrapedSocialMedia'];
}): Promise<TestAppHandle> {
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-test-'));

  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    BUNNYFY_API_TOKENS: TEST_TOKEN,
    MEDIA_SIGNING_SECRET: TEST_SIGNING_SECRET,
    MEDIA_DIR: mediaDir,
    PUBLIC_BASE_URL: 'http://localhost:8080',
    LOG_LEVEL: 'silent',
    MEDIA_TTL_SECONDS: '600',
    MEDIA_MAX_BYTES: String(5 * 1024 * 1024),
    MEDIA_SWEEP_INTERVAL_MS: '3600000',
    ...options?.envOverrides,
  };

  const config = buildConfig(env);
  const { app, tempStorage } = await buildApp({
    config,
    logger: options?.logger,
    youtubeDownload: options?.youtubeDownload,
    youtubeEgressFetch: options?.youtubeEgressFetch,
    youtubeFallbackFetch: options?.youtubeFallbackFetch,
    transcribe: options?.transcribe,
    removeBackground: options?.removeBackground,
    upscaleImage: options?.upscaleImage,
    dnsLookup: options?.dnsLookup,
    fetchImpl: options?.fetchImpl,
    aiChat: options?.aiChat,
    generateImage: options?.generateImage,
    imageGenerationFetch: options?.imageGenerationFetch,
    movieQuiz: options?.movieQuiz,
    renderLogoSticker: options?.renderLogoSticker,
    downloadYtDlpVideo: options?.downloadYtDlpVideo,
    downloadScrapedSocialMedia: options?.downloadScrapedSocialMedia,
  });

  return {
    app,
    tempStorage,
    config,
    mediaDir,
    close: async () => {
      await app.close();
      await rm(mediaDir, { recursive: true, force: true });
    },
  };
}
