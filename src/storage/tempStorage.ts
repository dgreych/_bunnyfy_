import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { AppError } from '../envelope.ts';

export interface StoredEntry {
  id: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  expiresAt: number;
  originalName?: string;
  shortCode?: string;
}

export interface TempStorageOptions {
  dir: string;
  ttlMs: number;
  maxBytes: number;
  sweepIntervalMs: number;
}

/** IDs gerados por randomBytes(18).toString('base64url') têm sempre 24 caracteres. */
const MANAGED_ID = '[A-Za-z0-9_-]{24}';
const MANAGED_FILE_PATTERN = new RegExp(
  `^(?:${MANAGED_ID}|${MANAGED_ID}-src)(?:\\.[A-Za-z0-9_-]{1,64})*$`,
);

export function generateOpaqueId(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * Armazenamento temporário local com ids opacos, limite durante streaming,
 * expiração em memória e limpeza conservadora de órfãos deixados por processos
 * anteriores. A limpeza em disco só considera nomes que batem exatamente com
 * o formato interno da BunnyFy; outros arquivos no diretório nunca são tocados.
 */
export class TempStorage {
  private readonly options: TempStorageOptions;
  private readonly entries = new Map<string, StoredEntry>();
  private readonly shortLinks = new Map<string, string>();
  private sweeper: NodeJS.Timeout | undefined;

  constructor(options: TempStorageOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.options.dir, { recursive: true, mode: 0o700 });
    await this.sweepOrphanedFiles();
  }

  pathFor(id: string): string {
    return path.join(this.options.dir, id);
  }

  async put(
    source: Readable,
    meta: { mimeType: string; originalName?: string; ttlMs?: number },
  ): Promise<StoredEntry> {
    const id = generateOpaqueId();
    const filePath = this.pathFor(id);
    const maxBytes = this.options.maxBytes;

    let sizeBytes = 0;
    const limiter = async function* limitBytes(chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) {
          throw AppError.payloadTooLarge(`Arquivo excede o limite de ${maxBytes} bytes.`);
        }
        yield chunk;
      }
    };

    try {
      await pipeline(limiter(source), createWriteStream(filePath, { mode: 0o600 }));
    } catch (error) {
      await fs.rm(filePath, { force: true });
      throw error;
    }

    const now = Date.now();
    const ttlMs = meta.ttlMs ?? this.options.ttlMs;
    const entry: StoredEntry = {
      id,
      filePath,
      mimeType: meta.mimeType,
      sizeBytes,
      createdAt: now,
      expiresAt: now + ttlMs,
      originalName: meta.originalName,
    };

    this.entries.set(id, entry);
    return entry;
  }

  /**
   * Registra arquivo escrito por subprocesso. O tamanho final é revalidado
   * aqui, independentemente do limite informado à ferramenta externa.
   */
  async registerExisting(
    id: string,
    filePath: string,
    meta: { mimeType: string; originalName?: string; ttlMs?: number; maxBytes?: number },
  ): Promise<StoredEntry> {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw AppError.internal('Artefato externo não é um arquivo regular.');
    }
    const maxBytes = meta.maxBytes ?? this.options.maxBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw AppError.internal('Limite interno inválido para registrar artefato externo.');
    }
    if (stat.size > maxBytes) {
      await fs.rm(filePath, { force: true });
      throw AppError.payloadTooLarge(`Arquivo excede o limite de ${maxBytes} bytes.`);
    }

    const now = Date.now();
    const ttlMs = meta.ttlMs ?? this.options.ttlMs;
    const entry: StoredEntry = {
      id,
      filePath,
      mimeType: meta.mimeType,
      sizeBytes: stat.size,
      createdAt: now,
      expiresAt: now + ttlMs,
      originalName: meta.originalName,
    };
    this.entries.set(id, entry);
    return entry;
  }

  async get(id: string): Promise<StoredEntry | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      await this.delete(id);
      return undefined;
    }

    return entry;
  }

  async delete(id: string): Promise<void> {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (entry) {
      if (entry.shortCode) this.shortLinks.delete(entry.shortCode);
      await fs.rm(entry.filePath, { force: true });
    }
  }

  setMimeType(id: string, mimeType: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.mimeType = mimeType;
  }

  registerShortLink(id: string): string | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    const code = randomBytes(16).toString('base64url');
    entry.shortCode = code;
    this.shortLinks.set(code, id);
    return code;
  }

  async getByShortCode(code: string): Promise<StoredEntry | undefined> {
    const id = this.shortLinks.get(code);
    if (!id) return undefined;

    const entry = await this.get(id);
    if (!entry) {
      this.shortLinks.delete(code);
      return undefined;
    }

    return entry;
  }

  revokeShortLink(code: string): void {
    const id = this.shortLinks.get(code);
    this.shortLinks.delete(code);
    if (id) {
      const entry = this.entries.get(id);
      if (entry && entry.shortCode === code) entry.shortCode = undefined;
    }
  }

  async sweepExpired(): Promise<number> {
    const now = Date.now();
    const expired = [...this.entries.values()].filter((entry) => entry.expiresAt <= now);
    await Promise.all(expired.map((entry) => this.delete(entry.id)));
    return expired.length;
  }

  /**
   * Remove arquivos BunnyFy sem metadados em memória quando já passaram do TTL.
   * Isso cobre crashes/restarts e resíduos de subprocessos sem apagar arquivos
   * arbitrários de um MEDIA_DIR eventualmente compartilhado por engano.
   */
  async sweepOrphanedFiles(now = Date.now()): Promise<number> {
    let removed = 0;
    const directoryEntries = await fs.readdir(this.options.dir, { withFileTypes: true });

    for (const directoryEntry of directoryEntries) {
      if (!directoryEntry.isFile() || !MANAGED_FILE_PATTERN.test(directoryEntry.name)) continue;

      const filePath = path.join(this.options.dir, directoryEntry.name);
      const tracked = [...this.entries.values()].some((entry) => entry.filePath === filePath);
      if (tracked) continue;

      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs + this.options.ttlMs > now) continue;
        await fs.rm(filePath, { force: true });
        removed += 1;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
      }
    }

    return removed;
  }

  startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      Promise.all([this.sweepExpired(), this.sweepOrphanedFiles()]).catch(() => undefined);
    }, this.options.sweepIntervalMs);
    this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = undefined;
    }
  }

  close(): Promise<void> {
    this.stopSweeper();
    return Promise.resolve();
  }
}
