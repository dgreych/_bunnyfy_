/**
 * Envelope JSON canônico da BunnyFy — todo endpoint responde nesse formato,
 * sucesso ou erro.
 */

export interface EnvelopeMeta {
  requestId: string;
  durationMs: number;
}

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  error: null;
  meta: EnvelopeMeta;
}

export interface ErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ErrorEnvelope {
  ok: false;
  data: null;
  error: ErrorPayload;
  meta: EnvelopeMeta;
}

export function okEnvelope<T>(data: T, meta: EnvelopeMeta): SuccessEnvelope<T> {
  return { ok: true, data, error: null, meta };
}

export function errEnvelope(error: ErrorPayload, meta: EnvelopeMeta): ErrorEnvelope {
  return { ok: false, data: null, error, meta };
}

/**
 * Erro tipado que carrega tudo que o handler de erro precisa pra montar o
 * envelope: status HTTP, código estável pro cliente e se vale a pena tentar
 * de novo. `internalDetails` nunca é serializado pro cliente — só entra no
 * log do servidor, sem segredo.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly internalDetails?: unknown;

  constructor(options: {
    statusCode: number;
    code: string;
    message: string;
    retryable?: boolean;
    internalDetails?: unknown;
    cause?: unknown;
  }) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.internalDetails = options.internalDetails;
  }

  toPayload(): ErrorPayload {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }

  // Códigos alinhados a docs/GYOMEI_COMPATIBILITY.md, seção "Erros mínimos" —
  // o cliente Gyomei (dados/src/services/bunnyfy/**) faz pattern-match nesses
  // valores exatos, então não renomear sem atualizar os dois lados.

  static unauthorized(message = 'Credencial ausente ou inválida.'): AppError {
    return new AppError({ statusCode: 401, code: 'BUNNYFY_AUTH_FAILED', message, retryable: false });
  }

  static badRequest(message: string, internalDetails?: unknown): AppError {
    return new AppError({ statusCode: 400, code: 'BUNNYFY_BAD_REQUEST', message, retryable: false, internalDetails });
  }

  static notFound(message = 'Recurso não encontrado.'): AppError {
    return new AppError({ statusCode: 404, code: 'BUNNYFY_NOT_FOUND', message, retryable: false });
  }

  static payloadTooLarge(message = 'Corpo da requisição excede o limite permitido.'): AppError {
    return new AppError({ statusCode: 413, code: 'BUNNYFY_TOO_LARGE', message, retryable: false });
  }

  static unsupportedMedia(message = 'Tipo de mídia não suportado.'): AppError {
    return new AppError({ statusCode: 415, code: 'BUNNYFY_BAD_REQUEST', message, retryable: false });
  }

  static tooManyRequests(message = 'Limite de requisições excedido.'): AppError {
    return new AppError({ statusCode: 429, code: 'BUNNYFY_RATE_LIMITED', message, retryable: true });
  }

  static blockedUrl(message = 'URL não permitida por política de segurança.'): AppError {
    return new AppError({ statusCode: 400, code: 'BUNNYFY_URL_BLOCKED', message, retryable: false });
  }

  static toolUnavailable(message = 'Dependência de runtime indisponível no momento.'): AppError {
    return new AppError({ statusCode: 503, code: 'BUNNYFY_TOOL_UNAVAILABLE', message, retryable: true });
  }

  static unavailable(message = 'Capacidade temporariamente indisponível.'): AppError {
    return new AppError({ statusCode: 503, code: 'BUNNYFY_UNAVAILABLE', message, retryable: true });
  }

  static upstreamTimeout(message = 'Tempo esgotado ao processar a solicitação.'): AppError {
    return new AppError({ statusCode: 504, code: 'BUNNYFY_TIMEOUT', message, retryable: true });
  }

  static internal(message = 'Erro interno inesperado.', internalDetails?: unknown): AppError {
    return new AppError({ statusCode: 500, code: 'BUNNYFY_INTERNAL_ERROR', message, retryable: false, internalDetails });
  }
}
