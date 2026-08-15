import fs from 'node:fs/promises';

import { AppError } from '../envelope.ts';
import { generateOpaqueId } from '../storage/tempStorage.ts';
import {
  checkToolAvailable,
  runSubprocess,
  SubprocessExitError,
  SubprocessTimeoutError,
  ToolNotFoundError,
} from './subprocess.ts';

export interface TranscriptionDeps {
  whisperCliPath: string;
  whisperModelPath: string;
  ffmpegPath: string;
  timeoutMs: number;
  /**
   * Threads passadas a `-t` do whisper-cli. Default 1 propositalmente: sob
   * cgroup CPU quota (containers com poucos vCPUs garantidos), o whisper.cpp
   * usa OpenMP com busy-wait nas barreiras de sincronização — mais threads que
   * o hardware realmente entrega em paralelo faz o processo entrar em
   * contenção catastrófica (não linear) em vez de só ficar um pouco mais
   * lento. Medido no host real: -t 1 = 24s, -t 2 = 33s, -t 3/-t 4 (default do
   * binário) nunca terminam (timeout). Ver
   * docs/CHECKPOINT_BUN019A1_V7_SMOKE500_ROLLBACK_OK_2026-08-13.md.
   */
  threads?: number;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  durationSeconds: number;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirma que whisper-cli, o modelo apontado por configuração e o ffmpeg
 * estão disponíveis. Ausência de qualquer um vira `BUNNYFY_TOOL_UNAVAILABLE`
 * — nunca impede o boot da API, só a rota de transcrição nesta requisição.
 */
export async function ensureTranscriptionToolsAvailable(
  deps: Pick<TranscriptionDeps, 'whisperCliPath' | 'whisperModelPath' | 'ffmpegPath'>,
): Promise<void> {
  const [whisperOk, ffmpegOk, modelExists] = await Promise.all([
    checkToolAvailable(deps.whisperCliPath),
    checkToolAvailable(deps.ffmpegPath),
    fileExists(deps.whisperModelPath),
  ]);

  if (!whisperOk || !ffmpegOk || !modelExists) {
    const missing = [!whisperOk && 'whisper-cli', !ffmpegOk && 'ffmpeg', !modelExists && 'modelo whisper']
      .filter(Boolean)
      .join(', ');
    throw AppError.toolUnavailable(`Transcrição indisponível no servidor (${missing}).`);
  }
}

/** Extrai `Duration: HH:MM:SS.cc` da saída padrão de erro do ffmpeg. Retorna 0 se não achar. */
export function parseFfmpegDurationSeconds(ffmpegStderr: string): number {
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(ffmpegStderr);
  if (!match) return 0;
  const [, hh, mm, ss, cs] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(cs) / 100;
}

/**
 * Decodifica e normaliza o áudio de entrada pra WAV mono 16kHz (formato que
 * o whisper.cpp espera), via ffmpeg em subprocesso. Nunca confia no MIME
 * declarado: se o ffmpeg não conseguir decodificar, o arquivo é recusado
 * como entrada inválida, não como erro interno.
 */
export async function normalizeAudioToWav(
  inputPath: string,
  outputWavPath: string,
  ffmpegPath: string,
  timeoutMs: number,
): Promise<{ durationSeconds: number }> {
  let stderr: string;
  try {
    const result = await runSubprocess(
      ffmpegPath,
      ['-y', '-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outputWavPath],
      { timeoutMs },
    );
    stderr = result.stderr;
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable(`Ferramenta de normalização de áudio indisponível no servidor (${error.toolName}).`);
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('Normalização de áudio excedeu o tempo limite.');
    }
    throw AppError.badRequest('Não foi possível decodificar o áudio enviado.', { cause: error });
  }

  return { durationSeconds: parseFfmpegDurationSeconds(stderr) };
}

/**
 * Roda o whisper-cli (whisper.cpp) sobre um WAV já normalizado. `language`
 * `'auto'` ou ausente deixa o modelo detectar sozinho.
 */
export async function runWhisperCli(
  wavPath: string,
  language: string | undefined,
  deps: Pick<TranscriptionDeps, 'whisperCliPath' | 'whisperModelPath' | 'timeoutMs' | 'threads'>,
): Promise<{ text: string; language: string }> {
  const resolvedLanguage = language && language !== 'auto' ? language : 'auto';
  const threads = deps.threads && deps.threads > 0 ? deps.threads : 1;
  const args = ['-m', deps.whisperModelPath, '-f', wavPath, '-nt', '-l', resolvedLanguage, '-t', String(threads)];

  let stdout: string;
  try {
    const result = await runSubprocess(deps.whisperCliPath, args, { timeoutMs: deps.timeoutMs });
    stdout = result.stdout;
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable(`Ferramenta de transcrição indisponível no servidor (${error.toolName}).`);
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('Transcrição excedeu o tempo limite.');
    }
    // whisper-cli rodou e falhou (exit code != 0 ou morto por sinal, ex.: abort
    // nativo por falta de backend ggml carregado). Guardamos exitCode/signal/stderr
    // sanitizado em internalDetails só pra log do servidor — nunca vai pro cliente,
    // ver `app.ts`/`setErrorHandler`. Sem isso, a causa real fica invisível atrás
    // de BUNNYFY_INTERNAL_ERROR (ver docs/CHECKPOINT_BUN019A1_V7_SMOKE500_ROLLBACK_OK_2026-08-13.md).
    if (error instanceof SubprocessExitError) {
      throw AppError.internal('Falha inesperada ao transcrever o áudio.', {
        exitCode: error.exitCode,
        signal: error.signal,
        stderr: error.stderr,
      });
    }
    throw AppError.internal('Falha inesperada ao transcrever o áudio.', { cause: error });
  }

  return { text: stdout.trim(), language: resolvedLanguage };
}

/**
 * Orquestra o pipeline completo: normaliza pra WAV, transcreve, e sempre
 * apaga o WAV intermediário (sucesso, erro ou timeout) — nunca toca no
 * arquivo de entrada, que pode ser uma mídia do `TempStorage` ainda válida.
 */
export async function transcribeAudio(
  inputPath: string,
  opts: { language?: string },
  deps: TranscriptionDeps,
): Promise<TranscriptionResult> {
  await ensureTranscriptionToolsAvailable(deps);

  const wavPath = `${inputPath}.${generateOpaqueId()}.wav`;
  try {
    const { durationSeconds } = await normalizeAudioToWav(inputPath, wavPath, deps.ffmpegPath, deps.timeoutMs);
    const { text, language } = await runWhisperCli(wavPath, opts.language, deps);
    return { text, language, durationSeconds };
  } finally {
    await fs.rm(wavPath, { force: true });
  }
}
