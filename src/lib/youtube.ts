import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../envelope.ts';
import {
  checkToolAvailable,
  readToolVersion,
  runSubprocess,
  SubprocessExitError,
  SubprocessTimeoutError,
  ToolNotFoundError,
} from './subprocess.ts';
import { generateOpaqueId, type TempStorage } from '../storage/tempStorage.ts';

export const YOUTUBE_ALLOWED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'm.youtube.com',
];

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  webm: 'audio/webm',
};

const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

export type YoutubeKind = 'audio' | 'video';

export const YOUTUBE_QUERY_MAX_CHARS = 200;
export const YOUTUBE_MAX_DURATION_SECONDS = 1_800;
export const MINIMUM_YTDLP_VERSION = '2026.07.04';
export const MINIMUM_DENO_VERSION = '2.3.0';
export const MINIMUM_NODE_VERSION = '22.0.0';
export const MINIMUM_BUN_VERSION = '1.2.11';
export const MAXIMUM_BUN_VERSION = '1.3.14';
export type YoutubeJsRuntime = 'deno' | 'node' | 'bun';
export const YOUTUBE_AUDIO_QUALITIES = ['best'] as const;
export const YOUTUBE_VIDEO_QUALITIES = ['360p', '480p', '720p', '1080p', 'best'] as const;

export type YoutubeQuality = (typeof YOUTUBE_VIDEO_QUALITIES)[number];

export type YoutubeDownloadInput =
  | { type: 'url'; value: string }
  | { type: 'query'; value: string };

export function isYtDlpVersionSupported(version: string | null | undefined): boolean {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version?.trim() ?? '');
  if (!match) return false;
  const installed = match.slice(1, 4).map((value) => Number.parseInt(value, 10));
  const minimum = MINIMUM_YTDLP_VERSION.split('.').map((value) => Number.parseInt(value, 10));
  for (let index = 0; index < minimum.length; index += 1) {
    if (installed[index]! !== minimum[index]!) return installed[index]! > minimum[index]!;
  }
  return true;
}

function parseRuntimeVersion(version: string | null | undefined): [number, number, number] | null {
  const match = /(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(version?.trim() ?? '');
  if (!match) return null;
  return match.slice(1, 4).map((value) => Number.parseInt(value, 10)) as [number, number, number];
}

function compareRuntimeVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

function parseRequiredRuntimeVersion(version: string): [number, number, number] {
  const parsed = parseRuntimeVersion(version);
  if (!parsed) throw new Error(`versão interna inválida: ${version}`);
  return parsed;
}

export function isDenoVersionSupported(version: string | null | undefined): boolean {
  const installed = parseRuntimeVersion(version);
  return installed !== null
    && compareRuntimeVersions(installed, parseRequiredRuntimeVersion(MINIMUM_DENO_VERSION)) >= 0;
}

export function isNodeVersionSupported(version: string | null | undefined): boolean {
  const installed = parseRuntimeVersion(version);
  return installed !== null
    && compareRuntimeVersions(installed, parseRequiredRuntimeVersion(MINIMUM_NODE_VERSION)) >= 0;
}

export function isBunVersionSupported(version: string | null | undefined): boolean {
  const installed = parseRuntimeVersion(version);
  if (!installed) return false;
  return (
    compareRuntimeVersions(installed, parseRequiredRuntimeVersion(MINIMUM_BUN_VERSION)) >= 0
    && compareRuntimeVersions(installed, parseRequiredRuntimeVersion(MAXIMUM_BUN_VERSION)) <= 0
  );
}

export function isYoutubeJsRuntimeVersionSupported(
  runtime: YoutubeJsRuntime,
  version: string | null | undefined,
): boolean {
  if (runtime === 'deno') return isDenoVersionSupported(version);
  if (runtime === 'node') return isNodeVersionSupported(version);
  return isBunVersionSupported(version);
}

export function isYoutubeQueryTextValid(value: string): boolean {
  const query = value.trim();
  if (query.length === 0 || query.length > YOUTUBE_QUERY_MAX_CHARS) return false;

  for (const character of query) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 31 || codePoint === 127) return false;
  }
  return true;
}

export interface YoutubeDownloadDeps {
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

export interface YoutubeDownloadResult {
  mediaId: string;
  mimeType: string;
  sizeBytes: number;
  title: string | null;
  durationSeconds: number;
  thumbnailUrl: string | null;
}

const VIDEO_QUALITY_FORMATS: Record<YoutubeQuality, string> = {
  '360p': 'bv*[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/bv*[height<=360]+ba/b[height<=360]',
  '480p': 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=480]+ba/b[height<=480]',
  '720p': 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]',
  '1080p': 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]',
  best: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
};

const YOUTUBE_METADATA_TEMPLATE =
  'after_move:{"ext":%(ext)j,"title":%(title)j,"duration":%(duration)j,"thumbnail":%(thumbnail)j,"is_live":%(is_live)j,"live_status":%(live_status)j}';

function resolveVideoFormat(quality: YoutubeQuality | undefined): string {
  return VIDEO_QUALITY_FORMATS[quality ?? 'best'];
}

function bytesToYtDlpSize(maxBytes: number): string {
  const megabytes = Math.max(1, Math.floor(maxBytes / (1024 * 1024)));
  return `${megabytes}M`;
}

function resolveYtDlpInput(input: YoutubeDownloadInput): string {
  if (input.type === 'url') return input.value;

  const query = input.value.trim();
  if (!isYoutubeQueryTextValid(query)) {
    throw AppError.badRequest('Consulta de busca do YouTube inválida.');
  }

  // Prefixo próprio do yt-dlp limitado a um único resultado. A consulta nunca
  // é interpolada em shell e o separador `--` adicionado abaixo impede que ela
  // seja interpretada como opção do subprocesso.
  return `ytsearch1:${query}`;
}

function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    throw AppError.internal('yt-dlp não retornou metadados da mídia baixada.');
  }
  // Campo ausente no info dict (ex.: thumbnail/is_live/live_status em fontes
  // que não os fornecem) vira o literal `NA` sem aspas mesmo com o
  // modificador `j` (JSON-encode) no template de --print, quebrando o JSON.
  // Só afeta valores logo após ":", nunca conteúdo de string (sempre entre aspas).
  const normalized = lastLine.replace(/:NA([,}])/g, ':null$1');
  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    // O erro nativo de JSON pode repetir trechos do stdout. Como metadados do
    // yt-dlp podem conter a consulta ou a URL selecionada, ele não é anexado ao
    // AppError nem aos detalhes internos que seguem para o logger.
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
    duration > YOUTUBE_MAX_DURATION_SECONDS
  ) {
    throw AppError.badRequest(
      `A mídia precisa ter duração conhecida de até ${YOUTUBE_MAX_DURATION_SECONDS} segundos.`,
    );
  }
  return duration;
}

function parseOutputExtension(kind: YoutubeKind, info: Record<string, unknown>): string {
  const extension = typeof info.ext === 'string' ? info.ext.toLowerCase() : '';
  if (kind === 'audio' && extension === 'mp3') return extension;
  if (kind === 'video' && Object.hasOwn(VIDEO_MIME_TYPES, extension)) return extension;
  throw AppError.unavailable('A ferramenta de download produziu um formato inesperado.');
}

async function cleanupYoutubeArtifacts(mediaDir: string, id: string, keepPath?: string): Promise<void> {
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

function resolveYoutubeJsRuntime(
  deps: Pick<YoutubeDownloadDeps, 'denoPath' | 'jsRuntime' | 'jsRuntimePath'>,
): { runtime: YoutubeJsRuntime; runtimePath: string } {
  const runtime = deps.jsRuntime ?? 'deno';
  const runtimePath = deps.jsRuntimePath?.trim() || (runtime === 'deno' ? deps.denoPath : runtime);
  return { runtime, runtimePath };
}

export async function ensureYoutubeToolsAvailable(
  deps: Pick<
    YoutubeDownloadDeps,
    'ytDlpPath' | 'ffmpegPath' | 'denoPath' | 'jsRuntime' | 'jsRuntimePath' | 'toolAvailable' | 'toolVersion'
  >,
): Promise<void> {
  const check = deps.toolAvailable ?? checkToolAvailable;
  const getVersion = deps.toolVersion ?? readToolVersion;
  const { runtime, runtimePath } = resolveYoutubeJsRuntime(deps);
  // `getVersion` já confirma disponibilidade (retorna null se o binário não
  // roda); chamar `check` em paralelo pro mesmo binário só duplicava o
  // subprocesso e causava corrida em executáveis empacotados (extração
  // concorrente pro mesmo diretório temporário podia fazer uma das duas
  // chamadas falhar de forma intermitente).
  const [ffmpegOk, ytDlpVersion, runtimeVersion] = await Promise.all([
    check(deps.ffmpegPath),
    getVersion(deps.ytDlpPath),
    getVersion(runtimePath),
  ]);

  if (!ffmpegOk || ytDlpVersion === null || runtimeVersion === null) {
    const missing = [
      ytDlpVersion === null && 'yt-dlp',
      !ffmpegOk && 'ffmpeg',
      runtimeVersion === null && runtime,
    ].filter(Boolean).join(', ');
    throw AppError.toolUnavailable(`Ferramenta de download indisponível no servidor (${missing}).`);
  }
  if (!isYtDlpVersionSupported(ytDlpVersion)) {
    throw AppError.toolUnavailable('A ferramenta de download do YouTube precisa ser atualizada no servidor.');
  }
  if (!isYoutubeJsRuntimeVersionSupported(runtime, runtimeVersion)) {
    throw AppError.toolUnavailable('O runtime JavaScript do YouTube precisa ser atualizado no servidor.');
  }
}

/**
 * Baixa mídia do YouTube para um id opaco. Artefatos parciais são removidos
 * em qualquer erro e o tamanho final é revalidado pelo TempStorage antes de a
 * mídia se tornar acessível.
 */
export async function downloadYoutubeMedia(
  kind: YoutubeKind,
  input: YoutubeDownloadInput,
  quality: YoutubeQuality | undefined,
  deps: YoutubeDownloadDeps,
): Promise<YoutubeDownloadResult> {
  const ytDlpInput = resolveYtDlpInput(input);
  await ensureYoutubeToolsAvailable(deps);

  const id = generateOpaqueId();
  const outputTemplate = `${path.join(deps.mediaDir, id)}.%(ext)s`;
  const run = deps.runProcess ?? runSubprocess;

  // O valor padrão é um nome resolvido pelo PATH. Passá-lo a
  // --ffmpeg-location faria o yt-dlp tratá-lo como caminho relativo. Caminhos
  // explícitos continuam suportados para ambientes provisionados à parte.
  const ffmpegLocationArgs = deps.ffmpegPath === 'ffmpeg'
    ? []
    : ['--ffmpeg-location', deps.ffmpegPath];
  const { runtime: youtubeJsRuntime, runtimePath: youtubeJsRuntimePath } = resolveYoutubeJsRuntime(deps);
  const jsRuntimeArgs =
    youtubeJsRuntime === 'deno' && youtubeJsRuntimePath === 'deno'
      ? []
      : ['--no-js-runtimes', '--js-runtimes', `${youtubeJsRuntime}:${youtubeJsRuntimePath}`];

  const commonArgs = [
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
    `!is_live & duration <= ${YOUTUBE_MAX_DURATION_SECONDS}`,
    ...ffmpegLocationArgs,
    '-o',
    outputTemplate,
    '--print',
    YOUTUBE_METADATA_TEMPLATE,
  ];

  const kindArgs =
    kind === 'audio'
      ? ['-f', 'ba[acodec^=mp3]/ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
      : ['-f', resolveVideoFormat(quality)];

  try {
    const result = await run(deps.ytDlpPath, [...commonArgs, ...kindArgs, '--', ytDlpInput], {
      timeoutMs: deps.timeoutMs,
    });

    const info = parseLastJsonLine(result.stdout);
    const durationSeconds = parseEligibleDuration(info);
    const ext = parseOutputExtension(kind, info);
    const filePath = `${path.join(deps.mediaDir, id)}.${ext}`;
    const mimeType = (kind === 'audio' ? AUDIO_MIME_TYPES[ext] : VIDEO_MIME_TYPES[ext]) ?? 'application/octet-stream';
    const originalName = typeof info.title === 'string' ? `${info.title}.${ext}` : undefined;

    const entry = await deps.tempStorage.registerExisting(id, filePath, {
      mimeType,
      originalName,
      maxBytes: deps.maxBytes,
    });
    await cleanupYoutubeArtifacts(deps.mediaDir, id, entry.filePath);

    return {
      mediaId: entry.id,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
      title: typeof info.title === 'string' ? info.title : null,
      durationSeconds,
      thumbnailUrl: typeof info.thumbnail === 'string' ? info.thumbnail : null,
    };
  } catch (error) {
    await cleanupYoutubeArtifacts(deps.mediaDir, id).catch(() => undefined);

    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable(`Ferramenta de download indisponível no servidor (${error.toolName}).`);
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('Download do YouTube excedeu o tempo limite.');
    }
    if (error instanceof SubprocessExitError) {
      throw new AppError({
        statusCode: 503,
        code: 'BUNNYFY_UNAVAILABLE',
        message: 'O download do YouTube está temporariamente indisponível.',
        retryable: true,
        internalDetails: {
          source: 'youtube-subprocess',
          failureKind: error.failureKind,
          exitCode: error.exitCode,
        },
      });
    }
    if (error instanceof AppError) throw error;
    // Erros de processo podem conter a linha de comando completa. Não manter a
    // causa impede que URL ou consulta reapareçam em logs futuros por acidente.
    throw AppError.unavailable('O download do YouTube está temporariamente indisponível.');
  }
}
