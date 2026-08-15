import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

import ipaddr from 'ipaddr.js';

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export class SafeFetchTimeoutError extends Error {
  constructor(message = 'Requisição externa excedeu o tempo limite.') {
    super(message);
    this.name = 'SafeFetchTimeoutError';
  }
}

export interface UrlPolicy {
  allowedProtocols?: string[];
  allowedHosts?: string[];
}

const DEFAULT_PROTOCOLS = ['http:', 'https:'];

function hostMatchesAllowlist(hostname: string, allowedHosts: string[]): boolean {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    const allowedLower = allowed.toLowerCase();
    return normalized === allowedLower || normalized.endsWith(`.${allowedLower}`);
  });
}

export function assertSafeUrlSyntax(rawUrl: string, policy: UrlPolicy = {}): URL {
  const allowedProtocols = policy.allowedProtocols ?? DEFAULT_PROTOCOLS;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('URL malformada.');
  }

  if (!allowedProtocols.includes(url.protocol)) {
    throw new SsrfBlockedError(`Protocolo "${url.protocol}" não permitido.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new SsrfBlockedError('URL com credencial embutida não é permitida.');
  }
  if (!url.hostname) {
    throw new SsrfBlockedError('URL sem host.');
  }
  if (policy.allowedHosts && !hostMatchesAllowlist(url.hostname, policy.allowedHosts)) {
    throw new SsrfBlockedError(`Host "${url.hostname}" fora da allowlist permitida.`);
  }

  return url;
}

const BLOCKED_RANGES = new Set([
  'unspecified',
  'broadcast',
  'multicast',
  'linkLocal',
  'loopback',
  'carrierGradeNat',
  'private',
  'reserved',
  'uniqueLocal',
  'rfc6145',
  'rfc6052',
  '6to4',
  'teredo',
]);

function isPublicUnicastAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return !BLOCKED_RANGES.has(parsed.range());
}

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultDnsLookup: DnsLookup = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

export async function resolveAndAssertSafeHost(
  hostname: string,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<string[]> {
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname);
  } catch {
    throw new SsrfBlockedError(`Não foi possível resolver o host "${hostname}".`);
  }

  if (records.length === 0) {
    throw new SsrfBlockedError(`Host "${hostname}" não resolveu para nenhum endereço.`);
  }

  const addresses = records.map((record) => record.address);
  if (addresses.some((address) => !isPublicUnicastAddress(address))) {
    throw new SsrfBlockedError(`Host "${hostname}" resolve para endereço não roteável publicamente.`);
  }

  return addresses;
}

type StreamReadResult = {
  done: boolean;
  value?: Uint8Array;
};

export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const body = response.body as ReadableStream<Uint8Array>;
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const result = (await reader.read()) as StreamReadResult;
      if (result.done) break;
      const value = result.value;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('max-bytes-exceeded').catch(() => undefined);
        throw new SsrfBlockedError(`Resposta excede o limite de ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RESPONSE_WITHOUT_BODY = new Set([204, 205, 304]);

export interface SafeRequestInit {
  method: string;
  headers?: Record<string, string>;
  timeoutMs: number;
}

export type SafeRequestImpl = (
  url: URL,
  validatedAddress: string,
  init: SafeRequestInit,
) => Promise<Response>;

function responseHeaders(headers: http.IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else {
      result.set(name, value);
    }
  }
  return result;
}

/**
 * Transporte padrão: mantém o hostname original no request/TLS, mas substitui
 * a resolução DNS por um endereço já validado. `agent: false` impede que uma
 * conexão antiga seja reutilizada entre validações independentes.
 */
export function requestPinnedAddress(
  url: URL,
  validatedAddress: string,
  init: SafeRequestInit,
): Promise<Response> {
  const family = isIP(validatedAddress);
  if (family !== 4 && family !== 6) {
    return Promise.reject(new SsrfBlockedError('Endereço validado possui família IP inválida.'));
  }

  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const requestOptions: http.RequestOptions & https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers: init.headers,
      agent: false,
      lookup: createPinnedLookup(validatedAddress),
    };

    if (url.protocol === 'https:') {
      requestOptions.servername = url.hostname;
    }

    const request = transport.request(requestOptions, (incoming) => {
      const status = incoming.statusCode ?? 500;
      const headers = responseHeaders(incoming.headers);

      if (RESPONSE_WITHOUT_BODY.has(status)) {
        incoming.resume();
        resolve(new Response(null, { status, statusText: incoming.statusMessage, headers }));
        return;
      }

      const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(body, { status, statusText: incoming.statusMessage, headers }));
    });

    request.setTimeout(init.timeoutMs, () => {
      request.destroy(new SafeFetchTimeoutError());
    });
    request.once('error', reject);
    request.end();
  });
}

/** Mantém o IP validado nos formatos unitário e `all` usados pelo Node 24. */
export function createPinnedLookup(validatedAddress: string): LookupFunction {
  const family = isIP(validatedAddress);
  if (family !== 4 && family !== 6) {
    throw new SsrfBlockedError('Endereço validado possui família IP inválida.');
  }
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: validatedAddress, family }]);
      return;
    }
    callback(null, validatedAddress, family);
  };
}

export interface SafeFetchOptions extends UrlPolicy {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  maxRedirects?: number;
  dnsLookup?: DnsLookup;
  /** Transporte injetável em teste. Produção usa requestPinnedAddress. */
  requestImpl?: SafeRequestImpl;
  /** Compatibilidade temporária com testes/consumidores antigos; não usar em produção. */
  fetchImpl?: typeof fetch;
}

function assertSafeHeaders(headers?: Record<string, string>): void {
  if (!headers) return;
  for (const name of Object.keys(headers)) {
    const normalized = name.toLowerCase();
    if (normalized === 'host' || normalized === 'connection') {
      throw new SsrfBlockedError(`Cabeçalho "${name}" não pode ser sobrescrito.`);
    }
  }
}

function legacyFetchRequest(fetchImpl: typeof fetch): SafeRequestImpl {
  return async (url, _validatedAddress, init) =>
    fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs),
    });
}

/**
 * Fetch SSRF-safe. Em produção, o mesmo IP aprovado pela validação é entregue
 * ao lookup da conexão HTTP/HTTPS, fechando a janela entre validar DNS e abrir
 * o socket. Todo redirecionamento repete validação e pinning do zero.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const requestImpl = options.requestImpl
    ?? (options.fetchImpl ? legacyFetchRequest(options.fetchImpl) : requestPinnedAddress);

  assertSafeHeaders(options.headers);
  let currentUrl = assertSafeUrlSyntax(rawUrl, options);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const addresses = await resolveAndAssertSafeHost(currentUrl.hostname, dnsLookup);
    const validatedAddress = addresses[0];
    if (!validatedAddress) {
      throw new SsrfBlockedError(`Host "${currentUrl.hostname}" não possui endereço validado.`);
    }

    const response = await requestImpl(currentUrl, validatedAddress, {
      method: options.method ?? 'GET',
      headers: options.headers,
      timeoutMs: options.timeoutMs,
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel('redirect').catch(() => undefined);
      if (!location) {
        throw new SsrfBlockedError('Redirecionamento sem cabeçalho Location.');
      }
      const nextUrl = new URL(location, currentUrl);
      currentUrl = assertSafeUrlSyntax(nextUrl.toString(), options);
      continue;
    }

    return response;
  }

  throw new SsrfBlockedError('Número máximo de redirecionamentos excedido.');
}
