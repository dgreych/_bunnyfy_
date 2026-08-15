import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'provision-gyomei-key.ts');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TEMPORARY_BASE_URL = 'http://node1.vexhost.com.br:20072';
const MEDIA_SIGNING_SECRET = 'segredo-local-de-teste-com-mais-de-32-caracteres';

function readEnvValue(content: string, name: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${name}\\s*=(.*)$`).exec(line);
    if (match) return match[1]!.trim();
  }
  return undefined;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-provision-test-'));
  const apiDir = path.join(root, 'api');
  const botDir = path.join(root, 'bot');
  await mkdir(apiDir, { recursive: true });
  await mkdir(botDir, { recursive: true });
  await writeFile(path.join(apiDir, 'package.json'), JSON.stringify({ name: 'bunnyfy' }), 'utf8');
  await writeFile(path.join(botDir, 'package.json'), JSON.stringify({ name: 'nazuna-gyomei' }), 'utf8');
  await writeFile(
    path.join(apiDir, '.env'),
    `BUNNYFY_API_KEYS=[]\nMEDIA_SIGNING_SECRET=${MEDIA_SIGNING_SECRET}\n`,
    'utf8',
  );
  return { root, apiDir, botDir };
}

function provision(apiDir: string, botDir: string, extraArgs: string[]) {
  return spawnSync(
    process.execPath,
    [TSX, SCRIPT, '--api-dir', apiDir, '--bot-dir', botDir, ...extraArgs],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  );
}

test('youtube-only cria chave mínima sem expor segredo e mantém integração desligada', async () => {
  const fx = await fixture();
  try {
    const result = provision(fx.apiDir, fx.botDir, [
      '--base-url',
      TEMPORARY_BASE_URL,
      '--youtube-only',
      '--allow-insecure-http',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /integração permanece desativada/i);

    const apiEnv = await readFile(path.join(fx.apiDir, '.env'), 'utf8');
    const botEnv = await readFile(path.join(fx.botDir, '.env.local'), 'utf8');
    const rawDefinitions = readEnvValue(apiEnv, 'BUNNYFY_API_KEYS');
    assert.ok(rawDefinitions);

    const definitions = JSON.parse(rawDefinitions);
    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].id, 'gyomei-production');
    assert.deepEqual(definitions[0].scopes, ['downloads:write']);

    const token = definitions[0].key;
    assert.match(token, /^bf_live_[A-Za-z0-9_-]{32,256}$/);
    assert.equal(readEnvValue(botEnv, 'BUNNYFY_API_TOKEN'), token);
    assert.equal(readEnvValue(botEnv, 'BUNNYFY_BASE_URL'), TEMPORARY_BASE_URL);
    assert.equal(readEnvValue(botEnv, 'BUNNYFY_ENABLED'), 'false');
    assert.equal(readEnvValue(botEnv, 'BUNNYFY_ALLOW_INSECURE_HTTP'), 'true');
    assert.equal(readEnvValue(botEnv, 'BUNNYFY_AI_MODE'), 'off');
    assert.equal(readEnvValue(botEnv, 'BUNNYFY_YOUTUBE_MODE'), 'exclusive');
    assert.equal(result.stdout.includes(token), false);
    assert.equal(result.stderr.includes(token), false);
    assert.equal((await stat(path.join(fx.apiDir, '.env'))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(fx.botDir, '.env.local'))).mode & 0o777, 0o600);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('HTTP público continua recusado sem flag ou fora da allocation exata', async () => {
  const cases = [
    ['--base-url', TEMPORARY_BASE_URL, '--youtube-only'],
    ['--base-url', 'http://node1.vexhost.com.br:20073', '--youtube-only', '--allow-insecure-http'],
    ['--base-url', 'http://outro.vexhost.com.br:20072', '--youtube-only', '--allow-insecure-http'],
  ];

  for (const args of cases) {
    const fx = await fixture();
    try {
      const before = await readFile(path.join(fx.apiDir, '.env'), 'utf8');
      const result = provision(fx.apiDir, fx.botDir, args);
      assert.notEqual(result.status, 0);
      assert.equal(await readFile(path.join(fx.apiDir, '.env'), 'utf8'), before);
      await assert.rejects(
        () => readFile(path.join(fx.botDir, '.env.local'), 'utf8'),
        error => (error as NodeJS.ErrnoException).code === 'ENOENT',
      );
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  }
});
