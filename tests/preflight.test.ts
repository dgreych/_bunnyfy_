import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('preflight falha sem expor segredo quando IA está ativa mas incompleta', async () => {
  const isolatedPath = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-preflight-path-'));
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-preflight-media-'));
  const apiToken = 'preflight-token-0123456789abcdef';
  const signingSecret = 'preflight-signing-secret-0123456789abcdef';

  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/preflight.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        PATH: isolatedPath,
        BUNNYFY_API_TOKENS: apiToken,
        MEDIA_SIGNING_SECRET: signingSecret,
        MEDIA_DIR: mediaDir,
        AI_CHAT_ENABLED: 'true',
        NVIDIA_API_KEY: '   ',
        NVIDIA_MODEL: '',
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    const body = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(body.ok, false);

    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(apiToken), false);
    assert.equal(serialized.includes(signingSecret), false);
    assert.equal(serialized.includes('NVIDIA_API_KEY'), false);
    assert.equal(serialized.includes('NVIDIA_MODEL'), false);
    assert.equal(serialized.includes('aiChatCredentialPresent'), true);
    assert.equal(serialized.includes('aiChatModelPresent'), true);
  } finally {
    await rm(isolatedPath, { recursive: true, force: true });
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test('preflight usa a mesma validação de limites do boot', async () => {
  const isolatedPath = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-preflight-path-'));
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-preflight-media-'));

  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/preflight.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        PATH: isolatedPath,
        BUNNYFY_API_TOKENS: 'preflight-token-0123456789abcdef',
        MEDIA_SIGNING_SECRET: 'preflight-signing-secret-0123456789abcdef',
        MEDIA_DIR: mediaDir,
        AI_CHAT_ENABLED: 'true',
        NVIDIA_API_KEY: 'provider-test-key-0123456789abcdef',
        NVIDIA_MODEL: 'example/model',
        AI_CHAT_TIMEOUT_MS: '0',
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal((JSON.parse(result.stdout) as { checks: { config: { valid: boolean } } }).checks.config.valid, false);
  } finally {
    await rm(isolatedPath, { recursive: true, force: true });
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test('preflight não anuncia YouTube pronto com yt-dlp abaixo da versão mínima', async () => {
  const isolatedPath = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-preflight-path-'));
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-preflight-media-'));
  const fakeYtDlp = path.join(isolatedPath, 'yt-dlp');
  const fakeFfmpeg = path.join(isolatedPath, 'ffmpeg');
  const fakeDeno = path.join(isolatedPath, 'deno');

  try {
    await Promise.all([
      writeFile(fakeYtDlp, '#!/bin/sh\nprintf "2024.04.09\\n"\n', { mode: 0o700 }),
      writeFile(fakeFfmpeg, '#!/bin/sh\nprintf "ffmpeg test\\n"\n', { mode: 0o700 }),
      writeFile(fakeDeno, '#!/bin/sh\nprintf "deno 2.3.0\\n"\n', { mode: 0o700 }),
    ]);
    await Promise.all([chmod(fakeYtDlp, 0o700), chmod(fakeFfmpeg, 0o700), chmod(fakeDeno, 0o700)]);

    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/preflight.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        PATH: isolatedPath,
        BUNNYFY_API_TOKENS: 'preflight-token-0123456789abcdef',
        MEDIA_SIGNING_SECRET: 'preflight-signing-secret-0123456789abcdef',
        MEDIA_DIR: mediaDir,
        YTDLP_PATH: fakeYtDlp,
        FFMPEG_PATH: fakeFfmpeg,
        DENO_PATH: fakeDeno,
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    const body = JSON.parse(result.stdout) as {
      checks: { tools: { ytDlp: { available: boolean; compatible: boolean; minimumVersion: string; version: string } } };
      notes: { youtubeReady: boolean };
    };
    assert.deepEqual(body.checks.tools.ytDlp, {
      available: true,
      compatible: false,
      minimumVersion: '2026.07.04',
      version: '2024.04.09',
    });
    assert.equal(body.notes.youtubeReady, false);
  } finally {
    await rm(isolatedPath, { recursive: true, force: true });
    await rm(mediaDir, { recursive: true, force: true });
  }
});
