import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { AppError } from '../src/envelope.ts';
import { transcribeAudio, type TranscriptionResult } from '../src/lib/transcription.ts';

interface TimedResult {
  elapsedMs: number;
  result: TranscriptionResult;
}

interface QualityResult {
  wordErrorRate: number;
  referenceWords: number;
  outputWords: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}.`);
  return value;
}

function normalizeWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(reference: readonly string[], output: readonly string[]): number {
  let previous = Array.from({ length: output.length + 1 }, (_, index) => index);

  for (let i = 1; i <= reference.length; i += 1) {
    const current = new Array<number>(output.length + 1);
    current[0] = i;

    for (let j = 1; j <= output.length; j += 1) {
      const substitutionCost = reference[i - 1] === output[j - 1] ? 0 : 1;
      const deletion = (previous[j] ?? Number.POSITIVE_INFINITY) + 1;
      const insertion = (current[j - 1] ?? Number.POSITIVE_INFINITY) + 1;
      const substitution = (previous[j - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost;
      current[j] = Math.min(deletion, insertion, substitution);
    }

    previous = current;
  }

  return previous[output.length] ?? reference.length;
}

function evaluateQuality(referenceText: string, outputText: string): QualityResult {
  const referenceWords = normalizeWords(referenceText);
  const outputWords = normalizeWords(outputText);
  if (referenceWords.length === 0) throw new Error('Referência PT-BR vazia após normalização.');
  if (outputWords.length === 0) throw new Error('Whisper retornou transcrição vazia.');

  return {
    wordErrorRate: editDistance(referenceWords, outputWords) / referenceWords.length,
    referenceWords: referenceWords.length,
    outputWords: outputWords.length,
  };
}

async function timedTranscription(
  audioPath: string,
  language: 'pt' | 'auto',
  deps: { whisperCliPath: string; whisperModelPath: string; ffmpegPath: string; timeoutMs: number },
): Promise<TimedResult> {
  const startedAt = performance.now();
  const result = await transcribeAudio(audioPath, { language }, deps);
  return { result, elapsedMs: performance.now() - startedAt };
}

async function generatedWavFiles(audioPath: string): Promise<string[]> {
  const directory = path.dirname(audioPath);
  const prefix = `${path.basename(audioPath)}.`;
  const entries = await fs.readdir(directory);
  return entries.filter((name) => name.startsWith(prefix) && name.endsWith('.wav'));
}

async function assertNoGeneratedWav(audioPath: string): Promise<void> {
  const leftovers = await generatedWavFiles(audioPath);
  if (leftovers.length > 0) throw new Error(`Cleanup incompleto: ${leftovers.length} WAV intermediário(s) permaneceram.`);
}

async function assertReadableFile(filePath: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0) throw new Error();
  } catch {
    throw new Error(`${label} ausente ou vazio.`);
  }
}

async function main(): Promise<void> {
  const audioPath = requiredEnv('WHISPER_SMOKE_AUDIO_PATH');
  const referencePath = requiredEnv('WHISPER_SMOKE_REFERENCE_PATH');
  const whisperCliPath = requiredEnv('WHISPER_CLI_PATH');
  const whisperModelPath = requiredEnv('WHISPER_MODEL_PATH');
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const reportPath = process.env.WHISPER_SMOKE_REPORT_PATH?.trim();
  const timeoutMs = Number(process.env.WHISPER_SMOKE_TIMEOUT_MS ?? 180_000);
  const maxWer = Number(process.env.WHISPER_SMOKE_MAX_WER ?? 0.85);

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error('WHISPER_SMOKE_TIMEOUT_MS inválido.');
  if (!Number.isFinite(maxWer) || maxWer <= 0) throw new Error('WHISPER_SMOKE_MAX_WER inválido.');

  await Promise.all([
    assertReadableFile(audioPath, 'Áudio do smoke'),
    assertReadableFile(referencePath, 'Transcrição de referência'),
    assertReadableFile(whisperCliPath, 'whisper-cli'),
    assertReadableFile(whisperModelPath, 'Modelo Whisper'),
  ]);
  await assertNoGeneratedWav(audioPath);

  const referenceText = await fs.readFile(referencePath, 'utf8');
  const deps = { whisperCliPath, whisperModelPath, ffmpegPath, timeoutMs };

  const pt = await timedTranscription(audioPath, 'pt', deps);
  await assertNoGeneratedWav(audioPath);
  if (pt.result.language !== 'pt') throw new Error('Resposta de language=pt não preservou o idioma solicitado.');
  if (pt.result.durationSeconds <= 0) throw new Error('Duração do áudio não foi medida pelo FFmpeg.');
  const ptQuality = evaluateQuality(referenceText, pt.result.text);
  if (ptQuality.wordErrorRate > maxWer) {
    throw new Error(`Qualidade PT-BR abaixo do piso do smoke (WER ${ptQuality.wordErrorRate.toFixed(3)} > ${maxWer}).`);
  }

  const auto = await timedTranscription(audioPath, 'auto', deps);
  await assertNoGeneratedWav(audioPath);
  if (auto.result.language !== 'auto') throw new Error('Resposta de language=auto não preservou o modo automático atual.');
  if (Math.abs(auto.result.durationSeconds - pt.result.durationSeconds) > 0.05) {
    throw new Error('Medição de duração divergiu entre language=pt e language=auto.');
  }
  const autoQuality = evaluateQuality(referenceText, auto.result.text);
  if (autoQuality.wordErrorRate > maxWer) {
    throw new Error(`Qualidade em auto abaixo do piso do smoke (WER ${autoQuality.wordErrorRate.toFixed(3)} > ${maxWer}).`);
  }

  let timeoutConfirmed = false;
  try {
    await transcribeAudio(audioPath, { language: 'pt' }, { ...deps, timeoutMs: 1 });
  } catch (error) {
    if (error instanceof AppError && error.code === 'BUNNYFY_TIMEOUT') timeoutConfirmed = true;
    else throw error;
  }
  if (!timeoutConfirmed) throw new Error('Timeout real não produziu BUNNYFY_TIMEOUT.');
  await assertNoGeneratedWav(audioPath);

  const report = {
    ok: true,
    source: 'FLEURS pt_br mirrored by FluidInference/fleurs-full',
    audioDurationSeconds: Number(pt.result.durationSeconds.toFixed(2)),
    pt: {
      elapsedMs: Math.round(pt.elapsedMs),
      wordErrorRate: Number(ptQuality.wordErrorRate.toFixed(4)),
      referenceWords: ptQuality.referenceWords,
      outputWords: ptQuality.outputWords,
      outputCharacters: pt.result.text.length,
    },
    auto: {
      elapsedMs: Math.round(auto.elapsedMs),
      wordErrorRate: Number(autoQuality.wordErrorRate.toFixed(4)),
      referenceWords: autoQuality.referenceWords,
      outputWords: autoQuality.outputWords,
      outputCharacters: auto.result.text.length,
    },
    timeoutConfirmed,
    cleanupConfirmed: true,
  };

  if (reportPath) await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch((error: unknown) => {
  if (error instanceof AppError) {
    process.stderr.write(`[smoke-whisper] ${error.code}: ${error.message}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`[smoke-whisper] ${error.message}\n`);
  } else {
    process.stderr.write('[smoke-whisper] Falha não identificada.\n');
  }
  process.exitCode = 1;
});
