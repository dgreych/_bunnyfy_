import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { buildConfig, type AppConfig } from '../src/config.ts';
import {
  isDenoVersionSupported,
  isYoutubeJsRuntimeVersionSupported,
  isYtDlpVersionSupported,
  MINIMUM_DENO_VERSION,
  MINIMUM_YTDLP_VERSION,
  type YoutubeJsRuntime,
} from '../src/lib/youtube.ts';

function loadLocalEnvironment(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function runVersion(command: string, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, timeout: 10_000 });
  if (result.error || result.status !== 0) return { available: false, version: null };
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return { available: true, version: output.split('\n')[0]?.trim() || null };
}

async function readableFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function writableDirectory(dir: string): Promise<boolean> {
  const resolved = path.resolve(dir);
  const probe = path.join(resolved, `.preflight-${process.pid}-${Date.now()}`);
  try {
    await fs.mkdir(resolved, { recursive: true, mode: 0o700 });
    await fs.writeFile(probe, 'ok', { mode: 0o600 });
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    await fs.rm(probe, { force: true }).catch(() => undefined);
    return false;
  }
}

loadLocalEnvironment();

let config: AppConfig | undefined;
try {
  config = buildConfig(process.env);
} catch {
  config = undefined;
}

const mediaDir = config?.mediaDir ?? path.resolve(process.env.MEDIA_DIR || './data/tmp');
const whisperModelPath = config?.whisperModelPath ?? path.resolve(process.env.WHISPER_MODEL_PATH || './models/ggml-base.bin');
const ytDlpPath = config?.ytDlpPath ?? (process.env.YTDLP_PATH?.trim() || 'yt-dlp');
const ffmpegPath = config?.ffmpegPath ?? (process.env.FFMPEG_PATH?.trim() || 'ffmpeg');
const denoPath = config?.denoPath ?? (process.env.DENO_PATH?.trim() || 'deno');
const runtimeFromEnv = process.env.YOUTUBE_JS_RUNTIME?.trim();
const youtubeJsRuntime: YoutubeJsRuntime =
  config?.youtubeJsRuntime
  ?? (runtimeFromEnv === 'node' || runtimeFromEnv === 'bun' || runtimeFromEnv === 'deno'
    ? runtimeFromEnv
    : 'deno');
const youtubeJsRuntimePath =
  config?.youtubeJsRuntimePath
  ?? process.env.YOUTUBE_JS_RUNTIME_PATH?.trim()
  ?? (youtubeJsRuntime === 'deno' ? denoPath : youtubeJsRuntime);
const whisperCliPath = config?.whisperCliPath ?? (process.env.WHISPER_CLI_PATH?.trim() || 'whisper-cli');
const rembgPath = config?.rembgPath ?? (process.env.REMBG_PATH?.trim() || 'rembg');
const rembgModel = process.env.REMBG_MODEL?.trim() || 'silueta';
const rembgModelDir = process.env.REMBG_MODEL_DIR?.trim() || './models/rembg';
const rembgModelPath = config?.rembgModelPath ?? path.resolve(rembgModelDir, `${rembgModel}.onnx`);

const modernApiKeysPresent = Boolean(process.env.BUNNYFY_API_KEYS?.trim());
const legacyApiTokensPresent = Boolean(process.env.BUNNYFY_API_TOKENS?.trim());
const mediaSigningSecretPresent = Boolean(process.env.MEDIA_SIGNING_SECRET?.trim());
const storageWritable = await writableDirectory(mediaDir);
const ytDlpCheck = runVersion(ytDlpPath);
const ytDlpCompatible = ytDlpCheck.available && isYtDlpVersionSupported(ytDlpCheck.version);
const youtubeJsRuntimeCheck = runVersion(youtubeJsRuntimePath);
const youtubeJsRuntimeCompatible =
  youtubeJsRuntimeCheck.available
  && isYoutubeJsRuntimeVersionSupported(youtubeJsRuntime, youtubeJsRuntimeCheck.version);
const denoCheck =
  youtubeJsRuntime === 'deno'
    ? youtubeJsRuntimeCheck
    : { available: false, version: null };
const denoCompatible =
  youtubeJsRuntime === 'deno'
  && denoCheck.available
  && isDenoVersionSupported(denoCheck.version);

const checks = {
  runtime: {
    node: process.versions.node,
    npm: runVersion('npm').version,
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
  },
  storage: {
    mediaDirWritable: storageWritable,
  },
  tools: {
    ytDlp: {
      ...ytDlpCheck,
      compatible: ytDlpCompatible,
      minimumVersion: MINIMUM_YTDLP_VERSION,
    },
    ffmpeg: runVersion(ffmpegPath, ['-version']),
    deno: {
      ...denoCheck,
      compatible: denoCompatible,
      minimumVersion: MINIMUM_DENO_VERSION,
    },
    youtubeJsRuntime: {
      name: youtubeJsRuntime,
      ...youtubeJsRuntimeCheck,
      compatible: youtubeJsRuntimeCompatible,
    },
    whisper: runVersion(whisperCliPath, ['--help']),
    whisperModelReadable: await readableFile(whisperModelPath),
    rembg: runVersion(rembgPath),
    rembgModelReadable: await readableFile(rembgModelPath),
  },
  config: {
    valid: Boolean(config),
    authenticationConfigured: modernApiKeysPresent || legacyApiTokensPresent,
    modernApiKeysPresent,
    legacyApiTokensPresent,
    mediaSigningSecretPresent,
    capabilities: {
      aiChatEnabled: config?.aiChatEnabled ?? false,
      aiChatCredentialPresent: Boolean(config?.nvidiaApiKey),
      aiChatModelPresent: Boolean(config?.nvidiaModel),
    },
  },
};

const nodeParts = process.versions.node.split('.').map((value) => Number.parseInt(value, 10));
const nodeCompatible = nodeParts[0]! > 20 || (nodeParts[0] === 20 && nodeParts[1]! >= 12);
const coreReady = nodeCompatible && storageWritable && Boolean(config);

const output = {
  ok: coreReady,
  checks,
  notes: {
    node20TemporaryCompatibility: nodeParts[0] === 20,
    youtubeReady:
      checks.tools.ytDlp.compatible
      && checks.tools.ffmpeg.available
      && checks.tools.youtubeJsRuntime.compatible,
    transcriptionReady: checks.tools.ffmpeg.available && checks.tools.whisper.available && checks.tools.whisperModelReadable,
    backgroundRemovalReady: checks.tools.rembg.available && checks.tools.rembgModelReadable,
    aiChatReady: Boolean(config?.aiChatEnabled && config.nvidiaApiKey && config.nvidiaModel),
    legacyApiTokensEnabled: legacyApiTokensPresent,
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = coreReady ? 0 : 1;
