import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  downloadYoutubeMedia,
  isBunVersionSupported,
  isNodeVersionSupported,
  MAXIMUM_BUN_VERSION,
  MINIMUM_BUN_VERSION,
  MINIMUM_YTDLP_VERSION,
  type YoutubeDownloadDeps,
} from '../src/lib/youtube.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

test('runtime EJS respeita pisos do Node e faixa suportada do Bun', () => {
  assert.equal(isNodeVersionSupported('v21.99.0'), false);
  assert.equal(isNodeVersionSupported('v22.0.0'), true);
  assert.equal(isBunVersionSupported('1.2.10'), false);
  assert.equal(isBunVersionSupported(MINIMUM_BUN_VERSION), true);
  assert.equal(isBunVersionSupported(MAXIMUM_BUN_VERSION), true);
  assert.equal(isBunVersionSupported('1.3.15'), false);
});

test('download seleciona Bun explicitamente sem mascará-lo como Deno', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-runtime-test-'));
  const tempStorage = new TempStorage({
    dir,
    ttlMs: 60_000,
    maxBytes: 1024,
    sweepIntervalMs: 3_600_000,
  });
  await tempStorage.init();

  const deps: YoutubeDownloadDeps = {
    tempStorage,
    mediaDir: dir,
    ytDlpPath: 'yt-dlp-falso',
    ffmpegPath: 'ffmpeg-falso',
    denoPath: 'deno',
    jsRuntime: 'bun',
    jsRuntimePath: '/opt/bun',
    timeoutMs: 10_000,
    maxBytes: 1024,
    toolAvailable: async () => true,
    toolVersion: async (bin) => {
      if (bin === 'yt-dlp-falso') return MINIMUM_YTDLP_VERSION;
      if (bin === '/opt/bun') return '1.3.14';
      return null;
    },
    runProcess: async (_bin, args) => {
      const noRuntimeIndex = args.indexOf('--no-js-runtimes');
      const runtimeIndex = args.indexOf('--js-runtimes');
      assert.ok(noRuntimeIndex >= 0);
      assert.ok(runtimeIndex >= 0);
      assert.equal(args[runtimeIndex + 1], 'bun:/opt/bun');

      const outputIndex = args.indexOf('-o');
      assert.ok(outputIndex >= 0);
      const output = args[outputIndex + 1]!;
      await writeFile(output.replace('%(ext)s', 'mp3'), Buffer.alloc(64));

      return {
        stdout: JSON.stringify({
          ext: 'mp3',
          title: 'Teste Bun',
          duration: 10,
          is_live: false,
        }),
        stderr: '',
      };
    },
  };

  try {
    const result = await downloadYoutubeMedia(
      'audio',
      { type: 'query', value: 'teste de runtime bun' },
      'best',
      deps,
    );
    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.durationSeconds, 10);
  } finally {
    await tempStorage.close();
    await rm(dir, { recursive: true, force: true });
  }
});
