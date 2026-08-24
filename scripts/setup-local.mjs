#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envExamplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

if (!existsSync(envExamplePath)) {
  console.error('[BunnyFy] .env.example não foi encontrado. Clone incompleto.');
  process.exit(1);
}

if (existsSync(envPath)) {
  console.log('[BunnyFy] .env já existe. Mantendo a configuração atual.');
  process.exit(0);
}

const localKey = `bf_test_${randomBytes(32).toString('base64url')}`;
const mediaSecret = randomBytes(48).toString('base64url');
const apiKeys = JSON.stringify([
  {
    id: 'local-dev',
    key: localKey,
    scopes: ['*'],
  },
]);

let env = readFileSync(envExamplePath, 'utf8');
env = env.replace(/^BUNNYFY_API_KEYS=.*$/m, `BUNNYFY_API_KEYS=${apiKeys}`);
env = env.replace(/^MEDIA_SIGNING_SECRET=.*$/m, `MEDIA_SIGNING_SECRET=${mediaSecret}`);

if (/SUBSTITUA_POR_CHAVE_GERADA|troque-por-um-segredo/.test(env)) {
  console.error('[BunnyFy] Não foi possível substituir os segredos de exemplo.');
  process.exit(1);
}

writeFileSync(envPath, env, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

console.log('[BunnyFy] .env local criado com credenciais de teste aleatórias.');
console.log('[BunnyFy] A chave não foi impressa no terminal. Consulte BUNNYFY_API_KEYS no .env quando precisar testar uma rota autenticada.');
console.log('[BunnyFy] Próximo passo: npm start');
