import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const API_KEY_PATTERN = /^bf_(test|live)_([A-Za-z0-9_-]{32,256})$/;
const API_KEY_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const SCOPE_SEGMENT = '[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?';
const EXACT_SCOPE_PATTERN = new RegExp(`^${SCOPE_SEGMENT}(?::${SCOPE_SEGMENT})*$`);
const FAMILY_SCOPE_PATTERN = new RegExp(`^${SCOPE_SEGMENT}(?::${SCOPE_SEGMENT})*:\\*$`);
const CONFIGURATION_ERROR_MESSAGE = 'BUNNYFY_API_KEYS possui configuração inválida.';
const MAX_RECORDS = 1_000;
const MAX_SCOPES_PER_KEY = 128;
const LEGACY_TOKEN_MIN_LENGTH = 16;
const LEGACY_TOKEN_MAX_LENGTH = 512;
const PLACEHOLDER_PATTERN = /SUBSTITUA|COLOQUE|PLACEHOLDER|SUA?_CHAVE|SEU_TOKEN/i;

export type ApiKeyEnvironment = 'test' | 'live';

export interface ApiKeyPrincipal {
  readonly id: string;
  readonly environment: ApiKeyEnvironment | 'legacy';
  readonly scopes: readonly string[];
  readonly legacy: boolean;
}

export interface ApiKeyRegistryOptions {
  /** Compatibilidade temporária. Tokens legados sempre recebem o escopo global. */
  readonly legacyTokens?: readonly string[];
}

interface ApiKeyDefinition {
  readonly id: string;
  readonly key: string;
  readonly scopes: readonly string[];
}

interface StoredApiKey {
  readonly principal: ApiKeyPrincipal;
  readonly digest: Buffer;
}

/** Erro deliberadamente genérico: valores privados nunca entram na mensagem. */
export class ApiKeyConfigurationError extends Error {
  constructor() {
    super(CONFIGURATION_ERROR_MESSAGE);
    this.name = 'ApiKeyConfigurationError';
  }
}

function configurationError(): ApiKeyConfigurationError {
  return new ApiKeyConfigurationError();
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function isValidScope(scope: string): boolean {
  return scope === '*' || EXACT_SCOPE_PATTERN.test(scope) || FAMILY_SCOPE_PATTERN.test(scope);
}

function parseEnvironment(key: string): ApiKeyEnvironment | undefined {
  const match = API_KEY_PATTERN.exec(key);
  const environment = match?.[1];
  return environment === 'test' || environment === 'live' ? environment : undefined;
}

function parseDefinition(value: unknown): ApiKeyDefinition {
  if (!isPlainObject(value)) throw configurationError();

  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.includes('id') || !keys.includes('key') || !keys.includes('scopes')) {
    throw configurationError();
  }

  const { id, key, scopes } = value;
  if (typeof id !== 'string' || !API_KEY_ID_PATTERN.test(id)) throw configurationError();
  if (typeof key !== 'string' || PLACEHOLDER_PATTERN.test(key) || parseEnvironment(key) === undefined) {
    throw configurationError();
  }
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > MAX_SCOPES_PER_KEY) {
    throw configurationError();
  }

  const parsedScopes: string[] = [];
  const uniqueScopes = new Set<string>();
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !isValidScope(scope) || uniqueScopes.has(scope)) {
      throw configurationError();
    }
    uniqueScopes.add(scope);
    parsedScopes.push(scope);
  }

  return { id, key, scopes: parsedScopes };
}

function parseDefinitions(raw: string | undefined): ApiKeyDefinition[] {
  if (raw === undefined || raw.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw configurationError();
  }

  if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS) throw configurationError();
  return parsed.map(parseDefinition);
}

function createStoredRecords(
  definitions: readonly ApiKeyDefinition[],
  legacyTokens: readonly string[],
): StoredApiKey[] {
  if (definitions.length + legacyTokens.length > MAX_RECORDS) throw configurationError();

  const records: StoredApiKey[] = [];
  const ids = new Set<string>();
  const digests = new Set<string>();

  const addRecord = (principal: ApiKeyPrincipal, secret: string) => {
    const secretDigest = digest(secret);
    const digestKey = secretDigest.toString('hex');
    if (ids.has(principal.id) || digests.has(digestKey)) throw configurationError();

    ids.add(principal.id);
    digests.add(digestKey);
    records.push({
      principal: Object.freeze({ ...principal, scopes: Object.freeze([...principal.scopes]) }),
      digest: secretDigest,
    });
  };

  for (const definition of definitions) {
    const environment = parseEnvironment(definition.key);
    if (environment === undefined) throw configurationError();
    addRecord(
      {
        id: definition.id,
        environment,
        scopes: definition.scopes,
        legacy: false,
      },
      definition.key,
    );
  }

  legacyTokens.forEach((token, index) => {
    if (
      typeof token !== 'string' ||
      token.length < LEGACY_TOKEN_MIN_LENGTH ||
      token.length > LEGACY_TOKEN_MAX_LENGTH ||
      PLACEHOLDER_PATTERN.test(token)
    ) {
      throw configurationError();
    }
    addRecord(
      {
        id: `legacy-${index + 1}`,
        environment: 'legacy',
        scopes: ['*'],
        legacy: true,
      },
      token,
    );
  });

  return records;
}

/**
 * Registro somente em memória. Guarda SHA-256 das credenciais e metadados
 * não secretos; a chave crua usada no boot não fica retida na instância.
 */
export class ApiKeyRegistry {
  readonly #records: readonly StoredApiKey[];

  constructor(definitions: readonly ApiKeyDefinition[], options: ApiKeyRegistryOptions = {}) {
    this.#records = createStoredRecords(definitions, options.legacyTokens ?? []);
  }

  get size(): number {
    return this.#records.length;
  }

  /**
   * Autentica e, quando informado, autoriza um escopo. Chave inexistente e
   * chave sem permissão produzem exatamente o mesmo resultado (`undefined`).
   */
  authenticate(providedKey: string, requiredScope?: string): ApiKeyPrincipal | undefined {
    if (typeof providedKey !== 'string') return undefined;

    const providedDigest = digest(providedKey);
    let matched: StoredApiKey | undefined;

    // Todos os digests têm tamanho fixo e todos os registros são comparados,
    // evitando comparação de segredo por texto ou saída antecipada por índice.
    for (const record of this.#records) {
      if (timingSafeEqual(record.digest, providedDigest)) matched = record;
    }

    if (matched === undefined) return undefined;
    if (requiredScope !== undefined && !hasApiKeyScope(matched.principal.scopes, requiredScope)) {
      return undefined;
    }
    return matched.principal;
  }
}

/**
 * Converte o JSON de `BUNNYFY_API_KEYS` diretamente num registro sanitizado.
 * Formato: `[{"id":"...","key":"bf_live_...","scopes":["..."]}]`.
 */
export function parseApiKeysJson(
  raw: string | undefined,
  options: ApiKeyRegistryOptions = {},
): ApiKeyRegistry {
  return new ApiKeyRegistry(parseDefinitions(raw), options);
}

/** Gera uma chave com 256 bits aleatórios no ambiente solicitado. */
export function generateApiKey(environment: ApiKeyEnvironment): string {
  return `bf_${environment}_${randomBytes(32).toString('base64url')}`;
}

export function isBunnyFyApiKey(value: string): boolean {
  return parseEnvironment(value) !== undefined;
}

/** Escopos são sensíveis a maiúsculas e aceitam exato, `*` ou `familia:*`. */
export function hasApiKeyScope(grantedScopes: readonly string[], requiredScope: string): boolean {
  if (!isValidScope(requiredScope)) return false;

  return grantedScopes.some((grantedScope) => {
    if (grantedScope === '*' || grantedScope === requiredScope) return true;
    if (!FAMILY_SCOPE_PATTERN.test(grantedScope)) return false;

    const familyPrefix = grantedScope.slice(0, -1);
    return requiredScope.length > familyPrefix.length && requiredScope.startsWith(familyPrefix);
  });
}
