$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$required = @('git', 'node', 'npm')
$missing = @()
foreach ($cmd in $required) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    $missing += $cmd
  }
}

if ($missing.Count -gt 0) {
  Write-Host "[BunnyFy] faltam comandos: $($missing -join ', ')"
  Write-Host '[BunnyFy] instale Git e Node.js 20.12+ e execute novamente.'
  exit 1
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host '[BunnyFy] aviso: FFmpeg não encontrado. O núcleo inicia, mas recursos que usam FFmpeg ficarão indisponíveis.'
}

node scripts/check-runtime.mjs
npm ci --include=optional --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node -e "import('sharp').then(() => console.log('[BunnyFy] Sharp carregou com sucesso.')).catch((error) => { console.error(error); process.exit(1); })"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node scripts/setup-local.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node scripts/verify-portability.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '[BunnyFy] instalação concluída. Execute npm start.'
