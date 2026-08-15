import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../envelope.ts';
import {
  runSubprocess,
  SubprocessExitError,
  SubprocessTimeoutError,
  ToolNotFoundError,
  type checkToolAvailable,
  type readToolVersion,
} from './subprocess.ts';
import {
  ensureYoutubeToolsAvailable,
  type YoutubeJsRuntime,
} from './youtube.ts';
import { generateOpaqueId, type TempStorage } from '../storage/tempStorage.ts';

export type YtDlpVideoProvider = 'facebook' | 'pinterest';

export const YTDLP_PROVIDER_ALLOWED_HOSTS: Record<YtDlpVideoProvider, string[]> = {
  facebook: ['facebook.com', 'fb.watch'],
  pinterest: ['pinterest.com', 'pin.it'],
};

export const YTDLP_VIDEO_MAX_DURATION_SECONDS = 1_800;

const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

export interface YtDlpVideoDownloadDeps {
  tempStorage: TempStorage;
  mediaDir: string;
  ytDlpPath: string;
  ffmpegPath: string;
  denoPath: string;
  jsRuntime?: YoutubeJsRuntime;
  jsRuntimePath?: string;
  timeoutMs: number;
  maxBytes: number;
  runProcess?: typeof runSubprocess;
  toolAvailable?: typeof checkToolAvailable;
  toolVersion?: typeof readToolVersion;
}

export interface YtDlpVideoDownloadResult {
  mediaId: string;
  mimeType: string;
  sizeBytes: number;
  title: string | null;
  durationSeconds: number;
  thumbnailUrl: string | null;
}

const METADATA_TEMPLATE =
  'after_move:{"ext":%(ext)j,"title":%(title)j,"duration":%(duration)j,"thumbnail":%(thumbnail)j,"is_live":%(is_live)j,"live_status":%(live_status)j}';

function bytesToYtDlpSize(maxBytes: number): string {
  const megabytes = Math.max(1, Math.floor(maxBytes / (1024 * 1024)));
  return `${megabytes}M`;
}

function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    throw AppError.internal('yt-dlp não retornou metadados da mídia baixada.');
  }
  // Campos ausentes no info dict do yt-dlp (comum em Facebook/Pinterest, que
  // nem sempre têm thumbnail/is_live/live_status) viram o literal `NA` sem
  // aspas mesmo com o modificador `j` (JSON-encode) no template de --print,
  // quebrando o JSON. Só afeta valores logo após ":", nunca conteúdo de
  // string (que sempre vem entre aspas).
  const normalized = lastLine.replace(/:NA([,}])/g, ':null$1');
  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    throw AppError.internal('Não foi possível interpretar a resposta do yt-dlp.');
  }
}

function parseEligibleDuration(info: Record<string, unknown>): number {
  const liveStatus = typeof info.live_status === 'string' ? info.live_status : undefined;
  if (
    info.is_live === true ||
    liveStatus === 'is_live' ||
    liveStatus === 'is_upcoming' ||
    liveStatus === 'post_live'
  ) {
    throw AppError.badRequest('Transmissões ao vivo não são aceitas neste download.');
  }

  const duration = info.duration;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > YTDLP_VIDEO_MAX_DURATION_SECONDS
  ) {
    throw AppError.badRequest(
      `A mídia precisa ter duração conhecida de até ${YTDLP_VIDEO_MAX_DURATION_SECONDS} segundos.`,
    );
  }
  return duration;
}

function parseOutputExtension(info: Record<string, unknown>): string {
  const extension = typeof info.ext === 'string' ? info.ext.toLowerCase() : '';
  if (Object.hasOwn(VIDEO_MIME_TYPES, extension)) return extension;
  throw AppError.unavailable('A ferramenta de download produziu um formato inesperado.');
}

async function cleanupArtifacts(mediaDir: string, id: string, keepPath?: string): Promise<void> {
  const prefix = `${id}.`;
  let entries: string[];
  try {
    entries = await fs.readdir(mediaDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map(async (name) => {
        const filePath = path.join(mediaDir, name);
        if (keepPath && path.resolve(filePath) === path.resolve(keepPath)) return;
        await fs.rm(filePath, { force: true });
      }),
  );
}

/**
 * Baixa vídeo público de um provedor suportado por yt-dlp (Facebook,
 * Pinterest) para um id opaco. Mesma política de segurança/limpeza do
 * downloader de YouTube: artefatos parciais somem em qualquer erro e o
 * tamanho final é revalidado pelo TempStorage antes da mídia ficar acessível.
 */
export async function downloadYtDlpVideo(
  url: string,
  deps: YtDlpVideoDownloadDeps,
): Promise<YtDlpVideoDownloadResult> {
  await ensureYoutubeToolsAvailable(deps);

  const id = generateOpaqueId();
  const outputTemplate = `${path.join(deps.mediaDir, id)}.%(ext)s`;
  const run = deps.runProcess ?? runSubprocess;

  const ffmpegLocationArgs = deps.ffmpegPath === 'ffmpeg'
    ? []
    : ['--ffmpeg-location', deps.ffmpegPath];
  const runtime = deps.jsRuntime ?? 'deno';
  const runtimePath = deps.jsRuntimePath?.trim() || (runtime === 'deno' ? deps.denoPath : runtime);
  const jsRuntimeArgs =
    runtime === 'deno' && runtimePath === 'deno'
      ? []
      : ['--no-js-runtimes', '--js-runtimes', `${runtime}:${runtimePath}`];

  const args = [
    '--ignore-config',
    '--no-plugin-dirs',
    '--quiet',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    ...jsRuntimeArgs,
    '--max-filesize',
    bytesToYtDlpSize(deps.maxBytes),
    '--match-filters',
    `!is_live & duration <= ${YTDLP_VIDEO_MAX_DURATION_SECONDS}`,
    ...ffmpegLocationArgs,
    '-o',
    outputTemplate,
    '--print',
    METADATA_TEMPLATE,
    '-f',
    'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
    '--',
    url,
  ];

  try {
    const result = await run(deps.ytDlpPath, args, { timeoutMs: deps.timeoutMs });

    const info = parseLastJsonLine(result.stdout);
    const durationSeconds = parseEligibleDuration(info);
    const ext = parseOutputExtension(info);
    const filePath = `${path.join(deps.mediaDir, id)}.${ext}`;
    const mimeType = VIDEO_MIME_TYPES[ext] ?? 'application/octet-stream';
    const originalName = typeof info.title === 'string' ? `${info.title}.${ext}` : undefined;

    const entry = await deps.tempStorage.registerExisting(id, filePath, {
      mimeType,
      originalName,
      maxBytes: deps.maxBytes,
    });
    await cleanupArtifacts(deps.mediaDir, id, entry.filePath);

    return {
      mediaId: entry.id,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
      title: typeof info.title === 'string' ? info.title : null,
      durationSeconds,
      thumbnailUrl: typeof info.thumbnail === 'string' ? info.thumbnail : null,
    };
  } catch (error) {
    await cleanupArtifacts(deps.mediaDir, id).catch(() => undefined);

    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable(`Ferramenta de download indisponível no servidor (${error.toolName}).`);
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('Download excedeu o tempo limite.');
    }
    if (error instanceof SubprocessExitError) {
      throw new AppError({
        statusCode: 503,
        code: 'BUNNYFY_UNAVAILABLE',
        message: 'O download está temporariamente indisponível.',
        retryable: true,
        internalDetails: {
          source: 'ytdlp-video-subprocess',
          failureKind: error.failureKind,
          exitCode: error.exitCode,
        },
      });
    }
    if (error instanceof AppError) throw error;
    throw AppError.unavailable('O download está temporariamente indisponível.');
  }
}
