import pino, { type LoggerOptions } from 'pino';

import type { AppConfig } from './config.ts';

/**
 * Remove querystring de uma URL antes de logar — mantém só o caminho, pra
 * nunca vazar token/URL assinada que tenha ido em query string por acidente
 * em algum client legado. O código de `/m/:code` também é redigido: ali o
 * código sozinho já é a credencial de acesso ao link curto público, então
 * não pode aparecer nem no caminho.
 */
export function redactUrlForLog(rawUrl: string): string {
  const queryIndex = rawUrl.indexOf('?');
  const pathOnly = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const suffix = queryIndex === -1 ? '' : '?[redacted]';

  if (pathOnly.startsWith('/m/')) {
    return `/m/[redacted]${suffix}`;
  }

  return `${pathOnly}${suffix}`;
}

const REDACTED_KEYS = [
  'token',
  'apiToken',
  'apiKey',
  'nvidiaApiKey',
  'authorization',
  'sig',
  'signature',
  'password',
  'secret',
  'body',
  'requestBody',
  'responseBody',
  'messages',
  'prompt',
  'completion',
  'transcript',
];

function redactPaths(): string[] {
  const nested = REDACTED_KEYS.map((key) => `*.${key}`);
  const deeplyNested = REDACTED_KEYS.map((key) => `*.*.${key}`);
  return [
    'req.headers.authorization',
    'headers.authorization',
    'req.headers.cookie',
    'headers.cookie',
    ...REDACTED_KEYS,
    ...nested,
    ...deeplyNested,
  ];
}

export function buildLogger(
  config: Pick<AppConfig, 'logLevel' | 'logPretty'>,
  destinationStream?: pino.DestinationStream,
) {
  const options: LoggerOptions = {
    level: config.logLevel,
    redact: { paths: redactPaths(), censor: '[redacted]' },
    serializers: {
      req(request: { method?: string; url?: string; id?: string | number }) {
        return {
          method: request.method,
          url: typeof request.url === 'string' ? redactUrlForLog(request.url) : undefined,
          requestId: request.id,
        };
      },
      res(reply: { statusCode: number }) {
        return { statusCode: reply.statusCode };
      },
    },
  };

  // Transport roda em worker thread e ignora um destination stream passado
  // manualmente — só usa pino-pretty quando não há destino customizado
  // (destino customizado normalmente só existe em teste, que quer JSON cru).
  if (config.logPretty && !destinationStream) {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    };
  }

  return destinationStream ? pino(options, destinationStream) : pino(options);
}

export type AppLogger = ReturnType<typeof buildLogger>;
