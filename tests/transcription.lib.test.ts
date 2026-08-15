import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import {
  ensureTranscriptionToolsAvailable,
  normalizeAudioToWav,
  parseFfmpegDurationSeconds,
  runWhisperCli,
  transcribeAudio,
} from '../src/lib/transcription.ts';
import { resetToolAvailabilityCache } from '../src/lib/subprocess.ts';

/**
 * Cria um "whisper-cli" falso executável que ignora os args reais e sempre
 * termina do jeito pedido, imprimindo `stderrText` antes. Usado pra provar,
 * sem depender do binário Alpine real, que uma falha de subprocesso (exit
 * code ou sinal nativo) chega em `AppError.internalDetails` com
 * exitCode/signal/stderr sanitizados — e nunca no payload que vai pro
 * cliente. Ver docs/CHECKPOINT_BUN019A1_V7_SMOKE500_ROLLBACK_OK_2026-08-13.md:
 * o BUG real era whisper-cli abortando por SIGABRT (GGML_ASSERT(device)
 * failed, backend ggml não carregado) e o processo original perdia esse
 * sinal/stderr, virando BUNNYFY_INTERNAL_ERROR opaco.
 */
async function writeFakeWhisperCli(
  dir: string,
  body: 'exit-nonzero' | 'abort-signal',
  stderrText: string,
): Promise<string> {
  const scriptPath = path.join(dir, 'fake-whisper-cli.sh');
  const tail = body === 'exit-nonzero' ? 'exit 1' : 'kill -ABRT $$';
  await writeFile(scriptPath, `#!/bin/sh\nprintf '%s' ${JSON.stringify(stderrText)} 1>&2\n${tail}\n`, {
    mode: 0o755,
  });
  return scriptPath;
}

const execFileAsync = promisify(execFile);

// Estes testes rodam ffmpeg de verdade (leve, sem rede) pra provar que o
// pipeline recusa áudio indecodificável sem confiar só no MIME e que
// consegue normalizar/medir duração de um áudio real de verdade. O
// whisper-cli não está instalado neste ambiente — isso é usado
// deliberadamente pra provar o caminho de "ferramenta ausente" com o
// binário real ausente, não com um mock.

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-transcription-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('parseFfmpegDurationSeconds lê "Duration: HH:MM:SS.cc" da saída do ffmpeg', () => {
  const stderr = 'Input #0, wav, from \'x.wav\':\n  Duration: 00:01:02.50, bitrate: 256 kb/s\n';
  assert.equal(parseFfmpegDurationSeconds(stderr), 62.5);
});

test('parseFfmpegDurationSeconds retorna 0 se não encontrar', () => {
  assert.equal(parseFfmpegDurationSeconds('saída sem duração'), 0);
});

test('normalizeAudioToWav recusa áudio indecodificável sem confiar no MIME (ffmpeg real)', async () => {
  await withTempDir(async (dir) => {
    const garbagePath = path.join(dir, 'nao-e-audio.mp3');
    await writeFile(garbagePath, Buffer.from('isso aqui não é um arquivo de áudio de verdade, só texto solto'));

    // Timeout generoso de propósito: este teste prova rejeição por falha de
    // decodificação, não timeout (esse é outro teste, com 1ms). Sob carga do
    // sistema, o ffmpeg pode demorar alguns segundos só pra desistir de
    // sondar um arquivo lixo — 5s já foi visto estourando em CI ocupado.
    await assert.rejects(
      normalizeAudioToWav(garbagePath, path.join(dir, 'out.wav'), 'ffmpeg', 30_000),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'BUNNYFY_BAD_REQUEST');
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
  });
});

test('normalizeAudioToWav normaliza um áudio real e mede a duração (ffmpeg real)', async () => {
  await withTempDir(async (dir) => {
    const inputPath = path.join(dir, 'input.wav');
    const outputPath = path.join(dir, 'output.wav');

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=22050:cl=mono',
      '-t', '1',
      '-c:a', 'pcm_s16le',
      inputPath,
    ]);

    const { durationSeconds } = await normalizeAudioToWav(inputPath, outputPath, 'ffmpeg', 10_000);

    assert.ok(durationSeconds >= 0.9 && durationSeconds <= 1.2, `duração inesperada: ${durationSeconds}`);
  });
});

test('normalizeAudioToWav vira BUNNYFY_TIMEOUT quando o processo excede o limite (ffmpeg real)', async () => {
  await withTempDir(async (dir) => {
    const inputPath = path.join(dir, 'input.wav');
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '1', '-c:a', 'pcm_s16le', inputPath,
    ]);

    await assert.rejects(
      normalizeAudioToWav(inputPath, path.join(dir, 'out.wav'), 'ffmpeg', 1),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'BUNNYFY_TIMEOUT');
        assert.equal(error.statusCode, 504);
        return true;
      },
    );
  });
});

test('ensureTranscriptionToolsAvailable reporta whisper-cli e modelo ausentes (binário real ausente)', async () => {
  resetToolAvailabilityCache();
  await assert.rejects(
    ensureTranscriptionToolsAvailable({
      whisperCliPath: 'whisper-cli',
      whisperModelPath: '/caminho/que/nao/existe/modelo.bin',
      ffmpegPath: 'ffmpeg',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'BUNNYFY_TOOL_UNAVAILABLE');
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /whisper-cli/);
      assert.match(error.message, /modelo whisper/);
      return true;
    },
  );
});

test('transcribeAudio de ponta a ponta vira BUNNYFY_TOOL_UNAVAILABLE sem whisper-cli instalado, sem derrubar o processo', async () => {
  await withTempDir(async (dir) => {
    resetToolAvailabilityCache();
    const inputPath = path.join(dir, 'input.wav');
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '1', '-c:a', 'pcm_s16le', inputPath,
    ]);

    await assert.rejects(
      transcribeAudio(inputPath, {}, {
        whisperCliPath: 'whisper-cli',
        whisperModelPath: '/caminho/que/nao/existe/modelo.bin',
        ffmpegPath: 'ffmpeg',
        timeoutMs: 5000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'BUNNYFY_TOOL_UNAVAILABLE');
        return true;
      },
    );
  });
});

test('runWhisperCli vira BUNNYFY_INTERNAL_ERROR com exitCode/stderr sanitizado em internalDetails quando o processo sai com erro, sem vazar no payload', async () => {
  await withTempDir(async (dir) => {
    const marker = 'GGML_ASSERT(device) failed';
    const cliPath = await writeFakeWhisperCli(dir, 'exit-nonzero', marker);

    await assert.rejects(
      runWhisperCli(path.join(dir, 'input.wav'), 'auto', {
        whisperCliPath: cliPath,
        whisperModelPath: path.join(dir, 'modelo-fake.bin'),
        timeoutMs: 5000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'BUNNYFY_INTERNAL_ERROR');
        assert.equal(error.statusCode, 500);

        // A causa real precisa estar disponível pro log server-side...
        const details = error.internalDetails as { exitCode: unknown; signal: unknown; stderr: unknown };
        assert.equal(details.exitCode, 1);
        assert.equal(details.signal, null);
        assert.match(String(details.stderr), new RegExp(marker.replace(/[()]/g, '\\$&')));

        // ...mas nunca no envelope que volta pro cliente HTTP.
        const payload = error.toPayload();
        assert.equal(JSON.stringify(payload).includes(marker), false);
        assert.equal(payload.code, 'BUNNYFY_INTERNAL_ERROR');
        return true;
      },
    );
  });
});

test('runWhisperCli captura o sinal quando whisper-cli aborta nativamente (ex.: crash de backend ggml), sem confundir com timeout', async () => {
  await withTempDir(async (dir) => {
    const marker = 'GGML_ASSERT(device) failed';
    const cliPath = await writeFakeWhisperCli(dir, 'abort-signal', marker);

    await assert.rejects(
      runWhisperCli(path.join(dir, 'input.wav'), 'auto', {
        whisperCliPath: cliPath,
        whisperModelPath: path.join(dir, 'modelo-fake.bin'),
        timeoutMs: 5000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        // Continua BUNNYFY_INTERNAL_ERROR, não BUNNYFY_TIMEOUT: o processo se
        // matou sozinho (abort nativo), o Node não precisou matá-lo por estouro
        // de `timeoutMs`. Antes da correção, esse caminho perdia `signal` de
        // vez (só tratava timeout quando `error.killed && error.signal`).
        assert.equal(error.code, 'BUNNYFY_INTERNAL_ERROR');

        const details = error.internalDetails as { exitCode: unknown; signal: unknown; stderr: unknown };
        assert.equal(details.signal, 'SIGABRT');
        assert.match(String(details.stderr), new RegExp(marker.replace(/[()]/g, '\\$&')));

        const payload = error.toPayload();
        assert.equal(JSON.stringify(payload).includes(marker), false);
        assert.equal(JSON.stringify(payload).includes('SIGABRT'), false);
        return true;
      },
    );
  });
});

/**
 * Cria um "whisper-cli" falso que grava os argumentos recebidos num arquivo,
 * pra inspecionar exatamente o que foi passado pro processo real.
 */
async function writeArgsCapturingWhisperCli(dir: string, argsFile: string): Promise<string> {
  const scriptPath = path.join(dir, 'capture-whisper-cli.sh');
  await writeFile(
    scriptPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\nprintf 'texto de teste'\n`,
    { mode: 0o755 },
  );
  return scriptPath;
}

test('runWhisperCli usa -t 1 por padrão quando threads não é configurado (contenção de CPU sob cgroup quota)', async () => {
  await withTempDir(async (dir) => {
    const argsFile = path.join(dir, 'args.txt');
    const cliPath = await writeArgsCapturingWhisperCli(dir, argsFile);

    await runWhisperCli(path.join(dir, 'input.wav'), 'auto', {
      whisperCliPath: cliPath,
      whisperModelPath: path.join(dir, 'modelo-fake.bin'),
      timeoutMs: 5000,
    });

    const rawArgs = await readFile(argsFile, 'utf8');
    const args = rawArgs.trim().split('\n');
    const threadIndex = args.indexOf('-t');
    assert.ok(threadIndex >= 0, `esperava flag -t nos args: ${JSON.stringify(args)}`);
    assert.equal(args[threadIndex + 1], '1');
  });
});

test('runWhisperCli respeita deps.threads quando configurado explicitamente', async () => {
  await withTempDir(async (dir) => {
    const argsFile = path.join(dir, 'args.txt');
    const cliPath = await writeArgsCapturingWhisperCli(dir, argsFile);

    await runWhisperCli(path.join(dir, 'input.wav'), 'auto', {
      whisperCliPath: cliPath,
      whisperModelPath: path.join(dir, 'modelo-fake.bin'),
      timeoutMs: 5000,
      threads: 3,
    });

    const rawArgs = await readFile(argsFile, 'utf8');
    const args = rawArgs.trim().split('\n');
    const threadIndex = args.indexOf('-t');
    assert.ok(threadIndex >= 0);
    assert.equal(args[threadIndex + 1], '3');
  });
});
