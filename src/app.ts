import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';

import type { AppConfig } from './config.ts';
import { envelopeMeta } from './context.ts';
import { AppError, errEnvelope } from './envelope.ts';
import type { AppLogger } from './logger.ts';
import { buildLogger } from './logger.ts';
import type { BackgroundRemovalDeps, ImageInfo } from './lib/backgroundRemoval.ts';
import type { AiChatControls, AiChatDeps, AiChatMessage, AiChatResult } from './lib/aiChat.ts';
import type { ImageModerationDeps, ImageModerationResult } from './lib/imageModeration.ts';
import { createImageGenerator, type ImageGenerator } from './lib/imageGeneration.ts';
import { ConcurrencyLimiter } from './lib/concurrencyLimiter.ts';
import type { UpscaleDeps, UpscaleScale } from './lib/imageUpscale.ts';
import type { LogoStickerResult } from './lib/logoStickerRenderer.ts';
import type { StickerLogoInput } from './lib/logoStickerVisualAll.ts';
import type { MovieQuizDeps, MovieQuizDifficulty, MovieQuizResult } from './lib/movieQuiz.ts';
import { KeyedConcurrencyLimiter, KeyedSlidingWindowRateLimiter } from './lib/keyedLimiters.ts';
import type { TranscriptionDeps, TranscriptionResult } from './lib/transcription.ts';
import { SlidingWindowRateLimiter } from './lib/slidingWindowRateLimiter.ts';
import type {
  YoutubeDownloadDeps,
  YoutubeDownloadInput,
  YoutubeDownloadResult,
  YoutubeKind,
  YoutubeQuality,
} from './lib/youtube.ts';
import { downloadYoutubeMedia } from './lib/youtube.ts';
import { downloadYoutubeMediaViaEgress } from './lib/youtubeEgress.ts';
import { downloadYoutubeMediaWithFallback } from './lib/youtubeFallback.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerImageGenerateRoutes } from './routes/imageGenerate.ts';
import { registerImageProcessingRoutes } from './routes/images.ts';
import { registerLogoRoute } from './routes/logos.ts';
import { registerMediaRoutes } from './routes/media.ts';
import type {
  ScrapedSocialProvider,
  SocialDownloadResult,
  SocialScrapeDeps,
} from './lib/socialDownload.ts';
import type {
  YtDlpVideoDownloadDeps,
  YtDlpVideoDownloadResult,
} from './lib/ytdlpVideoDownload.ts';
import { registerMovieQuizRoute } from './routes/movieQuiz.ts';
import { registerSocialCanvasRoutes } from './routes/socialCanvas.ts';
import { registerSocialDownloadRoutes } from './routes/socialDownloads.ts';
import { registerTavernArtRoutes } from './routes/tavernArt.ts';
import { registerTavernGameRoutes } from './routes/tavernGame.ts';
import { registerTranscriptionRoutes } from './routes/transcriptions.ts';
import { registerYoutubeRoutes } from './routes/youtube.ts';
import type { DnsLookup } from './security/ssrf.ts';
import { TempStorage } from './storage/tempStorage.ts';
import { registerAiChatRoutes } from './routes/ai.ts';

export interface BuildAppOptions {
  config: AppConfig;
  logger?: AppLogger;
  /** Injetável em teste, pra não escrever em `data/tmp` do projeto real. */
  tempStorage?: TempStorage;
  /** Injetável em teste, pra não chamar yt-dlp/rede real. */
  youtubeDownload?: (
    kind: YoutubeKind,
    input: YoutubeDownloadInput,
    quality: YoutubeQuality | undefined,
    deps: YoutubeDownloadDeps,
  ) => Promise<YoutubeDownloadResult>;
  /** Injetável em teste, pra não chamar o worker de egress real. */
  youtubeEgressFetch?: typeof fetch;
  /** Injetável em teste, pra não chamar o fallback temporário real. */
  youtubeFallbackFetch?: typeof fetch;
  /** Injetável em teste, pra não chamar whisper-cli/ffmpeg reais. */
  transcribe?: (
    inputPath: string,
    opts: { language?: string },
    deps: TranscriptionDeps,
  ) => Promise<TranscriptionResult>;
  /** Injetável em teste, pra não chamar rembg/modelo real. */
  removeBackground?: (inputPath: string, outputPath: string, deps: BackgroundRemovalDeps) => Promise<void>;
  /** Injetável em teste para isolar a rota do processamento Sharp. */
  upscaleImage?: (
    inputPath: string,
    outputPath: string,
    source: ImageInfo,
    scale: UpscaleScale,
    deps: UpscaleDeps,
  ) => Promise<void>;
  /** Injetável em teste, pra validar SSRF sem bater em DNS real. */
  dnsLookup?: DnsLookup;
  /** Injetável em teste, pra buscar URL de transcrição sem rede real. */
  fetchImpl?: typeof fetch;
  /** Injetável em teste, pra não chamar o provedor de IA real. */
  aiChat?: (
    messages: readonly AiChatMessage[],
    controls: AiChatControls,
    deps: AiChatDeps,
  ) => Promise<AiChatResult>;
  /** Injetável em teste, pra não chamar o classificador de conteúdo real. */
  assessImagePromptSafety?: (prompt: string, deps: ImageModerationDeps) => Promise<ImageModerationResult>;
  /** Injetável em teste, pra não chamar nenhum adaptador de imagem real. */
  generateImage?: ImageGenerator;
  /** Transporte isolado dos adaptadores de imagem. */
  imageGenerationFetch?: typeof fetch;
  /** Injetável em teste, pra não chamar a fonte externa de quiz. */
  movieQuiz?: (
    difficulty: MovieQuizDifficulty | undefined,
    deps: MovieQuizDeps,
  ) => Promise<MovieQuizResult>;
  /** Injetável em teste para não executar Sharp/ffmpeg reais. */
  renderLogoSticker?: (input: StickerLogoInput) => Promise<LogoStickerResult>;
  /** Injetável em teste, pra não chamar yt-dlp real (Facebook/Pinterest). */
  downloadYtDlpVideo?: (url: string, deps: YtDlpVideoDownloadDeps) => Promise<YtDlpVideoDownloadResult>;
  /** Injetável em teste, pra não chamar tikwm.com/Kwai reais (TikTok/Kwai). */
  downloadScrapedSocialMedia?: (
    provider: ScrapedSocialProvider,
    url: string,
    deps: SocialScrapeDeps,
  ) => Promise<SocialDownloadResult>;
}

export interface BuiltApp {
  app: FastifyInstance;
  tempStorage: TempStorage;
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const { config } = options;
  const logger: FastifyBaseLogger = options.logger ?? buildLogger(config);

  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    bodyLimit: config.jsonBodyMaxBytes,
    trustProxy: true,
  });

  app.decorateRequest('startTimeNs');
  app.addHook('onRequest', (request, _reply, done) => {
    request.startTimeNs = process.hrtime.bigint();
    done();
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', String(request.id));
    return payload;
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404);
    return errEnvelope({ code: 'BUNNYFY_NOT_FOUND', message: 'Rota não encontrada.', retryable: false }, envelopeMeta(request));
  });

  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code, internalDetails: error.internalDetails }, error.message);
      } else {
        request.log.warn({ code: error.code }, error.message);
      }
      reply.code(error.statusCode);
      return errEnvelope(error.toPayload(), envelopeMeta(request));
    }

    if (error.validation) {
      reply.code(400);
      return errEnvelope({ code: 'BUNNYFY_BAD_REQUEST', message: 'Requisição inválida.', retryable: false }, envelopeMeta(request));
    }

    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'erro não tratado');
    } else {
      request.log.warn({ err: error }, 'erro de requisição');
    }

    reply.code(statusCode);
    return errEnvelope(
      {
        code: statusCode === 413 ? 'BUNNYFY_TOO_LARGE' : statusCode === 429 ? 'BUNNYFY_RATE_LIMITED' : 'BUNNYFY_INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Erro interno inesperado.' : error.message,
        retryable: statusCode >= 500 || statusCode === 429,
      }, envelopeMeta(request),
    );
  });

  await app.register(multipart, {
    limits: { fileSize: config.mediaMaxBytes, files: 1 },
  });

  const tempStorage =
    options.tempStorage ??
    new TempStorage({
      dir: config.mediaDir,
      ttlMs: config.mediaTtlSeconds * 1000,
      maxBytes: config.mediaMaxBytes,
      sweepIntervalMs: config.mediaSweepIntervalMs,
    });
  await tempStorage.init();
  tempStorage.startSweeper();

  const generateImage = options.generateImage ?? createImageGenerator({
    mode: config.imageGenMode,
    timeoutMs: config.imageGenTimeoutMs,
    maxOutputBytes: Math.max(config.imageGenMaxOutputBytes, config.tavernArtMaxOutputBytes),
    canaryPercent: config.cloudflareImageCanaryPercent,
    pollinationsApiToken: config.pollinationsApiToken,
    pollinationsEnhance: config.pollinationsImageEnhance,
    cloudflareAccountId: config.cloudflareAccountId,
    cloudflareApiToken: config.cloudflareApiToken,
    cloudflareModel: config.cloudflareImageModel,
    fetchImpl: options.imageGenerationFetch,
  });

  app.addHook('onClose', async () => {
    await tempStorage.close();
  });

  registerHealthRoutes(app, {
    mediaDir: config.mediaDir,
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
    denoPath: config.denoPath,
    youtubeJsRuntime: config.youtubeJsRuntime,
    youtubeJsRuntimePath: config.youtubeJsRuntimePath,
    whisperCliPath: config.whisperCliPath,
    whisperModelPath: config.whisperModelPath,
    rembgPath: config.rembgPath,
    rembgModelPath: config.rembgModelPath,
    aiChatAvailable: config.aiChatEnabled && Boolean(config.nvidiaApiKey) && Boolean(config.nvidiaModel),
    movieQuizAvailable: config.movieQuizEnabled,
    youtubeEgressAvailable: config.youtubeEgressEnabled,
    youtubeFallbackAvailable: config.youtubeFallbackEnabled,
  });

  registerMediaRoutes(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaSigningSecret: config.mediaSigningSecret,
    publicBaseUrl: config.publicBaseUrl,
    mediaTtlSeconds: config.mediaTtlSeconds,
  });

  registerImageProcessingRoutes(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    limiter: new ConcurrencyLimiter(config.imageProcessMaxConcurrency),
    maxInputPixels: config.imageMaxInputPixels,
    maxOutputPixels: config.imageMaxOutputPixels,
    maxOutputDimension: config.imageMaxOutputDimension,
    maxOutputBytes: config.imageMaxOutputBytes,
    upscaleTimeoutMs: config.imageUpscaleTimeoutMs,
    rembgPath: config.rembgPath,
    model: config.rembgModel,
    modelDir: config.rembgModelDir,
    timeoutMs: config.backgroundRemovalTimeoutMs,
    ompNumThreads: config.rembgOmpNumThreads,
    removeBackground: options.removeBackground,
    upscaleImage: options.upscaleImage,
  });

  registerSocialCanvasRoutes(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    limiter: new ConcurrencyLimiter(config.canvasMaxConcurrency),
    maxAvatarBytes: config.canvasMaxAvatarBytes,
    maxTotalAvatarBytes: config.canvasMaxTotalAvatarBytes,
    maxOutputBytes: config.canvasMaxOutputBytes,
  });

  registerTavernGameRoutes(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    limiter: new ConcurrencyLimiter(config.tavernGameMaxConcurrency),
    maxOutputBytes: config.tavernGameMaxOutputBytes,
    maxStateBytes: config.tavernGameMaxStateBytes,
  });

  registerTavernArtRoutes(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    limiter: new ConcurrencyLimiter(config.tavernArtMaxConcurrency),
    maxOutputBytes: config.tavernArtMaxOutputBytes,
    generateImage,
  });

  registerImageGenerateRoutes(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    limiter: new ConcurrencyLimiter(config.imageGenMaxConcurrency),
    maxOutputBytes: config.imageGenMaxOutputBytes,
    generateImage,
    moderation: {
      apiKey: config.nvidiaApiKey,
      model: config.nvidiaModel,
      timeoutMs: config.aiChatTimeoutMs,
      maxResponseBytes: config.aiChatMaxResponseBytes,
      fetchImpl: options.fetchImpl,
    },
    assessSafety: options.assessImagePromptSafety,
  });

  registerLogoRoute(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    limiter: new ConcurrencyLimiter(config.logoMaxConcurrency),
    ffmpegPath: config.ffmpegPath,
    timeoutMs: config.logoRenderTimeoutMs,
    maxOutputBytes: config.logoMaxOutputBytes,
    render: options.renderLogoSticker,
  });

  registerMovieQuizRoute(app, {
    enabled: config.movieQuizEnabled,
    apiKeys: config.apiKeys,
    limiter: new ConcurrencyLimiter(1),
    rateLimiter: new SlidingWindowRateLimiter(1, config.movieQuizRateWindowMs),
    timeoutMs: config.movieQuizTimeoutMs,
    maxResponseBytes: config.movieQuizMaxResponseBytes,
    requestQuiz: options.movieQuiz,
  });

  const primaryYoutubeDownload = (
    config.youtubeEgressEnabled && config.youtubeEgressUrl && config.youtubeEgressSharedSecret
      ? (kind: YoutubeKind, input: YoutubeDownloadInput, quality: YoutubeQuality | undefined, deps: YoutubeDownloadDeps) =>
          kind === 'audio'
            ? downloadYoutubeMediaViaEgress(kind, input, quality, {
                ...deps,
                workerUrl: config.youtubeEgressUrl!,
                workerToken: config.youtubeEgressSharedSecret!,
                fetchImpl: options.youtubeEgressFetch,
              })
            : downloadYoutubeMedia(kind, input, quality, deps)
      : downloadYoutubeMedia
  );
  const configuredYoutubeDownload = options.youtubeDownload ?? (
    config.youtubeFallbackEnabled && config.youtubeFallbackBaseUrl && config.youtubeFallbackApiKey
      ? (kind: YoutubeKind, input: YoutubeDownloadInput, quality: YoutubeQuality | undefined, deps: YoutubeDownloadDeps) =>
          downloadYoutubeMediaWithFallback(primaryYoutubeDownload, kind, input, quality, {
            ...deps,
            fallbackBaseUrl: config.youtubeFallbackBaseUrl!,
            fallbackApiKey: config.youtubeFallbackApiKey!,
            fallbackMediaHosts: config.youtubeFallbackMediaHosts,
            fallbackMaxControlBytes: config.youtubeFallbackMaxControlBytes,
            dnsLookup: options.dnsLookup,
            fetchImpl: options.youtubeFallbackFetch,
          })
      : config.youtubeEgressEnabled
        ? primaryYoutubeDownload
        : undefined
  );

  registerYoutubeRoutes(app, {
    tempStorage,
    mediaDir: config.mediaDir,
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
    denoPath: config.denoPath,
    jsRuntime: config.youtubeJsRuntime,
    jsRuntimePath: config.youtubeJsRuntimePath,
    timeoutMs: config.youtubeDownloadTimeoutMs,
    maxBytes: config.downloadMaxBytes,
    limiter: new ConcurrencyLimiter(config.youtubeDownloadMaxConcurrency),
    apiKeys: config.apiKeys,
    publicBaseUrl: config.publicBaseUrl,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    download: configuredYoutubeDownload,
    dnsLookup: options.dnsLookup,
  });

  registerSocialDownloadRoutes(app, {
    tempStorage,
    mediaDir: config.mediaDir,
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
    denoPath: config.denoPath,
    jsRuntime: config.youtubeJsRuntime,
    jsRuntimePath: config.youtubeJsRuntimePath,
    timeoutMs: config.socialDownloadTimeoutMs,
    maxBytes: config.downloadMaxBytes,
    limiter: new ConcurrencyLimiter(config.socialDownloadMaxConcurrency),
    apiKeys: config.apiKeys,
    publicBaseUrl: config.publicBaseUrl,
    mediaSigningSecret: config.mediaSigningSecret,
    mediaTtlSeconds: config.mediaTtlSeconds,
    dnsLookup: options.dnsLookup,
    fetchImpl: options.fetchImpl,
    downloadYtDlp: options.downloadYtDlpVideo,
    downloadScraped: options.downloadScrapedSocialMedia,
  });

  registerTranscriptionRoutes(app, {
    tempStorage,
    apiKeys: config.apiKeys,
    mediaDir: config.mediaDir,
    limiter: new ConcurrencyLimiter(config.transcriptionMaxConcurrency),
    downloadTimeoutMs: config.downloadTimeoutMs,
    transcriptionMaxInputBytes: config.transcriptionMaxInputBytes,
    whisperCliPath: config.whisperCliPath,
    whisperModelPath: config.whisperModelPath,
    whisperThreads: config.whisperThreads,
    ffmpegPath: config.ffmpegPath,
    transcriptionTimeoutMs: config.transcriptionTimeoutMs,
    dnsLookup: options.dnsLookup,
    fetchImpl: options.fetchImpl,
    transcribe: options.transcribe,
  });

  registerAiChatRoutes(app, {
    enabled: config.aiChatEnabled,
    apiKeys: config.apiKeys,
    limiter: new ConcurrencyLimiter(config.aiChatMaxConcurrency),
    rateLimiter: new SlidingWindowRateLimiter(config.aiChatMaxRequestsPerMinute, 60_000),
    consumerLimiter: new KeyedConcurrencyLimiter(config.aiChatMaxConcurrencyPerConsumer),
    consumerRateLimiter: new KeyedSlidingWindowRateLimiter(
      config.aiChatMaxRequestsPerMinutePerConsumer,
      60_000,
    ),
    apiKey: config.nvidiaApiKey,
    model: config.nvidiaModel,
    allowedModels: config.nvidiaAllowedModels,
    timeoutMs: config.aiChatTimeoutMs,
    maxResponseBytes: config.aiChatMaxResponseBytes,
    maxMessages: config.aiChatMaxMessages,
    maxMessageChars: config.aiChatMaxMessageChars,
    maxTotalChars: config.aiChatMaxTotalChars,
    maxOutputTokens: config.aiChatMaxOutputTokens,
    fetchImpl: options.fetchImpl,
    requestChat: options.aiChat,
  });

  return { app, tempStorage };
}
