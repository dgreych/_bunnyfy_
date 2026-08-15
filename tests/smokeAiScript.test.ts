import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

const tsxPath = path.resolve('node_modules', '.bin', 'tsx');
const scriptPath = path.resolve('scripts', 'smoke-ai-gateway.ts');

function runSmoke(baseUrl: string, token: string) {
  return spawnSync(tsxPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      PATH: process.env.PATH,
      BUNNYFY_SMOKE_BASE_URL: baseUrl,
      BUNNYFY_SMOKE_TOKEN: token,
    },
  });
}

test('smoke de IA rejeita URL malformada sem imprimir URL ou token', () => {
  const urlMarker = 'url-privada-nao-pode-vazar';
  const tokenMarker = 'token-privado-nao-pode-vazar';
  const result = runSmoke(`://${urlMarker}`, tokenMarker);

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(output.includes(urlMarker), false);
  assert.equal(output.includes(tokenMarker), false);
});

test('smoke de IA não envia Bearer por HTTP para host remoto', () => {
  const urlMarker = 'remote-private.example';
  const tokenMarker = 'token-remoto-nao-pode-vazar';
  const result = runSmoke(`http://${urlMarker}`, tokenMarker);

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(output.includes(urlMarker), false);
  assert.equal(output.includes(tokenMarker), false);
  assert.equal(output.includes('HTTPS ou HTTP local'), true);
});
