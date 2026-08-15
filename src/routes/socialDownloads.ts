import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { envelopeMeta } from '../context.ts';
import { AppError, okEnvelope } from '../envelope.ts';
import type { ConcurrencyLimiter } from '../lib/concurrencyLimiter.ts';
import {
  downloadScrapedSocialMedia,
  SOCIAL_PROVIDER_ALLOWED_HOSTS,
  type ScrapedSocialProvider,
  type SocialDownloadResult,
  type SocialScrapeDeps,
} from '../lib/socialDownload.ts';
import {
  downloadYtDlpVideo,
  YTDLP_PROVIDER_ALLOWED_HOSTS,
  type YtDlpVideoDownloadDeps,
  type YtDlpVideoDownloadResult,
  type YtDlpVideoProvider,
} from '../lib/ytdlpVideoDownload.ts';
import { requireBearerAuth, type ApiKeyAuthSource } from '../plugins/auth.ts';
import { assertSafeUrlSyntax, resolveAndAssertSafeHost, SsrfBlockedError, type DnsLookup } from '../security/ssrf.ts';
import { buildMediaDescriptor, type MediaRouteDeps } from './media.ts';

const requestBodySchema = z.object({
  url: z.string().trim().min(1).max(2_048),
}).strict();

interface SharedRouteDeps extends Pick<MediaRouteDeps, 'publicBaseUrl' | 'mediaSigningSecret' | 'mediaTtlSeconds'> {
  apiKeys: ApiKeyAuthSource;
  limiter: ConcurrencyLimiter;
  /** Injetável em teste, pra validar SSRF sem bater em DNS real. */
  dnsLookup?: DnsLookup;
}

export interface SocialDownloadRouteDeps extends SharedRouteDeps, YtDlpVideoDownloadDeps, SocialScrapeDeps {
  downloadYtDlp?: (url: string, deps: YtDlpVideoDownloadDeps) => Promise<YtDlpVideoDownloadResult>;
  downloadScraped?: (
    provider: ScrapedSocialProvider,
    url: string,
    deps: SocialScrapeDeps,
  ) => Promise<SocialDownloadResult>;
}

async function validatePublicHttpsUrl(
  rawUrl: string,
  allowedHosts: string[],
  dnsLookup: DnsLookup | undefined,
): Promise<string> {
  let parsed;
  try {
    parsed = assertSafeUrlSyntax(rawUrl, { allowedProtocols: ['https:'], allowedHosts });
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw AppError.blockedUrl(error.message);
    throw error;
  }
  try {
    await resolveAndAssertSafeHost(parsed.hostname, dnsLookup);
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw AppError.blockedUrl(error.message);
    throw error;
  }
  return parsed.toString();
}

function registerRoute(
  app: FastifyInstance,
  routePath: string,
  deps: SocialDownloadRouteDeps,
  allowedHosts: string[],
  run: (url: string) => Promise<{ title: string | null; durationSeconds: number | null; thumbnail: string | null; mediaId: string; mimeType: string; sizeBytes: number }>,
): void {
  app.post(routePath, { preHandler: requireBearerAuth(deps.apiKeys, 'downloads:write') }, async (request) => {
    const parsedBody = requestBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      throw AppError.badRequest('Corpo inválido: informe "url".', parsedBody.error.issues);
    }

    const url = await validatePublicHttpsUrl(parsedBody.data.url, allowedHosts, deps.dnsLookup);

    if (!deps.limiter.tryAcquire()) {
      throw AppError.tooManyRequests('Limite de downloads simultâneos atingido, tente novamente em instantes.');
    }

    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(url);
    } finally {
      deps.limiter.release();
    }

    const media = buildMediaDescriptor(
      deps,
      { id: result.mediaId, mimeType: result.mimeType, sizeBytes: result.sizeBytes },
      deps.mediaTtlSeconds,
    );

    return okEnvelope(
      {
        title: result.title,
        durationSeconds: result.durationSeconds,
        thumbnail: result.thumbnail,
        media,
      },
      envelopeMeta(request),
    );
  });
}

export function registerSocialDownloadRoutes(app: FastifyInstance, deps: SocialDownloadRouteDeps): void {
  const runYtDlp = deps.downloadYtDlp ?? downloadYtDlpVideo;
  const runScraped = deps.downloadScraped ?? downloadScrapedSocialMedia;

  const ytDlpRoutes: Array<[string, YtDlpVideoProvider]> = [
    ['/v1/downloads/facebook', 'facebook'],
    ['/v1/downloads/pinterest', 'pinterest'],
  ];
  for (const [routePath, provider] of ytDlpRoutes) {
    registerRoute(app, routePath, deps, YTDLP_PROVIDER_ALLOWED_HOSTS[provider], async (url) => {
      const result = await runYtDlp(url, deps);
      return {
        title: result.title,
        durationSeconds: result.durationSeconds,
        thumbnail: result.thumbnailUrl,
        mediaId: result.mediaId,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
      };
    });
  }

  const scrapedRoutes: Array<[string, ScrapedSocialProvider]> = [
    ['/v1/downloads/tiktok', 'tiktok'],
    ['/v1/downloads/kwai', 'kwai'],
  ];
  for (const [routePath, provider] of scrapedRoutes) {
    registerRoute(app, routePath, deps, SOCIAL_PROVIDER_ALLOWED_HOSTS[provider], async (url) => {
      const result = await runScraped(provider, url, deps);
      return {
        title: result.title,
        durationSeconds: result.durationSeconds,
        thumbnail: result.thumbnailUrl,
        mediaId: result.mediaId,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
      };
    });
  }
}
