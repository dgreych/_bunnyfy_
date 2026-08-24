#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

pkg update -y
pkg install -y git nodejs-lts ffmpeg python termux-tools

if pkg install -y deno; then
  echo "[BunnyFy] Deno instalado para o fluxo de YouTube."
else
  echo "[BunnyFy] Deno não está disponível para esta arquitetura. O núcleo da API continua utilizável; configure outro runtime JS para YouTube se necessário."
fi

if python -m pip install --upgrade yt-dlp; then
  echo "[BunnyFy] yt-dlp instalado."
else
  echo "[BunnyFy] yt-dlp não pôde ser instalado agora. A API inicia mesmo assim, mas downloads que dependem dele ficarão indisponíveis até a correção."
fi

node scripts/check-runtime.mjs

npm ci --include=optional --no-audit --no-fund

node -e "import('sharp').then(() => console.log('[BunnyFy] Sharp carregou com sucesso.')).catch((error) => { console.error(error); process.exit(1); })"
node scripts/setup-local.mjs
node scripts/verify-portability.mjs

echo "[BunnyFy] instalação concluída. Execute termux-wake-lock e depois npm start."
