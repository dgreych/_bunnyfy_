import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import { SubprocessExitError, SubprocessTimeoutError } from '../src/lib/subprocess.ts';
import {
  downloadYtDlpVideo,
  YTDLP_PROVIDER_ALLOWED_HOSTS,
  YTDLP_VIDEO_MAX_DURATION_SECONDS,
  type YtDlpVideoDownloadDeps,
} from '../src/lib/ytdlpVideoDownload.ts';
import { MINIMUM_DENO_VERSION, MINIMUM_YTDLP_VERSION } from '../src/lib/youtube.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

async function withDeps(
  run: (deps: YtDlpVideoDownloadDeps, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-social-ytdlp-test-'));
  const tempStorage = new TempStorage({
    dir,
    ttlMs: 60_000,
    maxBytes: 10 * 1024 * 1024,
    sweepIntervalMs: 3_600_000,
  });
  await tempStorage.init();

  const deps: YtDlpVideoDownloadDeps = {
    tempStorage,
    mediaDir: dir,
    ytDlpPath: 'yt-dlp-falso',
    ffmpegPath: 'ffmpeg-falso',
    denoPath: 'deno-falso',
    timeoutMs: 10_000,
    maxBytes: 10 * 1024 * 1024,
    toolAvailable: async () => true,
    toolVersion: async (bin) => (bin === 'deno-falso' ? MINIMUM_DENO_VERSION : MINIMUM_YTDLP_VERSION),
  };

  try {
    await run(deps, dir);
  } finally {
    await tempStorage.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function outputTemplateFromArgs(args: string[]): string {
  const index = args.indexOf('-o');
  assert.ok(index >= 0);
  const value = args[index + 1];
  assert.ok(value);
  return value;
}

test('allowlist de host cobre facebook e pinterest, incluindo domínios curtos', () => {
  assert.deepEqual(YTDLP_PROVIDER_ALLOWED_HOSTS.facebook, ['facebook.com', 'fb.watch']);
  assert.deepEqual(YTDLP_PROVIDER_ALLOWED_HOSTS.pinterest, ['pinterest.com', 'pin.it']);
});

test('download baixa vídeo, usa argumentos sem shell e sem seleção de qualidade/busca', async () => {
  await withDeps(async (deps, dir) => {
    deps.runProcess = async (bin, args, options) => {
      assert.equal(bin, 'yt-dlp-falso');
      assert.equal(options.timeoutMs, 10_000);
      assert.deepEqual(args.slice(-2), ['--', 'https://www.facebook.com/watch/?v=123']);
      assert.ok(args.includes('--no-playlist'));
      assert.ok(args.includes('--ignore-config'));
      const formatIndex = args.indexOf('-f');
      assert.ok(formatIndex >= 0);
      assert.equal(args[formatIndex + 1], 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b');
      const matchFilterIndex = args.indexOf('--match-filters');
      assert.equal(args[matchFilterIndex + 1], `!is_live & duration <= ${YTDLP_VIDEO_MAX_DURATION_SECONDS}`);

      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp4'), Buffer.alloc(128));
      return {
        stdout: JSON.stringify({ ext: 'mp4', title: 'Vídeo de teste', duration: 12, thumbnail: 'https://example.com/x.jpg' }),
        stderr: '',
      };
    };

    const result = await downloadYtDlpVideo('https://www.facebook.com/watch/?v=123', deps);
    assert.equal(result.sizeBytes, 128);
    assert.equal(result.title, 'Vídeo de teste');
    assert.equal(result.durationSeconds, 12);
    const files = await readdir(dir);
    assert.equal(files.length, 1);
  });
});

test('campo ausente do yt-dlp (thumbnail como NA literal) não quebra o parser', async () => {
  await withDeps(async (deps) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp4'), Buffer.alloc(64));
      // Facebook/Pinterest nem sempre têm thumbnail/is_live/live_status; o
      // yt-dlp imprime o literal `NA` sem aspas mesmo com o modificador `j`.
      return {
        stdout: '{"ext":"mp4","title":"Sem thumbnail","duration":9,"thumbnail":NA,"is_live":NA,"live_status":NA}',
        stderr: '',
      };
    };

    const result = await downloadYtDlpVideo('https://www.facebook.com/watch/?v=123', deps);
    assert.equal(result.title, 'Sem thumbnail');
    assert.equal(result.durationSeconds, 9);
    assert.equal(result.thumbnailUrl, null);
  });
});

test('transmissão ao vivo é recusada e duração acima do limite também', async () => {
  await withDeps(async (deps) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp4'), Buffer.alloc(8));
      return { stdout: JSON.stringify({ ext: 'mp4', is_live: true, duration: 10 }), stderr: '' };
    };
    await assert.rejects(
      () => downloadYtDlpVideo('https://www.pinterest.com/pin/123/', deps),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  });

  await withDeps(async (deps) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp4'), Buffer.alloc(8));
      return { stdout: JSON.stringify({ ext: 'mp4', duration: YTDLP_VIDEO_MAX_DURATION_SECONDS + 1 }), stderr: '' };
    };
    await assert.rejects(
      () => downloadYtDlpVideo('https://www.pinterest.com/pin/123/', deps),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  });
});

test('ferramenta ausente e timeout viram erros canônicos, sem derrubar o processo', async () => {
  await withDeps(async (deps) => {
    deps.toolAvailable = async () => false;
    await assert.rejects(
      () => downloadYtDlpVideo('https://www.facebook.com/watch/?v=1', deps),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TOOL_UNAVAILABLE',
    );
  });

  await withDeps(async (deps) => {
    deps.runProcess = async () => {
      throw new SubprocessTimeoutError('yt-dlp-falso', 10_000);
    };
    await assert.rejects(
      () => downloadYtDlpVideo('https://www.facebook.com/watch/?v=1', deps),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT',
    );
  });

  await withDeps(async (deps) => {
    deps.runProcess = async () => {
      throw new SubprocessExitError('yt-dlp-falso', 1, null, '', 'other');
    };
    await assert.rejects(
      () => downloadYtDlpVideo('https://www.facebook.com/watch/?v=1', deps),
      (error: unknown) => error instanceof AppError && error.code === 'BUNNYFY_UNAVAILABLE',
    );
  });
});

test('artefato parcial é removido quando o subprocesso falha', async () => {
  await withDeps(async (deps, dir) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'part'), Buffer.alloc(4));
      throw new SubprocessExitError('yt-dlp-falso', 1, null, '', 'other');
    };
    await assert.rejects(() => downloadYtDlpVideo('https://www.facebook.com/watch/?v=1', deps));
    const files = await readdir(dir);
    assert.equal(files.length, 0);
  });
});
