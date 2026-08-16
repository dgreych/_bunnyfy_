import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ASSET_FILES,
  DEFAULT_ASSET_DIR,
} from '../src/tavernGame/rendering/TavernAssetRegistry.ts';

const MIME_BY_EXTENSION = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
]);

async function listImageAssets(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return listImageAssets(filename);
    return MIME_BY_EXTENSION.has(path.extname(entry.name).toLowerCase()) ? [filename] : [];
  }));
  return nested.flat();
}

async function sniffImageMime(filename: string): Promise<string | null> {
  const handle = await fs.open(filename, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))) return 'image/png';
    if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return 'image/jpeg';
    }
    return null;
  } finally {
    await handle.close();
  }
}

test('todos os ativos registrados existem no pacote da BunnyFy', async () => {
  const missing = [];
  for (const [key, relativePath] of Object.entries(ASSET_FILES)) {
    try {
      await fs.access(path.join(DEFAULT_ASSET_DIR, relativePath));
    } catch {
      missing.push(key);
    }
  }
  assert.deepEqual(missing, []);
});

test('extensão e MIME real coincidem em todas as imagens da Tavern', async () => {
  const images = await listImageAssets(DEFAULT_ASSET_DIR);
  assert.ok(images.length > 0);

  const mismatches = [];
  for (const filename of images) {
    const relativePath = path.relative(DEFAULT_ASSET_DIR, filename);
    const expectedMime = MIME_BY_EXTENSION.get(path.extname(filename).toLowerCase());
    const actualMime = await sniffImageMime(filename);
    if (actualMime !== expectedMime) mismatches.push({ relativePath, expectedMime, actualMime });
  }
  assert.deepEqual(mismatches, []);
});
