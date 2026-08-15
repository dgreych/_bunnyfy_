import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';

import { AppError } from '../src/envelope.ts';
import { TempStorage } from '../src/storage/tempStorage.ts';

async function withStorage(
  options: Partial<{ ttlMs: number; maxBytes: number; sweepIntervalMs: number }>,
  run: (storage: TempStorage, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-storage-test-'));
  const storage = new TempStorage({
    dir,
    ttlMs: options.ttlMs ?? 60_000,
    maxBytes: options.maxBytes ?? 1024 * 1024,
    sweepIntervalMs: options.sweepIntervalMs ?? 3_600_000,
  });
  await storage.init();
  try {
    await run(storage, dir);
  } finally {
    await storage.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('put/get faz o roundtrip do conteúdo e dos metadados', async () => {
  await withStorage({}, async (storage) => {
    const entry = await storage.put(Readable.from(Buffer.from('conteudo de teste')), {
      mimeType: 'text/plain',
      originalName: 'a.txt',
    });

    assert.match(entry.id, /^[A-Za-z0-9_-]+$/);
    assert.equal(entry.sizeBytes, Buffer.byteLength('conteudo de teste'));

    const fetched = await storage.get(entry.id);
    assert.ok(fetched);
    assert.equal(fetched.mimeType, 'text/plain');
  });
});

test('get retorna undefined pra id desconhecido', async () => {
  await withStorage({}, async (storage) => {
    assert.equal(await storage.get('id-que-nao-existe'), undefined);
  });
});

test('put rejeita e apaga arquivo parcial quando excede maxBytes', async () => {
  await withStorage({ maxBytes: 10 }, async (storage, dir) => {
    await assert.rejects(
      storage.put(Readable.from(Buffer.from('isso tem mais de dez bytes com certeza')), {
        mimeType: 'text/plain',
      }),
      AppError,
    );

    const files = await readdir(dir);
    assert.deepEqual(files, []);
  });
});

test('entrada expira sozinha na leitura (expiração preguiçosa) e some do disco', async () => {
  await withStorage({ ttlMs: 5 }, async (storage, dir) => {
    const entry = await storage.put(Readable.from(Buffer.from('expira rápido')), { mimeType: 'text/plain' });
    await sleep(20);

    assert.equal(await storage.get(entry.id), undefined);
    const files = await readdir(dir);
    assert.deepEqual(files, []);
  });
});

test('sweepExpired remove entradas vencidas sem esperar leitura', async () => {
  await withStorage({ ttlMs: 5 }, async (storage, dir) => {
    await storage.put(Readable.from(Buffer.from('a')), { mimeType: 'text/plain' });
    await storage.put(Readable.from(Buffer.from('b')), { mimeType: 'text/plain' });
    await sleep(20);

    const removed = await storage.sweepExpired();
    assert.equal(removed, 2);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('delete remove o arquivo e some da leitura', async () => {
  await withStorage({}, async (storage, dir) => {
    const entry = await storage.put(Readable.from(Buffer.from('apagar')), { mimeType: 'text/plain' });
    await storage.delete(entry.id);
    assert.equal(await storage.get(entry.id), undefined);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('registerExisting registra um arquivo já escrito em disco por fora', async () => {
  await withStorage({}, async (storage, dir) => {
    const filePath = path.join(dir, 'externo.bin');
    await writeFile(filePath, Buffer.alloc(42));

    const entry = await storage.registerExisting('id-externo', filePath, { mimeType: 'application/octet-stream' });
    assert.equal(entry.sizeBytes, 42);

    const fetched = await storage.get('id-externo');
    assert.ok(fetched);
    assert.equal(fetched.filePath, filePath);
  });
});

test('registerExisting rejeita e remove arquivo externo acima do limite', async () => {
  await withStorage({ maxBytes: 16 }, async (storage, dir) => {
    const filePath = path.join(dir, 'externo-grande.bin');
    await writeFile(filePath, Buffer.alloc(17));

    await assert.rejects(
      storage.registerExisting('id-externo-grande', filePath, { mimeType: 'application/octet-stream' }),
      (error: unknown) => error instanceof AppError && error.statusCode === 413,
    );
    await assert.rejects(stat(filePath), { code: 'ENOENT' });
  });
});

test('registerExisting aceita override explícito sem ampliar o teto padrão de put', async () => {
  await withStorage({ maxBytes: 16 }, async (storage, dir) => {
    const externalPath = path.join(dir, 'externo-com-limite-proprio.bin');
    await writeFile(externalPath, Buffer.alloc(24));

    const entry = await storage.registerExisting('id-externo-override', externalPath, {
      mimeType: 'application/octet-stream',
      maxBytes: 32,
    });
    assert.equal(entry.sizeBytes, 24);

    await assert.rejects(
      storage.put(Readable.from(Buffer.alloc(17)), { mimeType: 'application/octet-stream' }),
      (error: unknown) => error instanceof AppError && error.statusCode === 413,
    );
  });
});

test('registerExisting aplica override menor e remove o arquivo recusado', async () => {
  await withStorage({ maxBytes: 64 }, async (storage, dir) => {
    const filePath = path.join(dir, 'externo-override-menor.bin');
    await writeFile(filePath, Buffer.alloc(17));

    await assert.rejects(
      storage.registerExisting('id-externo-override-menor', filePath, {
        mimeType: 'application/octet-stream',
        maxBytes: 16,
      }),
      (error: unknown) => error instanceof AppError && error.statusCode === 413,
    );
    await assert.rejects(stat(filePath), { code: 'ENOENT' });
  });
});

test('sweepOrphanedFiles remove resíduo BunnyFy vencido e preserva arquivo arbitrário', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-storage-orphan-test-'));
  const managedName = 'AbCdEfGhIjKlMnOpQrStUvWx';
  const managedPath = path.join(dir, managedName);
  const arbitraryPath = path.join(dir, 'arquivo-do-usuario.txt');

  await writeFile(managedPath, 'órfão');
  await writeFile(arbitraryPath, 'preservar');
  const oldDate = new Date(Date.now() - 120_000);
  await utimes(managedPath, oldDate, oldDate);
  await utimes(arbitraryPath, oldDate, oldDate);

  const storage = new TempStorage({ dir, ttlMs: 60_000, maxBytes: 1024, sweepIntervalMs: 3_600_000 });
  try {
    await storage.init();
    assert.deepEqual(await readdir(dir), ['arquivo-do-usuario.txt']);
  } finally {
    await storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('registerShortLink gera código de 128 bits e getByShortCode resolve pra mesma entrada', async () => {
  await withStorage({}, async (storage) => {
    const entry = await storage.put(Readable.from(Buffer.from('imagem falsa')), { mimeType: 'image/png' });
    const code = storage.registerShortLink(entry.id);

    assert.ok(code);
    assert.equal(code.length, 22);

    const resolved = await storage.getByShortCode(code);
    assert.ok(resolved);
    assert.equal(resolved.id, entry.id);
  });
});

test('registerShortLink retorna undefined pra id inexistente', async () => {
  await withStorage({}, async (storage) => {
    assert.equal(storage.registerShortLink('nao-existe'), undefined);
  });
});

test('getByShortCode retorna undefined pra código desconhecido', async () => {
  await withStorage({}, async (storage) => {
    assert.equal(await storage.getByShortCode('codigo-que-nao-existe'), undefined);
  });
});

test('id sem link curto registrado nunca é alcançável por getByShortCode', async () => {
  await withStorage({}, async (storage) => {
    const entry = await storage.put(Readable.from(Buffer.from('upload genérico')), { mimeType: 'text/plain' });
    assert.equal(await storage.getByShortCode(entry.id), undefined);
  });
});

test('revokeShortLink remove o link sem apagar a mídia original', async () => {
  await withStorage({}, async (storage) => {
    const entry = await storage.put(Readable.from(Buffer.from('imagem')), { mimeType: 'image/png' });
    const code = storage.registerShortLink(entry.id);

    storage.revokeShortLink(code!);

    assert.equal(await storage.getByShortCode(code!), undefined);
    assert.ok(await storage.get(entry.id));
  });
});

test('delete da entrada também revoga o link curto associado', async () => {
  await withStorage({}, async (storage) => {
    const entry = await storage.put(Readable.from(Buffer.from('imagem')), { mimeType: 'image/png' });
    const code = storage.registerShortLink(entry.id);

    await storage.delete(entry.id);

    assert.equal(await storage.getByShortCode(code!), undefined);
  });
});

test('setMimeType corrige o tipo guardado', async () => {
  await withStorage({}, async (storage) => {
    const entry = await storage.put(Readable.from(Buffer.from('x')), { mimeType: 'application/octet-stream' });
    storage.setMimeType(entry.id, 'image/png');

    const fetched = await storage.get(entry.id);
    assert.equal(fetched?.mimeType, 'image/png');
  });
});
