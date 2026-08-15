import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';

import { envelopeMeta } from '../context.ts';
import { okEnvelope } from '../envelope.ts';
import { checkToolAvailable, readToolVersion } from '../lib/subprocess.ts';
import {
  isYoutubeJsRuntimeVersionSupported,
  isYtDlpVersionSupported,
  type YoutubeJsRuntime,
} from '../lib/youtube.ts';

export interface HealthRouteDeps {
  mediaDir: string;
  ytDlpPath: string;
  ffmpegPath: string;
  denoPath: string;
  youtubeJsRuntime?: YoutubeJsRuntime;
  youtubeJsRuntimePath?: string;
  whisperCliPath: string;
  whisperModelPath: string;
  rembgPath: string;
  rembgModelPath: string;
  aiChatAvailable: boolean;
  movieQuizAvailable: boolean;
  youtubeEgressAvailable: boolean;
  youtubeFallbackAvailable: boolean;
}

async function isDirWritable(dir: string): Promise<boolean> {
  const probePath = path.join(dir, `.write-probe-${process.pid}`);
  try {
    await fs.writeFile(probePath, 'ok');
    await fs.rm(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** `/health` e `/ready` são sempre públicos — orquestrador/load balancer não tem token da API. */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get('/health', (request) => okEnvelope({ status: 'ok' }, envelopeMeta(request)));

  app.get('/ready', async (request, reply) => {
    const storageWritable = await isDirWritable(deps.mediaDir);
    const youtubeJsRuntime = deps.youtubeJsRuntime ?? 'deno';
    const youtubeJsRuntimePath =
      deps.youtubeJsRuntimePath?.trim() || (youtubeJsRuntime === 'deno' ? deps.denoPath : youtubeJsRuntime);

    const [ytDlpVersion, ffmpegAvailable, youtubeJsRuntimeVersion, whisperCliAvailable, whisperModelAvailable, rembgAvailable, rembgModelAvailable] =
      await Promise.all([
        readToolVersion(deps.ytDlpPath),
        checkToolAvailable(deps.ffmpegPath),
        readToolVersion(youtubeJsRuntimePath),
        checkToolAvailable(deps.whisperCliPath),
        fileExists(deps.whisperModelPath),
        checkToolAvailable(deps.rembgPath),
        fileExists(deps.rembgModelPath),
      ]);
    const ytDlpAvailable = isYtDlpVersionSupported(ytDlpVersion);
    const youtubeJsRuntimeAvailable = isYoutubeJsRuntimeVersionSupported(
      youtubeJsRuntime,
      youtubeJsRuntimeVersion,
    );

    const checks = {
      storageWritable,
      tools: {
        ytDlp: ytDlpAvailable,
        ffmpeg: ffmpegAvailable,
        deno: youtubeJsRuntime === 'deno' && youtubeJsRuntimeAvailable,
        youtubeJsRuntime: youtubeJsRuntimeAvailable,
        youtubeJsRuntimeName: youtubeJsRuntime,
        whisperCli: whisperCliAvailable,
        rembg: rembgAvailable,
      },
      models: {
        whisper: whisperModelAvailable,
        backgroundRemoval: rembgModelAvailable,
      },
      capabilities: {
        mediaUpload: storageWritable,
        socialCanvas: storageWritable,
        animatedLogos: storageWritable && ffmpegAvailable,
        imageUpscale: storageWritable,
        youtube: storageWritable && (
          deps.youtubeEgressAvailable
          || deps.youtubeFallbackAvailable
          || (ytDlpAvailable && ffmpegAvailable && youtubeJsRuntimeAvailable)
        ),
        transcription: storageWritable && ffmpegAvailable && whisperCliAvailable && whisperModelAvailable,
        backgroundRemoval: storageWritable && rembgAvailable && rembgModelAvailable,
        aiChat: deps.aiChatAvailable,
        movieQuiz: deps.movieQuizAvailable,
      },
    };

    if (!storageWritable) {
      reply.code(503);
      return okEnvelope({ status: 'not_ready', checks }, envelopeMeta(request));
    }

    return okEnvelope({ status: 'ready', checks }, envelopeMeta(request));
  });
}
