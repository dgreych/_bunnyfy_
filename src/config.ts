import path from 'node:path';
import { z } from 'zod';

import { parseApiKeysJson } from './security/apiKeys.ts';

const boolFromEnv = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

const strictBoolFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const optionalTrimmedString = (schema: z.ZodString) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    schema.trim().optional(),
  );

const modelIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/);
const cloudflareImageModelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^@cf\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/);

const csvModelIds = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((model) => model.trim())
      .filter((model) => model.length > 0),
  )
  .pipe(z.array(modelIdSchema).max(32));

const csvTokens = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0),
  )
  .pipe(z.array(z.string().min(16, 'cada token precisa ter ao menos 16 caracteres')));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: boolFromEnv,
  JSON_BODY_MAX_BYTES: z.coerce.number().int().positive().default(1024 * 1024),

  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),

  BUNNYFY_API_KEYS: z.string().optional(),
  BUNNYFY_API_TOKENS: csvTokens,
  MEDIA_SIGNING_SECRET: z.string().min(32, 'MEDIA_SIGNING_SECRET precisa ter ao menos 32 caracteres'),

  MEDIA_DIR: z.string().optional(),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MEDIA_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  MEDIA_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  DOWNLOAD_MAX_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),

  YTDLP_PATH: z.string().default('yt-dlp'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  DENO_PATH: z.string().default('deno'),
  YOUTUBE_JS_RUNTIME: z.enum(['deno', 'node', 'bun']).default('deno'),
  YOUTUBE_JS_RUNTIME_PATH: optionalTrimmedString(z.string().min(1).max(4096)),
  YOUTUBE_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  YOUTUBE_DOWNLOAD_MAX_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  YOUTUBE_EGRESS_ENABLED: boolFromEnv,
  YOUTUBE_EGRESS_URL: optionalTrimmedString(z.string().url().max(2_048)),
  YOUTUBE_EGRESS_SHARED_SECRET: optionalTrimmedString(z.string().min(32).max(512)),
  YOUTUBE_FALLBACK_ENABLED: boolFromEnv,
  YOUTUBE_FALLBACK_BASE_URL: optionalTrimmedString(z.string().url().max(2_048)),
  YOUTUBE_FALLBACK_API_KEY: optionalTrimmedString(z.string().min(16).max(512)),
  YOUTUBE_FALLBACK_MEDIA_HOSTS: optionalTrimmedString(z.string().max(2_048)),
  YOUTUBE_FALLBACK_MAX_CONTROL_BYTES: z.coerce.number().int().positive().max(1024 * 1024).default(256 * 1024),

  SOCIAL_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SOCIAL_DOWNLOAD_MAX_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),

  WHISPER_CLI_PATH: z.string().default('whisper-cli'),
  WHISPER_MODEL_PATH: z.string().default('./models/ggml-base.bin'),
  // Default 1 de propósito — ver comentário de TranscriptionDeps.threads em
  // src/lib/transcription.ts: sob cgroup CPU quota, mais threads que o
  // hardware realmente entrega em paralelo causa contenção catastrófica no
  // OpenMP do whisper.cpp, não só lentidão proporcional.
  WHISPER_THREADS: z.coerce.number().int().positive().default(1),
  TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  TRANSCRIPTION_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  TRANSCRIPTION_MAX_INPUT_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),

  REMBG_PATH: z.string().default('rembg'),
  REMBG_MODEL: z.enum(['silueta', 'u2netp', 'isnet-general-use']).default('silueta'),
  REMBG_MODEL_DIR: z.string().default('./models/rembg'),
  REMBG_OMP_NUM_THREADS: z.coerce.number().int().positive().max(8).default(2),
  BACKGROUND_REMOVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  IMAGE_UPSCALE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  IMAGE_PROCESS_MAX_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  IMAGE_MAX_INPUT_PIXELS: z.coerce.number().int().positive().default(16_000_000),
  IMAGE_MAX_OUTPUT_PIXELS: z.coerce.number().int().positive().default(36_000_000),
  IMAGE_MAX_OUTPUT_DIMENSION: z.coerce.number().int().positive().default(16_384),
  IMAGE_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),

  CANVAS_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  CANVAS_MAX_AVATAR_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  CANVAS_MAX_TOTAL_AVATAR_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  CANVAS_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  TAVERN_GAME_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  TAVERN_GAME_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  TAVERN_GAME_MAX_STATE_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),

  // Geração de imagem por adaptador interno. Pollinations permanece como
  // baseline/fallback; Cloudflare entra somente por modo explícito.
  IMAGE_GEN_MODE: z.enum(['pollinations', 'cloudflare-canary', 'cloudflare-primary']).default('pollinations'),
  POLLINATIONS_API_TOKEN: optionalTrimmedString(z.string().min(8).max(512)),
  POLLINATIONS_IMAGE_ENHANCE: strictBoolFromEnv,
  CLOUDFLARE_ACCOUNT_ID: optionalTrimmedString(z.string().regex(/^[A-Fa-f0-9]{32}$/)),
  CLOUDFLARE_API_TOKEN: optionalTrimmedString(z.string().min(20).max(512).regex(/^\S+$/)),
  CLOUDFLARE_IMAGE_MODEL: cloudflareImageModelSchema.default('@cf/black-forest-labs/flux-2-klein-4b'),
  CLOUDFLARE_IMAGE_CANARY_PERCENT: z.coerce.number().int().min(0).max(100).default(10),
  IMAGE_GEN_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(45_000),
  IMAGE_GEN_MAX_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  IMAGE_GEN_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  TAVERN_ART_MAX_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  TAVERN_ART_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  LOGO_RENDER_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(45_000),
  LOGO_MAX_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  LOGO_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().max(20 * 1024 * 1024).default(8 * 1024 * 1024),

  MOVIE_QUIZ_ENABLED: boolFromEnv,
  MOVIE_QUIZ_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(10_000),
  MOVIE_QUIZ_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().max(1024 * 1024).default(256 * 1024),
  MOVIE_QUIZ_RATE_WINDOW_MS: z.coerce.number().int().min(5_000).max(60_000).default(5_000),

  AI_CHAT_ENABLED: boolFromEnv,
  NVIDIA_API_KEY: optionalTrimmedString(z.string().min(16).max(512)),
  NVIDIA_MODEL: optionalTrimmedString(modelIdSchema),
  NVIDIA_ALLOWED_MODELS: csvModelIds,
  AI_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(120_000),
  AI_CHAT_MAX_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  AI_CHAT_MAX_CONCURRENCY_PER_CONSUMER: z.coerce.number().int().positive().max(16).default(1),
  AI_CHAT_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().max(600).default(30),
  AI_CHAT_MAX_REQUESTS_PER_MINUTE_PER_CONSUMER: z.coerce.number().int().positive().max(600).default(10),
  AI_CHAT_MAX_MESSAGES: z.coerce.number().int().positive().max(64).default(24),
  AI_CHAT_MAX_MESSAGE_CHARS: z.coerce.number().int().positive().max(20_000).default(16_000),
  AI_CHAT_MAX_TOTAL_CHARS: z.coerce.number().int().positive().max(100_000).default(48_000),
  AI_CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(16_384).default(2_000),
  AI_CHAT_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().max(10 * 1024 * 1024).default(1024 * 1024),

  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type AppConfig = ReturnType<typeof buildConfig>;

/**
 * Lê e valida as variáveis de ambiente. Lança um erro descritivo e falha o
 * boot se algo obrigatório estiver ausente — nunca cai em um valor padrão
 * inseguro para segredo.
 */
export function buildConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }

  const data = parsed.data;
  let apiKeys;
  try {
    apiKeys = parseApiKeysJson(data.BUNNYFY_API_KEYS, { legacyTokens: data.BUNNYFY_API_TOKENS });
  } catch {
    throw new Error('Configuração inválida:\n  - BUNNYFY_API_KEYS: configuração de chaves inválida');
  }
  if (apiKeys.size === 0) {
    throw new Error('Configuração inválida:\n  - BUNNYFY_API_KEYS: configure ao menos uma chave BunnyFy');
  }
  if (data.IMAGE_MAX_OUTPUT_PIXELS < data.IMAGE_MAX_INPUT_PIXELS) {
    throw new Error('Configuração inválida:\n  - IMAGE_MAX_OUTPUT_PIXELS: precisa ser >= IMAGE_MAX_INPUT_PIXELS');
  }
  if (data.AI_CHAT_MAX_TOTAL_CHARS < data.AI_CHAT_MAX_MESSAGE_CHARS) {
    throw new Error('Configuração inválida:\n  - AI_CHAT_MAX_TOTAL_CHARS: precisa ser >= AI_CHAT_MAX_MESSAGE_CHARS');
  }
  if (data.AI_CHAT_ENABLED && (!data.NVIDIA_API_KEY || !data.NVIDIA_MODEL)) {
    throw new Error('Configuração inválida:\n  - gateway de IA: configure credencial e modelo internos antes de ativar');
  }
  if (data.YOUTUBE_EGRESS_ENABLED && (!data.YOUTUBE_EGRESS_URL || !data.YOUTUBE_EGRESS_SHARED_SECRET)) {
    throw new Error('Configuração inválida:\n  - egress do YouTube: configure URL e segredo antes de ativar');
  }
  if (data.YOUTUBE_FALLBACK_ENABLED && (!data.YOUTUBE_FALLBACK_BASE_URL || !data.YOUTUBE_FALLBACK_API_KEY)) {
    throw new Error('Configuração inválida:\n  - fallback do YouTube: configure URL e credencial antes de ativar');
  }
  if (data.IMAGE_GEN_MODE !== 'pollinations' && (!data.CLOUDFLARE_ACCOUNT_ID || !data.CLOUDFLARE_API_TOKEN)) {
    throw new Error('Configuração inválida:\n  - geração de imagem: configure conta e credencial internas antes de ativar Cloudflare');
  }
  if (data.IMAGE_GEN_MODE === 'cloudflare-canary' && data.CLOUDFLARE_IMAGE_CANARY_PERCENT === 0) {
    throw new Error('Configuração inválida:\n  - geração de imagem: o canário precisa de percentual maior que zero');
  }
  let youtubeEgressUrl: string | undefined;
  if (data.YOUTUBE_EGRESS_URL) {
    const parsedUrl = new URL(data.YOUTUBE_EGRESS_URL);
    const isLoopback = ['127.0.0.1', '::1', 'localhost'].includes(parsedUrl.hostname.toLowerCase());
    if (
      (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLoopback))
      || parsedUrl.username
      || parsedUrl.password
      || parsedUrl.search
      || parsedUrl.hash
      || (parsedUrl.pathname !== '' && parsedUrl.pathname !== '/')
    ) {
      throw new Error('Configuração inválida:\n  - egress do YouTube: URL base segura inválida');
    }
    youtubeEgressUrl = parsedUrl.origin;
  }
  let youtubeFallbackBaseUrl: string | undefined;
  let youtubeFallbackMediaHosts: string[] = [];
  if (data.YOUTUBE_FALLBACK_BASE_URL) {
    const parsedUrl = new URL(data.YOUTUBE_FALLBACK_BASE_URL);
    if (
      parsedUrl.protocol !== 'https:'
      || parsedUrl.username
      || parsedUrl.password
      || parsedUrl.search
      || parsedUrl.hash
      || (parsedUrl.pathname !== '' && parsedUrl.pathname !== '/')
    ) {
      throw new Error('Configuração inválida:\n  - fallback do YouTube: URL base segura inválida');
    }
    youtubeFallbackBaseUrl = parsedUrl.origin;
    youtubeFallbackMediaHosts = (data.YOUTUBE_FALLBACK_MEDIA_HOSTS ?? parsedUrl.hostname)
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (
      youtubeFallbackMediaHosts.length === 0
      || youtubeFallbackMediaHosts.length > 16
      || new Set(youtubeFallbackMediaHosts).size !== youtubeFallbackMediaHosts.length
      || youtubeFallbackMediaHosts.some((host) => {
        try {
          const candidate = new URL(`https://${host}`);
          return candidate.hostname !== host || candidate.port !== '' || candidate.pathname !== '/';
        } catch {
          return true;
        }
      })
    ) {
      throw new Error('Configuração inválida:\n  - fallback do YouTube: allowlist de hosts inválida');
    }
  }
  const nvidiaAllowedModels = data.NVIDIA_ALLOWED_MODELS.length > 0
    ? data.NVIDIA_ALLOWED_MODELS
    : data.NVIDIA_MODEL
      ? [data.NVIDIA_MODEL]
      : [];
  if (new Set(nvidiaAllowedModels).size !== nvidiaAllowedModels.length) {
    throw new Error('Configuração inválida:\n  - modelos de IA permitidos: remova entradas duplicadas');
  }
  if (data.NVIDIA_MODEL && !nvidiaAllowedModels.includes(data.NVIDIA_MODEL)) {
    throw new Error('Configuração inválida:\n  - modelos de IA permitidos: inclua o modelo padrão');
  }

  const mediaDir = data.MEDIA_DIR
    ? path.resolve(data.MEDIA_DIR)
    : path.resolve(process.cwd(), 'data', 'tmp');
  const rembgModelDir = path.resolve(data.REMBG_MODEL_DIR);
  const youtubeJsRuntime = data.YOUTUBE_JS_RUNTIME;
  const youtubeJsRuntimePath =
    data.YOUTUBE_JS_RUNTIME_PATH ?? (youtubeJsRuntime === 'deno' ? data.DENO_PATH : youtubeJsRuntime);

  return {
    nodeEnv: data.NODE_ENV,
    isProduction: data.NODE_ENV === 'production',
    host: data.HOST,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    logPretty: data.LOG_PRETTY ?? data.NODE_ENV !== 'production',
    jsonBodyMaxBytes: data.JSON_BODY_MAX_BYTES,

    publicBaseUrl: data.PUBLIC_BASE_URL.replace(/\/+$/, ''),

    apiKeys,
    mediaSigningSecret: data.MEDIA_SIGNING_SECRET,

    mediaDir,
    mediaMaxBytes: data.MEDIA_MAX_BYTES,
    mediaTtlSeconds: data.MEDIA_TTL_SECONDS,
    mediaSweepIntervalMs: data.MEDIA_SWEEP_INTERVAL_MS,

    downloadTimeoutMs: data.DOWNLOAD_TIMEOUT_MS,
    downloadMaxBytes: data.DOWNLOAD_MAX_BYTES,

    ytDlpPath: data.YTDLP_PATH,
    ffmpegPath: data.FFMPEG_PATH,
    denoPath: data.DENO_PATH,
    youtubeJsRuntime,
    youtubeJsRuntimePath,
    youtubeDownloadTimeoutMs: data.YOUTUBE_DOWNLOAD_TIMEOUT_MS,
    youtubeDownloadMaxConcurrency: data.YOUTUBE_DOWNLOAD_MAX_CONCURRENCY,
    youtubeEgressEnabled: data.YOUTUBE_EGRESS_ENABLED ?? false,
    youtubeEgressUrl,
    youtubeEgressSharedSecret: data.YOUTUBE_EGRESS_SHARED_SECRET,
    youtubeFallbackEnabled: data.YOUTUBE_FALLBACK_ENABLED ?? false,
    youtubeFallbackBaseUrl,
    youtubeFallbackApiKey: data.YOUTUBE_FALLBACK_API_KEY,
    youtubeFallbackMediaHosts,
    youtubeFallbackMaxControlBytes: data.YOUTUBE_FALLBACK_MAX_CONTROL_BYTES,

    socialDownloadTimeoutMs: data.SOCIAL_DOWNLOAD_TIMEOUT_MS,
    socialDownloadMaxConcurrency: data.SOCIAL_DOWNLOAD_MAX_CONCURRENCY,

    whisperCliPath: data.WHISPER_CLI_PATH,
    whisperModelPath: path.resolve(data.WHISPER_MODEL_PATH),
    whisperThreads: data.WHISPER_THREADS,
    transcriptionTimeoutMs: data.TRANSCRIPTION_TIMEOUT_MS,
    transcriptionMaxConcurrency: data.TRANSCRIPTION_MAX_CONCURRENCY,
    transcriptionMaxInputBytes: data.TRANSCRIPTION_MAX_INPUT_BYTES,

    rembgPath: data.REMBG_PATH,
    rembgModel: data.REMBG_MODEL,
    rembgModelDir,
    rembgModelPath: path.join(rembgModelDir, `${data.REMBG_MODEL}.onnx`),
    rembgOmpNumThreads: data.REMBG_OMP_NUM_THREADS,
    backgroundRemovalTimeoutMs: data.BACKGROUND_REMOVAL_TIMEOUT_MS,
    imageUpscaleTimeoutMs: data.IMAGE_UPSCALE_TIMEOUT_MS,
    imageProcessMaxConcurrency: data.IMAGE_PROCESS_MAX_CONCURRENCY,
    imageMaxInputPixels: data.IMAGE_MAX_INPUT_PIXELS,
    imageMaxOutputPixels: data.IMAGE_MAX_OUTPUT_PIXELS,
    imageMaxOutputDimension: data.IMAGE_MAX_OUTPUT_DIMENSION,
    imageMaxOutputBytes: data.IMAGE_MAX_OUTPUT_BYTES,

    canvasMaxConcurrency: data.CANVAS_MAX_CONCURRENCY,
    canvasMaxAvatarBytes: data.CANVAS_MAX_AVATAR_BYTES,
    canvasMaxTotalAvatarBytes: data.CANVAS_MAX_TOTAL_AVATAR_BYTES,
    canvasMaxOutputBytes: data.CANVAS_MAX_OUTPUT_BYTES,

    tavernGameMaxConcurrency: data.TAVERN_GAME_MAX_CONCURRENCY,
    tavernGameMaxOutputBytes: data.TAVERN_GAME_MAX_OUTPUT_BYTES,
    tavernGameMaxStateBytes: data.TAVERN_GAME_MAX_STATE_BYTES,
    tavernArtMaxConcurrency: data.TAVERN_ART_MAX_CONCURRENCY,
    tavernArtMaxOutputBytes: data.TAVERN_ART_MAX_OUTPUT_BYTES,

    imageGenMode: data.IMAGE_GEN_MODE,
    pollinationsApiToken: data.POLLINATIONS_API_TOKEN,
    pollinationsImageEnhance: data.POLLINATIONS_IMAGE_ENHANCE,
    cloudflareAccountId: data.CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: data.CLOUDFLARE_API_TOKEN,
    cloudflareImageModel: data.CLOUDFLARE_IMAGE_MODEL,
    cloudflareImageCanaryPercent: data.CLOUDFLARE_IMAGE_CANARY_PERCENT,
    imageGenTimeoutMs: data.IMAGE_GEN_TIMEOUT_MS,
    imageGenMaxConcurrency: data.IMAGE_GEN_MAX_CONCURRENCY,
    imageGenMaxOutputBytes: data.IMAGE_GEN_MAX_OUTPUT_BYTES,

    logoRenderTimeoutMs: data.LOGO_RENDER_TIMEOUT_MS,
    logoMaxConcurrency: data.LOGO_MAX_CONCURRENCY,
    logoMaxOutputBytes: data.LOGO_MAX_OUTPUT_BYTES,

    movieQuizEnabled: data.MOVIE_QUIZ_ENABLED ?? false,
    movieQuizTimeoutMs: data.MOVIE_QUIZ_TIMEOUT_MS,
    movieQuizMaxResponseBytes: data.MOVIE_QUIZ_MAX_RESPONSE_BYTES,
    movieQuizRateWindowMs: data.MOVIE_QUIZ_RATE_WINDOW_MS,

    aiChatEnabled: data.AI_CHAT_ENABLED ?? false,
    nvidiaApiKey: data.NVIDIA_API_KEY,
    nvidiaModel: data.NVIDIA_MODEL,
    nvidiaAllowedModels,
    aiChatTimeoutMs: data.AI_CHAT_TIMEOUT_MS,
    aiChatMaxConcurrency: data.AI_CHAT_MAX_CONCURRENCY,
    aiChatMaxConcurrencyPerConsumer: data.AI_CHAT_MAX_CONCURRENCY_PER_CONSUMER,
    aiChatMaxRequestsPerMinute: data.AI_CHAT_MAX_REQUESTS_PER_MINUTE,
    aiChatMaxRequestsPerMinutePerConsumer: data.AI_CHAT_MAX_REQUESTS_PER_MINUTE_PER_CONSUMER,
    aiChatMaxMessages: data.AI_CHAT_MAX_MESSAGES,
    aiChatMaxMessageChars: data.AI_CHAT_MAX_MESSAGE_CHARS,
    aiChatMaxTotalChars: data.AI_CHAT_MAX_TOTAL_CHARS,
    aiChatMaxOutputTokens: data.AI_CHAT_MAX_OUTPUT_TOKENS,
    aiChatMaxResponseBytes: data.AI_CHAT_MAX_RESPONSE_BYTES,

    shutdownTimeoutMs: data.SHUTDOWN_TIMEOUT_MS,
  };
}
