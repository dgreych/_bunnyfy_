import { Readable } from 'node:stream';

import { AppError } from '../envelope.ts';
import { generateOpaqueId, type TempStorage } from '../storage/tempStorage.ts';
import { assertSafeUrlSyntax, readBodyWithLimit, safeFetch, SsrfBlockedError, type DnsLookup } from '../security/ssrf.ts';

export type ScrapedSocialProvider = 'tiktok' | 'kwai';

export const SOCIAL_PROVIDER_ALLOWED_HOSTS: Record<ScrapedSocialProvider, string[]> = {
  tiktok: ['tiktok.com'],
  kwai: ['kwai.com'],
};

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TIKWM_MAX_RESPONSE_BYTES = 512 * 1024;
const KWAI_PAGE_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface ScrapedMediaInfo {
  mediaUrl: string;
  title: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

export interface SocialScrapeDeps {
  tempStorage: TempStorage;
  timeoutMs: number;
  maxBytes: number;
  /** Injetável em teste, pra validar SSRF sem bater em DNS real. */
  dnsLookup?: DnsLookup;
  /** Injetável em teste, pra buscar sem rede real. */
  fetchImpl?: typeof fetch;
}

export interface SocialDownloadResult {
  mediaId: string;
  mimeType: string;
  sizeBytes: number;
  title: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function fetchJson(
  url: string,
  deps: Pick<SocialScrapeDeps, 'timeoutMs' | 'dnsLookup' | 'fetchImpl'>,
  maxBytes: number,
): Promise<unknown> {
  const response = await safeFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_USER_AGENT },
    timeoutMs: deps.timeoutMs,
    dnsLookup: deps.dnsLookup,
    fetchImpl: deps.fetchImpl,
  });
  if (!response.ok) {
    throw AppError.unavailable('O provedor externo recusou a consulta.');
  }
  const buffer = await readBodyWithLimit(response, maxBytes);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw AppError.unavailable('O provedor externo devolveu uma resposta inesperada.');
  }
}

async function fetchText(
  url: string,
  deps: Pick<SocialScrapeDeps, 'timeoutMs' | 'dnsLookup' | 'fetchImpl'>,
  maxBytes: number,
): Promise<string> {
  const response = await safeFetch(url, {
    method: 'GET',
    headers: { Accept: 'text/html', 'User-Agent': BROWSER_USER_AGENT },
    timeoutMs: deps.timeoutMs,
    dnsLookup: deps.dnsLookup,
    fetchImpl: deps.fetchImpl,
  });
  if (!response.ok) {
    throw AppError.unavailable('O provedor externo recusou a consulta.');
  }
  const buffer = await readBodyWithLimit(response, maxBytes);
  return buffer.toString('utf8');
}

/**
 * O TikTok bloqueia extração direta na maior parte das requisições automatizadas;
 * tikwm.com resolve o post público e devolve a URL de vídeo sem marca d'água já
 * pronta para download, sem que a BunnyFy precise lidar com a defesa anti-bot.
 */
async function resolveTikTokMedia(
  postUrl: string,
  deps: Pick<SocialScrapeDeps, 'timeoutMs' | 'dnsLookup' | 'fetchImpl'>,
): Promise<ScrapedMediaInfo> {
  const apiUrl = new URL('https://www.tikwm.com/api/');
  apiUrl.searchParams.set('url', postUrl);

  const payload = await fetchJson(apiUrl.toString(), deps, TIKWM_MAX_RESPONSE_BYTES);
  if (!isPlainObject(payload) || payload.code !== 0 || !isPlainObject(payload.data)) {
    throw AppError.unavailable('Não foi possível resolver a mídia do TikTok.');
  }

  const data = payload.data;
  const mediaUrl = typeof data.play === 'string' ? data.play : '';
  if (!mediaUrl) {
    throw AppError.unavailable('O TikTok não retornou um vídeo disponível para esse link.');
  }

  const durationRaw = data.duration;
  return {
    mediaUrl,
    title: typeof data.title === 'string' ? data.title : null,
    durationSeconds: typeof durationRaw === 'number' && Number.isFinite(durationRaw) ? durationRaw : null,
    thumbnailUrl: typeof data.cover === 'string' ? data.cover : null,
  };
}

// O estado inicial do Kwai (Nuxt) embute os metadados schema.org/VideoObject
// como um objeto JS serializado sem aspas nas chaves (não é JSON-LD válido
// isolado, então extraímos os campos direto do HTML por regex em vez de
// tentar reconstruir o objeto inteiro).
const KWAI_CONTENT_URL_PATTERN = /contentUrl:"([^"]+)"/;
const KWAI_DURATION_PATTERN = /duration:"(PT[^"]*)"/;
const KWAI_TITLE_PATTERN = /<title>([^<]*)<\/title>/i;
const KWAI_OG_IMAGE_PATTERN = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i;

function parseIsoDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : null;
}

/** Decodifica sequências \uXXXX (ex.: /) de um valor extraído por regex do HTML. */
function decodeUnicodeEscapes(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

/**
 * O Kwai embute os metadados do vídeo (incluindo a URL direta do arquivo em
 * `contentUrl`) no estado inicial da página pública — não requer nenhuma API
 * de terceiro.
 */
async function resolveKwaiMedia(
  postUrl: string,
  deps: Pick<SocialScrapeDeps, 'timeoutMs' | 'dnsLookup' | 'fetchImpl'>,
): Promise<ScrapedMediaInfo> {
  const html = await fetchText(postUrl, deps, KWAI_PAGE_MAX_RESPONSE_BYTES);
  const contentMatch = KWAI_CONTENT_URL_PATTERN.exec(html);
  if (!contentMatch?.[1]) {
    throw AppError.unavailable('Não foi possível localizar os metadados do vídeo do Kwai.');
  }
  const mediaUrl = decodeUnicodeEscapes(contentMatch[1]);

  const durationMatch = KWAI_DURATION_PATTERN.exec(html);
  const titleMatch = KWAI_TITLE_PATTERN.exec(html);
  const imageMatch = KWAI_OG_IMAGE_PATTERN.exec(html);

  return {
    mediaUrl,
    title: titleMatch?.[1] ? decodeUnicodeEscapes(titleMatch[1]).split('|')[0]!.trim() || null : null,
    durationSeconds: durationMatch?.[1] ? parseIsoDurationSeconds(durationMatch[1]) : null,
    thumbnailUrl: imageMatch?.[1] ? decodeUnicodeEscapes(imageMatch[1]) : null,
  };
}

async function downloadMediaToStorage(
  mediaUrl: string,
  deps: SocialScrapeDeps,
  hint: Pick<ScrapedMediaInfo, 'title' | 'durationSeconds' | 'thumbnailUrl'>,
): Promise<SocialDownloadResult> {
  let response;
  try {
    response = await safeFetch(mediaUrl, {
      method: 'GET',
      headers: { Accept: 'video/*,application/octet-stream', 'User-Agent': BROWSER_USER_AGENT },
      timeoutMs: deps.timeoutMs,
      dnsLookup: deps.dnsLookup,
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw AppError.blockedUrl(error.message);
    throw error;
  }
  if (!response.ok || !response.body) {
    throw AppError.unavailable('Não foi possível baixar o vídeo resolvido.');
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > deps.maxBytes) {
    await response.body.cancel('content-length-exceeded').catch(() => undefined);
    throw AppError.payloadTooLarge('Vídeo excede o limite permitido.');
  }

  const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'video/mp4';
  const source = Readable.fromWeb(response.body as never);
  const entry = await deps.tempStorage.put(source, {
    mimeType,
    originalName: hint.title ? `${hint.title}.mp4` : `${generateOpaqueId()}.mp4`,
  });

  return {
    mediaId: entry.id,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    title: hint.title,
    durationSeconds: hint.durationSeconds,
    thumbnailUrl: hint.thumbnailUrl,
  };
}

/**
 * Resolve e baixa mídia de um post público de TikTok ou Kwai. A URL de
 * entrada é restrita à allowlist do provedor (evita que a rota vire proxy
 * genérico); a URL de mídia final vem de uma resposta já validada (API do
 * tikwm.com ou JSON-LD da própria página) e só passa pela política de SSRF
 * padrão, sem allowlist de host — hosts de CDN variam por requisição.
 */
export async function downloadScrapedSocialMedia(
  provider: ScrapedSocialProvider,
  postUrl: string,
  deps: SocialScrapeDeps,
): Promise<SocialDownloadResult> {
  try {
    assertSafeUrlSyntax(postUrl, {
      allowedProtocols: ['https:'],
      allowedHosts: SOCIAL_PROVIDER_ALLOWED_HOSTS[provider],
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw AppError.blockedUrl(error.message);
    throw error;
  }

  const info = provider === 'tiktok'
    ? await resolveTikTokMedia(postUrl, deps)
    : await resolveKwaiMedia(postUrl, deps);

  return downloadMediaToStorage(info.mediaUrl, deps, info);
}
