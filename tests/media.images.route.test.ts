import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { test } from 'node:test';

import { buildLogger } from '../src/logger.ts';
import { createTestApp, TEST_TOKEN } from './helpers/testApp.ts';

const execFileAsync = promisify(execFile);
const BOUNDARY = 'bunnyfy-image-test-boundary';

function buildMultipartBody(parts: Array<{ name: string; filename?: string; contentType?: string; content: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`
      : `Content-Disposition: form-data; name="${part.name}"`;
    const contentType = part.contentType ? `\r\nContent-Type: ${part.contentType}` : '';
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n${disposition}${contentType}\r\n\r\n`));
    chunks.push(part.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

function multipartHeaders(token = TEST_TOKEN) {
  return { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, authorization: `Bearer ${token}` };
}

let fixturesDir: string;
const fixtures: Record<'png' | 'jpg' | 'gif' | 'webp', Buffer> = {} as never;

async function generateFixtures(): Promise<void> {
  fixturesDir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-image-fixtures-'));
  for (const ext of ['png', 'jpg', 'gif', 'webp'] as const) {
    const filePath = path.join(fixturesDir, `sample.${ext}`);
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=4x4',
      '-frames:v', '1', filePath,
    ]);
    fixtures[ext] = await readFile(filePath);
  }
}

async function withFixtures(run: () => Promise<void>): Promise<void> {
  if (!fixturesDir) await generateFixtures();
  await run();
}

test.after(async () => {
  if (fixturesDir) await rm(fixturesDir, { recursive: true, force: true });
});

test('POST /v1/media/images sem Authorization retorna 401', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media/images',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: buildMultipartBody([{ name: 'file', filename: 'a.png', content: Buffer.from('x') }]),
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await close();
  }
});

test('aceita PNG, JPEG, GIF e WebP reais e detecta o formato pelos bytes', async () => {
  await withFixtures(async () => {
    const { app, close } = await createTestApp();
    try {
      const cases: Array<{ ext: 'png' | 'jpg' | 'gif' | 'webp'; kind: string; mime: string }> = [
        { ext: 'png', kind: 'png', mime: 'image/png' },
        { ext: 'jpg', kind: 'jpeg', mime: 'image/jpeg' },
        { ext: 'gif', kind: 'gif', mime: 'image/gif' },
        { ext: 'webp', kind: 'webp', mime: 'image/webp' },
      ];

      for (const { ext, kind, mime } of cases) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/media/images',
          headers: multipartHeaders(),
          payload: buildMultipartBody([
            { name: 'file', filename: `a.${ext}`, contentType: 'application/octet-stream', content: fixtures[ext] },
          ]),
        });

        assert.equal(response.statusCode, 200, `falhou pra ${ext}: ${response.body}`);
        const body = response.json();
        assert.equal(body.data.kind, kind);
        assert.equal(body.data.mime, mime);
        assert.ok(body.data.shortPath.startsWith('/m/'));
        assert.ok(body.data.shortUrl.startsWith('http://localhost:8080/m/'));
        assert.match(body.data.mediaId, /^[A-Za-z0-9_-]+$/);
      }
    } finally {
      await close();
    }
  });
});

test('ignora MIME e extensão falsos declarados pelo cliente — detecta pelos bytes reais', async () => {
  await withFixtures(async () => {
    const { app, close } = await createTestApp();
    try {
      // manda um PNG de verdade, mas mente dizendo que é GIF na extensão e no content-type da parte.
      const response = await app.inject({
        method: 'POST',
        url: '/v1/media/images',
        headers: multipartHeaders(),
        payload: buildMultipartBody([
          { name: 'file', filename: 'disfarcado.gif', contentType: 'image/gif', content: fixtures.png },
        ]),
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().data.kind, 'png');
      assert.equal(response.json().data.mime, 'image/png');
    } finally {
      await close();
    }
  });
});

test('rejeita arquivo não visual sem deixar arquivo parcial', async () => {
  const { app, close, mediaDir } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media/images',
      headers: multipartHeaders(),
      payload: buildMultipartBody([
        { name: 'file', filename: 'nao-e-imagem.png', contentType: 'image/png', content: Buffer.from('isso não é bytes de imagem nenhuma') },
      ]),
    });
    assert.equal(response.statusCode, 400);

    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(mediaDir), []);
  } finally {
    await close();
  }
});

test('rejeita mais de um arquivo na mesma requisição', async () => {
  await withFixtures(async () => {
    const { app, close } = await createTestApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/media/images',
        headers: multipartHeaders(),
        payload: buildMultipartBody([
          { name: 'file', filename: 'a.png', content: fixtures.png },
          { name: 'file2', filename: 'b.png', content: fixtures.png },
        ]),
      });
      assert.ok(response.statusCode >= 400, `esperava erro, veio ${response.statusCode}`);
    } finally {
      await close();
    }
  });
});

test('respeita limite de bytes durante o upload de imagem', async () => {
  const { app, close, mediaDir } = await createTestApp({ envOverrides: { MEDIA_MAX_BYTES: '10' } });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media/images',
      headers: multipartHeaders(),
      payload: buildMultipartBody([
        { name: 'file', filename: 'a.png', content: Buffer.alloc(1000, 1) },
      ]),
    });
    assert.equal(response.statusCode, 413);

    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(mediaDir), []);
  } finally {
    await close();
  }
});

test('GET /m/:code serve a imagem sem exigir Authorization', async () => {
  await withFixtures(async () => {
    const { app, close } = await createTestApp();
    try {
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/v1/media/images',
        headers: multipartHeaders(),
        payload: buildMultipartBody([{ name: 'file', filename: 'a.png', content: fixtures.png }]),
      });
      const { shortPath } = uploadResponse.json().data;

      const readResponse = await app.inject({ method: 'GET', url: shortPath });
      assert.equal(readResponse.statusCode, 200);
      assert.equal(readResponse.headers['content-type'], 'image/png');
      assert.equal(readResponse.rawPayload.length, fixtures.png.length);
    } finally {
      await close();
    }
  });
});

test('GET /m/:code com código malformado retorna 400', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/m/../../etc/passwd' });
    assert.ok([400, 404].includes(response.statusCode));
  } finally {
    await close();
  }
});

test('GET /m/:code com código bem formado mas inexistente retorna 404', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({ method: 'GET', url: `/m/${'a'.repeat(22)}` });
    assert.equal(response.statusCode, 404);
  } finally {
    await close();
  }
});

test('link curto expira junto com a mídia e some depois do TTL', async () => {
  await withFixtures(async () => {
    const { app, close } = await createTestApp({ envOverrides: { MEDIA_TTL_SECONDS: '1' } });
    try {
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/v1/media/images',
        headers: multipartHeaders(),
        payload: buildMultipartBody([{ name: 'file', filename: 'a.png', content: fixtures.png }]),
      });
      const { shortPath } = uploadResponse.json().data;

      await sleep(1100);

      const response = await app.inject({ method: 'GET', url: shortPath });
      assert.equal(response.statusCode, 404);
    } finally {
      await close();
    }
  });
});

test('link curto é revogado ao apagar a mídia diretamente do storage', async () => {
  await withFixtures(async () => {
    const { app, close, tempStorage } = await createTestApp();
    try {
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/v1/media/images',
        headers: multipartHeaders(),
        payload: buildMultipartBody([{ name: 'file', filename: 'a.png', content: fixtures.png }]),
      });
      const { mediaId, shortPath } = uploadResponse.json().data;

      await tempStorage.delete(mediaId);

      const response = await app.inject({ method: 'GET', url: shortPath });
      assert.equal(response.statusCode, 404);
    } finally {
      await close();
    }
  });
});

test('upload genérico via /v1/media não gera link curto público', async () => {
  const { app, close } = await createTestApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: multipartHeaders(),
      payload: buildMultipartBody([{ name: 'file', filename: 'a.txt', content: Buffer.from('conteudo qualquer') }]),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal('shortPath' in body.data, false);
    assert.equal('shortUrl' in body.data, false);
    assert.equal('kind' in body.data, false);
  } finally {
    await close();
  }
});

test('logs de GET /m/:code nunca incluem o código em claro', async () => {
  await withFixtures(async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    const logger = buildLogger({ logLevel: 'info', logPretty: false }, destination);

    const { app, close } = await createTestApp({ logger });
    try {
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/v1/media/images',
        headers: multipartHeaders(),
        payload: buildMultipartBody([{ name: 'file', filename: 'a.png', content: fixtures.png }]),
      });
      const { shortPath } = uploadResponse.json().data;
      const code = shortPath.replace('/m/', '');

      await app.inject({ method: 'GET', url: shortPath });

      const output = lines.join('\n');
      assert.equal(output.includes(code), false);
    } finally {
      await close();
    }
  });
});
