import { execFile } from 'node:child_process';

/** Lançado quando o binário externo (yt-dlp, ffmpeg etc.) não existe no PATH. */
export class ToolNotFoundError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Ferramenta externa "${toolName}" não encontrada.`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}

export class SubprocessTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(`Ferramenta externa "${toolName}" excedeu o tempo limite de ${timeoutMs}ms.`);
    this.name = 'SubprocessTimeoutError';
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

export type SubprocessFailureKind =
  | 'youtube_antibot'
  | 'js_challenge'
  | 'youtube_delivery'
  | 'youtube_auth'
  | 'media_unavailable'
  | 'http_429'
  | 'http_403'
  | 'format'
  | 'network'
  | 'other';

/**
 * CLASSIFIER_V2_UNICODE_NORMALIZATION
 *
 * Normaliza somente caracteres tipográficos relevantes para classificação.
 * O texto normalizado nunca é persistido nem anexado ao erro.
 */
function normalizeSubprocessDiagnosticText(stderr: string): string {
  return stderr
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\u00a0/g, ' ');
}

function classifySubprocessFailure(stderr: string): SubprocessFailureKind {
  const text = normalizeSubprocessDiagnosticText(stderr);

  if (
    text.includes("sign in to confirm you're not a bot") ||
    text.includes("confirm you're not a bot") ||
    text.includes('login_required') ||
    text.includes('login required') ||
    text.includes('po token') ||
    text.includes('po-token') ||
    text.includes('proof of origin')
  ) {
    return 'youtube_antibot';
  }

  if (
    text.includes('n challenge solving failed') ||
    text.includes('signature solving failed') ||
    text.includes('challenge solving failed') ||
    text.includes('challenge solver script distribution') ||
    text.includes('no supported javascript runtime could be found')
  ) {
    return 'js_challenge';
  }

  if (
    text.includes('only images are available for download') ||
    text.includes('forcing sabr streaming') ||
    text.includes('formats have been skipped as they are missing a url')
  ) {
    return 'youtube_delivery';
  }

  if (
    text.includes('age-restricted') ||
    text.includes('age restricted') ||
    text.includes('members-only') ||
    text.includes('members only') ||
    text.includes('private video') ||
    text.includes('authentication is required')
  ) {
    return 'youtube_auth';
  }

  if (
    text.includes('this video is unavailable') ||
    text.includes('video unavailable') ||
    text.includes('video has been removed') ||
    text.includes('not available in your country') ||
    text.includes('not available in your region')
  ) {
    return 'media_unavailable';
  }

  if (
    text.includes('http error 429') ||
    text.includes('429 too many requests')
  ) {
    return 'http_429';
  }

  if (
    text.includes('http error 403') ||
    text.includes('403 forbidden')
  ) {
    return 'http_403';
  }

  if (
    text.includes('requested format is not available') ||
    text.includes('no video formats found') ||
    text.includes('format is not available')
  ) {
    return 'format';
  }

  if (
    text.includes('unable to download webpage') ||
    text.includes('unable to download video data') ||
    text.includes('network is unreachable') ||
    text.includes('temporary failure in name resolution') ||
    text.includes('name or service not known') ||
    text.includes('connection reset') ||
    text.includes('connection refused') ||
    text.includes('remote end closed connection') ||
    text.includes('timed out') ||
    text.includes('timeout')
  ) {
    return 'network';
  }

  return 'other';
}

/** Teto de stderr retido em `SubprocessExitError.stderr` -- log server-side, nunca vai pro cliente. */
const SUBPROCESS_STDERR_CAP_BYTES = 4096;

/** Remove bytes NUL e limita tamanho, mas preserva o texto diagnostico como veio. */
function sanitizeSubprocessStderr(stderr: string): string {
  const stripped = stderr.split('\u0000').join('');
  return stripped.length > SUBPROCESS_STDERR_CAP_BYTES
    ? stripped.slice(0, SUBPROCESS_STDERR_CAP_BYTES) + '...(truncado)'
    : stripped;
}

export class SubprocessExitError extends Error {
  readonly toolName: string;
  readonly exitCode: string | number | null;
  readonly signal: string | null;
  readonly failureKind: SubprocessFailureKind;
  /**
   * stderr bruto (sanitizado/limitado). Propriedade não enumerável de propósito:
   * `JSON.stringify(error)`, spreads e logs genéricos continuam sem vazar stderr
   * de ferramentas como yt-dlp (que pode conter URL/cookie) — ver
   * tests/subprocess.test.ts. Só quem lê `error.stderr` explicitamente (ex.:
   * runWhisperCli, que sabe que o stderr do whisper-cli não carrega segredo)
   * decide colocá-lo em `internalDetails` pra log server-side.
   */
  declare readonly stderr: string;

  constructor(
    toolName: string,
    exitCode: string | number | null,
    signal: string | null,
    stderr: string,
    failureKind: SubprocessFailureKind,
  ) {
    super(
      signal
        ? `Ferramenta externa encerrada pelo sinal ${signal} (${failureKind}).`
        : `Ferramenta externa encerrou com erro (${failureKind}, exit=${String(exitCode ?? 'unknown')}).`,
    );
    this.name = 'SubprocessExitError';
    this.toolName = toolName;
    this.exitCode = exitCode;
    this.signal = signal;
    this.failureKind = failureKind;
    Object.defineProperty(this, 'stderr', {
      value: sanitizeSubprocessStderr(stderr),
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

export interface RunSubprocessResult {
  stdout: string;
  stderr: string;
}

/**
 * Roda um binário externo com argumentos em array — nunca via shell, nunca
 * com interpolação de string. Detecta ausência do binário (`ENOENT`)
 * explicitamente e vira um erro estável em vez de derrubar o processo.
 */
export function runSubprocess(
  bin: string,
  args: string[],
  options: { timeoutMs: number; maxBufferBytes?: number; env?: NodeJS.ProcessEnv },
): Promise<RunSubprocessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes ?? 16 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        env: options.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const errno = (error as NodeJS.ErrnoException).code;
          if (errno === 'ENOENT') {
            reject(new ToolNotFoundError(bin));
            return;
          }
          if (error.killed && error.signal) {
            reject(new SubprocessTimeoutError(bin, options.timeoutMs));
            return;
          }
          const exitCode = (error as { code?: string | number }).code ?? null;
          const signal = error.signal ?? null;
          reject(
            new SubprocessExitError(
              bin,
              exitCode,
              signal,
              String(stderr),
              classifySubprocessFailure(String(stderr)),
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

const availabilityCache = new Map<string, boolean>();
const versionCache = new Map<string, string | null>();
const TOOL_VERSION_TIMEOUT_MS = 15_000;

export async function readToolVersion(
  bin: string,
  versionArgs: string[] = ['--version'],
): Promise<string | null> {
  const cacheKey = `${bin}\u0000${versionArgs.join('\u0000')}`;
  if (versionCache.has(cacheKey)) return versionCache.get(cacheKey)!;

  try {
    const result = await runSubprocess(bin, versionArgs, {
      timeoutMs: TOOL_VERSION_TIMEOUT_MS,
      maxBufferBytes: 64 * 1024,
    });
    const firstLine = `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null;
    // Só respostas válidas são estáveis o bastante para cache.
    // Falha transitória de startup/I/O não pode envenenar /ready
    // até o próximo restart do processo.
    if (firstLine !== null) {
      versionCache.set(cacheKey, firstLine);
    }
    return firstLine;
  } catch {
    return null;
  }
}

/** Confirma se um binário existe e roda, sem cachear indefinidamente falhas por outro motivo. */
export async function checkToolAvailable(bin: string, versionArgs: string[] = ['--version']): Promise<boolean> {
  if (availabilityCache.has(bin)) {
    return availabilityCache.get(bin)!;
  }

  try {
    await runSubprocess(bin, versionArgs, { timeoutMs: 5000 });
    availabilityCache.set(bin, true);
    return true;
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      availabilityCache.set(bin, false);
      return false;
    }
    // Erro diferente de "não encontrado" (ex.: --version falhou por outro
    // motivo) ainda conta como "existe", só não cacheamos o resultado.
    return true;
  }
}

/** Só pra testes: limpa o cache de disponibilidade entre casos. */
export function resetToolAvailabilityCache(): void {
  availabilityCache.clear();
  versionCache.clear();
}
