# BunnyFy no Android com Termux

Este guia cobre o **núcleo executável da API** em Android. A BunnyFy inicia, expõe `/health` e permite usar as capacidades cujas ferramentas externas estejam disponíveis no aparelho.

## O que funciona no desenho atual

A dependência `sharp` está em 0.35.3 e o lockfile público inclui o backend `@img/sharp-wasm32`, usado quando não existe binário nativo para Android. O lockfile também inclui os binários Android do esbuild usados pelo `tsx`.

Recursos externos continuam dependentes das ferramentas correspondentes:

- FFmpeg/ffprobe para mídia;
- yt-dlp + runtime JavaScript compatível para o fluxo direto de YouTube;
- whisper.cpp + modelo local para transcrição;
- rembg + modelo local para remoção de fundo;
- credenciais privadas para integrações que explicitamente exigem provedor.

A ausência desses componentes **não impede o servidor HTTP de iniciar**. O endpoint `/ready` mostra quais capacidades estão disponíveis no ambiente atual.

## 1. Instale o Termux

Prefira a linha tradicional do Termux:

- [F-Droid](https://f-droid.org/packages/com.termux/)
- [GitHub Releases](https://github.com/termux/termux-app/releases)

## 2. Atualize o ambiente

```bash
pkg update -y && pkg upgrade -y
```

## 3. Clone o repositório público

```bash
cd ~
git clone https://github.com/dgreych/_bunnyfy_.git
cd _bunnyfy_
```

O repositório é público. Não é necessário configurar chave SSH do GitHub apenas para clonar.

## 4. Execute o instalador Android

```bash
bash scripts/install-termux.sh
```

O script:

1. instala Git, Node.js LTS, FFmpeg, Python e `termux-tools`;
2. tenta instalar Deno e yt-dlp para ampliar o suporte de downloads;
3. executa `npm ci --include=optional`, preservando os backends opcionais de plataforma;
4. confirma que o Sharp realmente carrega;
5. cria um `.env` local válido com uma chave de teste e um segredo de assinatura aleatórios;
6. valida o contrato de portabilidade do lockfile.

O bootstrap **não imprime a chave da API no terminal**. Ela fica somente no `.env` local.

## 5. Mantenha o aparelho acordado e inicie

```bash
termux-wake-lock
npm start
```

Quando aparecer a mensagem de servidor iniciado, abra outra sessão do Termux e teste:

```bash
curl http://127.0.0.1:8080/health
```

A resposta deve indicar `status: ok`.

Para ver a disponibilidade das ferramentas opcionais:

```bash
curl http://127.0.0.1:8080/ready
```

`/ready` pode mostrar capacidades específicas como indisponíveis sem significar que o processo principal falhou.

## Usar uma rota autenticada no ambiente local

A chave gerada está em `BUNNYFY_API_KEYS` no arquivo `.env`. Não publique esse arquivo.

```bash
grep '^BUNNYFY_API_KEYS=' .env
```

Use a chave `bf_test_...` como Bearer somente em testes locais.

## Reiniciar depois

```bash
cd ~/_bunnyfy_
termux-wake-lock
npm start
```

## Atualizar

```bash
cd ~/_bunnyfy_
git pull --ff-only
npm ci --include=optional --no-audit --no-fund
npm run verify:portability
npm start
```

## Se o Sharp falhar

O instalador já testa o import após `npm ci`. Se ainda houver falha:

```bash
cd ~/_bunnyfy_
rm -rf node_modules
npm ci --include=optional --no-audit --no-fund
node -e "import('sharp').then(() => console.log('sharp ok')).catch(console.error)"
```

Não use `--omit=optional` no Termux. O backend WebAssembly do Sharp é justamente uma dependência opcional de plataforma.

## Limitações honestas

"Roda no Termux" significa que **o servidor BunnyFy e as capacidades compatíveis com o aparelho podem rodar ali**. Não significa que um Android passa magicamente a oferecer os mesmos binários e aceleração de um servidor Linux. Whisper, rembg e ferramentas pesadas podem exigir instalação adicional, mais RAM ou continuar mais adequadas a um host Linux.

---

[← Voltar ao README](../../README.md)
