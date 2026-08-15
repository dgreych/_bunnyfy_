import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import {
  SubprocessExitError,
  SubprocessTimeoutError,
} from '../src/lib/subprocess.ts';
import {
  downloadYoutubeMedia,
  isYtDlpVersionSupported,
  isDenoVersionSupported,
  MINIMUM_DENO_VERSION,
  MINIMUM_YTDLP_VERSION,
  YOUTUBE_MAX_DURATION_SECONDS,
  type YoutubeDownloadDeps,
  type YoutubeDownloadInput,
} from '../src/lib/youtube.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

async function withDeps(
  maxBytes: number,
  run: (deps: YoutubeDownloadDeps, dir: string) => Promise<void>,
  storageMaxBytes = maxBytes,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-youtube-test-'));
  const tempStorage = new TempStorage({
    dir,
    ttlMs: 60_000,
    maxBytes: storageMaxBytes,
    sweepIntervalMs: 3_600_000,
  });
  await tempStorage.init();

  const deps: YoutubeDownloadDeps = {
    tempStorage,
    mediaDir: dir,
    ytDlpPath: 'yt-dlp-falso',
    ffmpegPath: 'ffmpeg-falso',
    denoPath: 'deno-falso',
    timeoutMs: 10_000,
    maxBytes,
    toolAvailable: async () => true,
    toolVersion: async (bin) => bin === 'deno-falso' ? MINIMUM_DENO_VERSION : MINIMUM_YTDLP_VERSION,
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

test('compatibilidade do yt-dlp exige a versão mínima testada', () => {
  assert.equal(isYtDlpVersionSupported(null), false);
  assert.equal(isYtDlpVersionSupported('2024.04.09'), false);
  assert.equal(isYtDlpVersionSupported('2026.07.03'), false);
  assert.equal(isYtDlpVersionSupported(MINIMUM_YTDLP_VERSION), true);
  assert.equal(isYtDlpVersionSupported('2026.07.04.1'), true);
  assert.equal(isYtDlpVersionSupported('2027.01.01'), true);
});

test('compatibilidade do Deno exige a versão mínima suportada pelo yt-dlp', () => {
  assert.equal(isDenoVersionSupported(null), false);
  assert.equal(isDenoVersionSupported('deno 2.2.9'), false);
  assert.equal(isDenoVersionSupported(`deno ${MINIMUM_DENO_VERSION}`), true);
  assert.equal(isDenoVersionSupported('deno 2.4.0'), true);
});

test('download por URL preserva a entrada direta, usa argumentos sem shell e remove sidecars', async () => {
  await withDeps(1024, async (deps, dir) => {
    deps.runProcess = async (bin, args, options) => {
      assert.equal(bin, 'yt-dlp-falso');
      assert.equal(options.timeoutMs, 10_000);
      assert.deepEqual(args.slice(-2), ['--', 'https://youtube.com/watch?v=abc']);
      assert.ok(args.includes('--ignore-config'));
      assert.ok(args.includes('--no-plugin-dirs'));
      assert.ok(args.includes('--quiet'));
      assert.equal(args.includes('--print-json'), false);
      const printIndex = args.indexOf('--print');
      assert.ok(printIndex >= 0);
      assert.match(args[printIndex + 1]!, /^after_move:\{/);
      const ffmpegLocationIndex = args.indexOf('--ffmpeg-location');
      assert.ok(ffmpegLocationIndex >= 0);
      assert.equal(args[ffmpegLocationIndex + 1], 'ffmpeg-falso');
      const jsRuntimeIndex = args.indexOf('--js-runtimes');
      assert.ok(jsRuntimeIndex >= 0);
      assert.equal(args[jsRuntimeIndex + 1], 'deno:deno-falso');
      const formatIndex = args.indexOf('-f');
      assert.ok(formatIndex >= 0);
      assert.match(args[formatIndex + 1]!, /bv\*\[height<=360\].*\/bv\*\[height<=360\]\+ba/);
      const matchFilterIndex = args.indexOf('--match-filters');
      assert.ok(matchFilterIndex >= 0);
      assert.equal(
        args[matchFilterIndex + 1],
        `!is_live & duration <= ${YOUTUBE_MAX_DURATION_SECONDS}`,
      );
      const template = outputTemplateFromArgs(args);
      const finalPath = template.replace('%(ext)s', 'mp4');
      const sidecarPath = template.replace('%(ext)s', 'mp4.part');
      await writeFile(finalPath, Buffer.alloc(64));
      await writeFile(sidecarPath, Buffer.alloc(8));
      return {
        stdout: JSON.stringify({ ext: 'mp4', title: 'Teste', duration: 3, thumbnail: 'https://example.com/x.jpg' }),
        stderr: '',
      };
    };

    const result = await downloadYoutubeMedia(
      'video',
      { type: 'url', value: 'https://youtube.com/watch?v=abc' },
      '360p',
      deps,
    );
    assert.equal(result.sizeBytes, 64);
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^[A-Za-z0-9_-]{24}\.mp4$/);
  });
});

test('valor padrão de ffmpeg é resolvido pelo PATH sem virar localização relativa', async () => {
  await withDeps(1024, async (deps) => {
    deps.ffmpegPath = 'ffmpeg';
    deps.denoPath = 'deno';
    deps.runProcess = async (_bin, args) => {
      assert.equal(args.includes('--ffmpeg-location'), false);
      assert.equal(args.includes('--js-runtimes'), false);
      const formatIndex = args.indexOf('-f');
      assert.ok(formatIndex >= 0);
      assert.equal(args[formatIndex + 1], 'ba[acodec^=mp3]/ba/b');
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp3'), Buffer.alloc(64));
      return {
        stdout: JSON.stringify({ ext: 'mp3', title: 'Áudio curto', duration: 10 }),
        stderr: '',
      };
    };

    const result = await downloadYoutubeMedia(
      'audio',
      { type: 'query', value: 'áudio de teste' },
      'best',
      deps,
    );
    assert.equal(result.mimeType, 'audio/mpeg');
  });
});

test('versão antiga do yt-dlp é recusada antes do download', async () => {
  await withDeps(1024, async (deps) => {
    let processCalled = false;
    deps.toolVersion = async () => '2024.04.09';
    deps.runProcess = async () => {
      processCalled = true;
      throw new Error('não deveria executar');
    };

    await assert.rejects(
      downloadYoutubeMedia('audio', { type: 'query', value: 'áudio de teste' }, 'best', deps),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 503 &&
        error.code === 'BUNNYFY_TOOL_UNAVAILABLE',
    );
    assert.equal(processCalled, false);
  });
});

test('falha do subprocesso remove arquivo parcial deixado pelo yt-dlp', async () => {
  await withDeps(1024, async (deps, dir) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp4.part'), Buffer.alloc(32));
      throw new Error('falha simulada');
    };

    await assert.rejects(
      downloadYoutubeMedia('video', { type: 'url', value: 'https://youtube.com/watch?v=abc' }, undefined, deps),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 503 &&
        error.code === 'BUNNYFY_UNAVAILABLE' &&
        error.retryable === true &&
        error.internalDetails === undefined &&
        error.cause === undefined,
    );
    assert.deepEqual(await readdir(dir), []);
  });
});

test('arquivo final acima do limite é recusado e removido', async () => {
  await withDeps(32, async (deps, dir) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp4'), Buffer.alloc(33));
      return { stdout: JSON.stringify({ ext: 'mp4', title: 'Grande', duration: 30 }), stderr: '' };
    };

    await assert.rejects(
      downloadYoutubeMedia('video', { type: 'url', value: 'https://youtube.com/watch?v=abc' }, undefined, deps),
      (error: unknown) => error instanceof AppError && error.statusCode === 413,
    );
    assert.deepEqual(await readdir(dir), []);
  });
});

test('download usa seu próprio teto ao registrar mídia sem ampliar o limite comum de upload', async () => {
  await withDeps(64, async (deps) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp3'), Buffer.alloc(24));
      return { stdout: JSON.stringify({ ext: 'mp3', duration: 30 }), stderr: '' };
    };

    const result = await downloadYoutubeMedia(
      'audio',
      { type: 'query', value: 'download com limite próprio' },
      undefined,
      deps,
    );
    assert.equal(result.sizeBytes, 24);
  }, 16);
});

test('busca textual baixa somente o primeiro resultado sem expor URL de origem nos metadados', async () => {
  await withDeps(1024, async (deps) => {
    const privateQuery = 'música para testar busca';
    deps.runProcess = async (_bin, args) => {
      assert.deepEqual(args.slice(-2), ['--', `ytsearch1:${privateQuery}`]);
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp3'), Buffer.alloc(64));
      return {
        stdout: JSON.stringify({
          ext: 'mp3',
          title: 'Resultado encontrado',
          duration: 90,
          thumbnail: 'https://example.com/thumb.jpg',
          webpage_url: 'https://youtube.com/watch?v=nao-expor',
          original_url: `ytsearch1:${privateQuery}`,
        }),
        stderr: '',
      };
    };

    const result = await downloadYoutubeMedia('audio', { type: 'query', value: privateQuery }, undefined, deps);
    assert.equal(result.title, 'Resultado encontrado');
    assert.equal(result.durationSeconds, 90);
    assert.deepEqual(Object.keys(result).sort(), [
      'durationSeconds',
      'mediaId',
      'mimeType',
      'sizeBytes',
      'thumbnailUrl',
      'title',
    ]);
    assert.equal(JSON.stringify(result).includes('nao-expor'), false);
    assert.equal(JSON.stringify(result).includes(privateQuery), false);
  });
});

test('adaptador recusa consulta vazia, longa ou com controle antes de chamar ferramentas', async () => {
  await withDeps(1024, async (deps) => {
    let processCalled = false;
    let toolCalled = false;
    deps.runProcess = async () => {
      processCalled = true;
      throw new Error('não deveria executar');
    };
    deps.toolAvailable = async () => {
      toolCalled = true;
      return true;
    };

    for (const value of ['   ', 'x'.repeat(201), 'linha\nseguinte']) {
      await assert.rejects(
        downloadYoutubeMedia('audio', { type: 'query', value }, undefined, deps),
        (error: unknown) => error instanceof AppError && error.statusCode === 400,
      );
    }
    assert.equal(toolCalled, false);
    assert.equal(processCalled, false);
  });
});

test('timeout do yt-dlp em busca textual vira erro canônico 504 e limpa artefatos', async () => {
  await withDeps(1024, async (deps, dir) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp3.part'), Buffer.alloc(16));
      throw new SubprocessTimeoutError('yt-dlp-falso', deps.timeoutMs);
    };

    await assert.rejects(
      downloadYoutubeMedia('audio', { type: 'query', value: 'consulta com timeout' }, undefined, deps),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 504 && error.code === 'BUNNYFY_TIMEOUT',
    );
    assert.deepEqual(await readdir(dir), []);
  });
});

test('adaptador recusa live, estreia, duração ausente e duração acima de 1800 em URL e busca', async () => {
  const cases: Array<{ input: YoutubeDownloadInput; info: Record<string, unknown> }> = [
    {
      input: { type: 'url', value: 'https://youtube.com/watch?v=live' },
      info: { ext: 'mp4', duration: 30, is_live: true },
    },
    {
      input: { type: 'query', value: 'estreia futura' },
      info: { ext: 'mp4', duration: 30, live_status: 'is_upcoming' },
    },
    {
      input: { type: 'url', value: 'https://youtube.com/watch?v=sem-duracao' },
      info: { ext: 'mp4', is_live: false },
    },
    {
      input: { type: 'query', value: 'mídia longa' },
      info: { ext: 'mp4', duration: YOUTUBE_MAX_DURATION_SECONDS + 0.1, is_live: false },
    },
  ];

  for (const testCase of cases) {
    await withDeps(1024, async (deps, dir) => {
      deps.runProcess = async (_bin, args) => {
        const template = outputTemplateFromArgs(args);
        await writeFile(template.replace('%(ext)s', 'mp4'), Buffer.alloc(64));
        return { stdout: JSON.stringify(testCase.info), stderr: '' };
      };

      await assert.rejects(
        downloadYoutubeMedia('video', testCase.input, '360p', deps),
        (error: unknown) =>
          error instanceof AppError && error.statusCode === 400 && error.code === 'BUNNYFY_BAD_REQUEST',
      );
      assert.deepEqual(await readdir(dir), []);
    });
  }
});

test('duração exatamente no limite é aceita', async () => {
  await withDeps(1024, async (deps) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp4'), Buffer.alloc(64));
      return {
        stdout: JSON.stringify({ ext: 'mp4', duration: YOUTUBE_MAX_DURATION_SECONDS, is_live: false }),
        stderr: '',
      };
    };

    const result = await downloadYoutubeMedia(
      'video',
      { type: 'url', value: 'https://youtube.com/watch?v=limite' },
      'best',
      deps,
    );
    assert.equal(result.durationSeconds, YOUTUBE_MAX_DURATION_SECONDS);
  });
});

test('stdout inválido não anexa trecho com consulta privada ao erro interno', async () => {
  await withDeps(1024, async (deps, dir) => {
    const privateQuery = 'consulta que jamais pode aparecer no log';
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'mp3'), Buffer.alloc(64));
      return { stdout: `{invalido:${privateQuery}}`, stderr: '' };
    };

    await assert.rejects(
      downloadYoutubeMedia('audio', { type: 'query', value: privateQuery }, undefined, deps),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 500);
        assert.equal(error.internalDetails, undefined);
        assert.equal(error.message.includes(privateQuery), false);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.deepEqual(await readdir(dir), []);
  });
});

test('extensão inesperada do artefato é recusada e removida', async () => {
  await withDeps(1024, async (deps, dir) => {
    deps.runProcess = async (_bin, args) => {
      const template = outputTemplateFromArgs(args);
      await writeFile(template.replace('%(ext)s', 'html'), Buffer.alloc(64));
      return { stdout: JSON.stringify({ ext: 'html', duration: 10 }), stderr: '' };
    };

    await assert.rejects(
      downloadYoutubeMedia('audio', { type: 'query', value: 'resultado inválido' }, 'best', deps),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 503 &&
        error.code === 'BUNNYFY_UNAVAILABLE',
    );
    assert.deepEqual(await readdir(dir), []);
  });
});


test('falha classificada do yt-dlp vira 503 com diagnóstico interno sanitizado', async () => {
  await withDeps(1024, async (deps, dir) => {
    deps.runProcess = async () => {
      throw new SubprocessExitError(
        'yt-dlp-falso',
        1,
        null,
        '',
        'youtube_antibot',
      );
    };

    await assert.rejects(
      downloadYoutubeMedia(
        'audio',
        { type: 'url', value: 'https://youtube.com/watch?v=abcdefghijk' },
        undefined,
        deps,
      ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, 'BUNNYFY_UNAVAILABLE');
        assert.deepEqual(error.internalDetails, {
          source: 'youtube-subprocess',
          failureKind: 'youtube_antibot',
          exitCode: 1,
        });
        return true;
      },
    );

    assert.deepEqual(await readdir(dir), []);
  });
});
