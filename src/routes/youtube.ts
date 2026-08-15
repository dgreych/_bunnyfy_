import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import {
  downloadYoutubeMedia,
  isYoutubeQueryTextValid,
  YOUTUBE_ALLOWED_HOSTS,
  YOUTUBE_AUDIO_QUALITIES,
  YOUTUBE_QUERY_MAX_CHARS,
  YOUTUBE_VIDEO_QUALITIES,
  type YoutubeDownloadDeps,
  type YoutubeDownloadInput,
  type YoutubeDownloadResult,
  type YoutubeKind,
  type YoutubeQuality,
} from '../lib/youtube.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import { assertSafeUrlSyntax, resolveAndAssertSafeHost, SsrfBlockedError, type DnsLookup } from '../security/ssrf.ts';
import { buildMediaDescriptor, type MediaRouteDeps } from './media.ts';

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const EXACT_YOUTUBE_HOSTS = new Set([...YOUTUBE_ALLOWED_HOSTS, 'www.youtube.com']);

function buildRequestBodySchema(kind: YoutubeKind) {
  return z.object({
    url: z.string().trim().min(1).max(2_048).optional(),
    query: z
      .string()
      .trim()
      .min(1)
      .max(YOUTUBE_QUERY_MAX_CHARS)
      .refine(isYoutubeQueryTextValid, 'query inválida')
      .optional(),
    quality: (kind === 'audio' ? z.enum(YOUTUBE_AUDIO_QUALITIES) : z.enum(YOUTUBE_VIDEO_QUALITIES)).optional(),
  }).strict().superRefine((body, context) => {
    if ((body.url === undefined) === (body.query === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'informe exatamente um entre url e query',
        path: ['url'],
      });
    }
  });
}

export interface YoutubeRouteDeps extends YoutubeDownloadDeps, Pick<MediaRouteDeps, 'publicBaseUrl' | 'mediaSigningSecret' | 'mediaTtlSeconds'> {
  apiKeys: ApiKeyAuthSource;
  limiter: ConcurrencyLimiter;
  download?: (
    kind: YoutubeKind,
    input: YoutubeDownloadInput,
    quality: YoutubeQuality | undefined,
    deps: YoutubeDownloadDeps,
  ) => Promise<YoutubeDownloadResult>;
  /** Injetável em teste, pra validar SSRF sem bater em DNS real. */
  dnsLookup?: DnsLookup;
}

function extractYoutubeVideoId(url: URL): string | null {
  const hostname = url.hostname.toLowerCase();
  if (!EXACT_YOUTUBE_HOSTS.has(hostname) || url.port) return null;

  if (hostname === 'youtu.be') {
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length === 1 ? segments[0]! : null;
  }

  if (url.pathname === '/watch') return url.searchParams.get('v');

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 2 && ['shorts', 'live', 'embed'].includes(segments[0]!)) {
    return segments[1]!;
  }
  return null;
}

async function validateYoutubeUrl(rawUrl: string, dnsLookup?: DnsLookup): Promise<string> {
  let parsed;
  try {
    parsed = assertSafeUrlSyntax(rawUrl, {
      allowedProtocols: ['https:'],
      allowedHosts: [...EXACT_YOUTUBE_HOSTS],
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw AppError.blockedUrl(error.message);
    }
    throw error;
  }

  const videoId = extractYoutubeVideoId(parsed);
  if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw AppError.blockedUrl('URL do YouTube não identifica um vídeo canônico permitido.');
  }

  const canonicalUrl = new URL('https://www.youtube.com/watch');
  canonicalUrl.searchParams.set('v', videoId);

  try {
    await resolveAndAssertSafeHost(canonicalUrl.hostname, dnsLookup);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw AppError.blockedUrl(error.message);
    }
    throw error;
  }
  return canonicalUrl.toString();
}

function registerYoutubeRoute(app: FastifyInstance, routePath: string, kind: YoutubeKind, deps: YoutubeRouteDeps): void {
  const requestBodySchema = buildRequestBodySchema(kind);
  app.post(routePath, { preHandler: requireBearerAuth(deps.apiKeys, 'downloads:write') }, async (request) => {
    const parsedBody = requestBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      throw AppError.badRequest(
        'Corpo inválido: informe exatamente um entre "url" e "query".',
        parsedBody.error.issues,
      );
    }

    let input: YoutubeDownloadInput = parsedBody.data.url !== undefined
      ? { type: 'url', value: parsedBody.data.url }
      : { type: 'query', value: parsedBody.data.query! };

    if (input.type === 'url') {
      input = { type: 'url', value: await validateYoutubeUrl(input.value, deps.dnsLookup) };
    }

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Limite de downloads simultâneos atingido, tente novamente em instantes.');
    }

    const download = deps.download ?? downloadYoutubeMedia;
    let result: YoutubeDownloadResult;
    try {
      result = await download(kind, input, parsedBody.data.quality, deps);
    } finally {
      deps.limiter.release();
    }

    const media = buildMediaDescriptor(
      deps,
      { id: result.mediaId, mimeType: result.mimeType, sizeBytes: result.sizeBytes },
      deps.mediaTtlSeconds,
    );

    // Formato alinhado a docs/GYOMEI_COMPATIBILITY.md — o cliente Gyomei lê
    // `media.mediaUrl` pra baixar e preserva title/durationSeconds/thumbnail/quality
    // pros comandos play, ytmp3, playvid, ytmp4 e AutoDL.
    return okEnvelope(
      {
        title: result.title,
        durationSeconds: result.durationSeconds,
        thumbnail: result.thumbnailUrl,
        quality: parsedBody.data.quality ?? null,
        media,
      },
      envelopeMeta(request),
    );
  });
}

export function registerYoutubeRoutes(app: FastifyInstance, deps: YoutubeRouteDeps): void {
  registerYoutubeRoute(app, '/v1/downloads/youtube/audio', 'audio', deps);
  registerYoutubeRoute(app, '/v1/downloads/youtube/video', 'video', deps);
}
