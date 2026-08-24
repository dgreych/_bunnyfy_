#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

missing=0
for cmd in git node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[BunnyFy] falta o comando: $cmd"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "[BunnyFy] instale os requisitos. Com Homebrew: brew install node git ffmpeg"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[BunnyFy] aviso: FFmpeg não encontrado. Use brew install ffmpeg para liberar recursos de mídia dependentes dele."
fi

node scripts/check-runtime.mjs
npm ci --include=optional --no-audit --no-fund
node -e "import('sharp').then(() => console.log('[BunnyFy] Sharp carregou com sucesso.')).catch((error) => { console.error(error); process.exit(1); })"
node scripts/setup-local.mjs
node scripts/verify-portability.mjs

echo "[BunnyFy] instalação concluída. Execute npm start."
