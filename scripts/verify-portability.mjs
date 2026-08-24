#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const requiredFiles = [
  'scripts/install-termux.sh',
  'scripts/install-linux.sh',
  'scripts/install-macos.sh',
  'scripts/install-windows.ps1',
  'scripts/setup-local.mjs',
  '.env.example',
  'package-lock.json',
];

for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(root, relativePath))) failures.push(`arquivo ausente: ${relativePath}`);
}

const lockPath = path.join(root, 'package-lock.json');
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf8');
  const requiredLockEntries = [
    'node_modules/@esbuild/android-arm64',
    'node_modules/@esbuild/android-x64',
    'node_modules/@img/sharp-wasm32',
    'node_modules/sharp',
  ];
  for (const entry of requiredLockEntries) {
    if (!lock.includes(`\"${entry}\"`)) failures.push(`lockfile sem suporte esperado: ${entry}`);
  }
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 12)) failures.push(`Node.js ${process.versions.node} abaixo de 20.12.0`);

if (failures.length > 0) {
  console.error('[BunnyFy] contrato de portabilidade falhou:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[BunnyFy] contrato de portabilidade OK.');
console.log(`[BunnyFy] plataforma do runner: ${process.platform}/${process.arch} · Node ${process.versions.node}`);
