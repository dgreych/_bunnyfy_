# BunnyFy em Linux, Windows e macOS

O repositório público possui instaladores separados por plataforma. Todos usam o mesmo lockfile, validam Node.js, confirmam o carregamento do Sharp e criam um `.env` local seguro quando ele ainda não existe.

## Requisitos mínimos

- Git;
- Node.js 20.12 ou superior;
- npm.

FFmpeg é recomendado para as capacidades de mídia. yt-dlp, Deno, whisper.cpp e rembg só são necessários para os recursos que dependem deles.

## Linux

```bash
git clone https://github.com/dgreych/_bunnyfy_.git
cd _bunnyfy_
bash scripts/install-linux.sh
npm start
```

## macOS

Com Homebrew, os requisitos principais podem ser instalados com:

```bash
brew install node git ffmpeg
```

Depois:

```bash
git clone https://github.com/dgreych/_bunnyfy_.git
cd _bunnyfy_
bash scripts/install-macos.sh
npm start
```

## Windows

Instale Node.js 20.12+ e Git. FFmpeg é recomendado para mídia. Em PowerShell:

```powershell
git clone https://github.com/dgreych/_bunnyfy_.git
cd _bunnyfy_
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
npm start
```

## Teste do servidor

Com a BunnyFy em execução:

```text
GET http://127.0.0.1:8080/health
```

`/health` confirma que o processo HTTP está vivo. `/ready` detalha armazenamento, ferramentas, modelos e capacidades opcionais disponíveis no host.

## Configuração local

O instalador chama `scripts/setup-local.mjs`. Se não existir `.env`, ele parte de `.env.example` e substitui somente os marcadores obrigatórios por:

- uma chave `bf_test_...` aleatória para desenvolvimento local;
- um `MEDIA_SIGNING_SECRET` aleatório.

Ele nunca sobrescreve um `.env` existente.

## Produção

O bootstrap local existe para clone, estudo e desenvolvimento. Produção deve usar credenciais próprias, ambiente controlado e os mecanismos de deploy do projeto. Não reutilize a chave de teste criada pelo setup local como credencial de produção.

---

[← Voltar ao README](../../README.md)
