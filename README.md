# BunnyFy

API própria para bots, automações, mídia e experiências visuais. O Gyomei é o
primeiro consumidor e laboratório de integração, mas o contrato BunnyFy não é
específico dele. A plataforma combina armazenamento temporário, processamento
de áudio e imagem, Social Canvas e adaptadores internos de provedores sem
repassar credenciais ou envelopes de terceiros aos clientes.

O código atual está em maturidade de **laboratório**: as rotas implementadas
possuem contratos e testes locais, mas disponibilidade comercial e produção só
podem ser declaradas depois do deploy, preflight e smoke real de cada
capacidade.

## Dependências de runtime

- **Node.js 20.12 ou mais recente** — o primeiro ambiente de hospedagem está
  limitado à linha 20. Os fontes `.ts` são executados via `tsx`, sem etapa de
  build. Node 20 é uma compatibilidade temporária e deve ser migrado para uma
  linha LTS suportada quando o ambiente permitir.
- **yt-dlp 2026.07.04 ou mais recente** — usado pelo vertical de YouTube via
  subprocesso; o preflight recusa versões anteriores ao corte exercitado.
- **ffmpeg** — usado pelo yt-dlp e pela transcrição para extrair/normalizar áudio
  em WAV mono 16 kHz antes do whisper.cpp.
- **Deno 2.3.0 ou mais recente** — runtime JavaScript recomendado pelo yt-dlp
  para resolver os desafios atuais do YouTube. É um processo separado; a API
  pode continuar no Node 20 enquanto o host não migra sua linha LTS.
- **sharp** — renderiza localmente os cards do Social Canvas; o pacote instala o
  binário compatível com plataformas suportadas junto das dependências Node.
- **whisper.cpp (`whisper-cli`) + um modelo multilíngue `.bin`** — usado pela
  transcrição local de áudio. Nenhum dos dois entra no Git.
- **Acesso de rede ao provedor de IA configurado pela operação** — necessário
  somente quando `AI_CHAT_ENABLED=true`. Credencial, modelo e endpoint
  pertencem à BunnyFy e nunca ao bot consumidor.

Se `yt-dlp`, `ffmpeg`, Deno, `whisper-cli` ou o modelo não estiverem instalados, os
endpoints correspondentes respondem com erro estável
(`503 BUNNYFY_TOOL_UNAVAILABLE`) em vez de derrubar o processo. O restante da
API continua disponível.

## Instalação (Linux / container)

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y ffmpeg python3 build-essential cmake git curl

# Binário Unix oficial exercitado; EJS já vem incluído nessa distribuição.
BUNNYFY_YTDLP_VERSION=2026.07.04
sudo curl -fL "https://github.com/yt-dlp/yt-dlp/releases/download/${BUNNYFY_YTDLP_VERSION}/yt-dlp" \
  -o /usr/local/bin/yt-dlp
echo "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd  /usr/local/bin/yt-dlp" \
  | sha256sum -c -
sudo chmod 0755 /usr/local/bin/yt-dlp

# Instale Deno pela distribuição oficial e confirme que seja >= 2.3.0.
# https://docs.deno.com/runtime/getting_started/installation/

yt-dlp --version
ffmpeg -version
deno --version
```

Ao atualizar o `yt-dlp`, atualize também a versão mínima, checksum, testes e
smoke real. Pacotes de distribuição podem ficar defasados; o deploy usa o
binário oficial fixado. Se caminhos explícitos forem usados, configure
`YTDLP_PATH`, `FFMPEG_PATH` e `DENO_PATH`.

### whisper.cpp

Compile o `whisper-cli` e baixe um modelo multilíngue. Para PT-BR, não use a
variante `.en` como padrão.

```bash
git clone https://github.com/ggml-org/whisper.cpp /opt/whisper.cpp
cmake -B /opt/whisper.cpp/build -S /opt/whisper.cpp
cmake --build /opt/whisper.cpp/build --config Release -j
sudo ln -s /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli

mkdir -p ./models
/opt/whisper.cpp/models/download-ggml-model.sh base ./models
# gera ./models/ggml-base.bin
```

`models/` está no `.gitignore`. Ajuste `WHISPER_CLI_PATH` e
`WHISPER_MODEL_PATH` no ambiente se usar outro caminho ou modelo.

## Clone e configuração

O repositório é a fonte oficial do deploy. Não copie `node_modules` de outra
máquina.

```bash
git clone git@github.com:dgreych/_bunnyfy_.git
cd _bunnyfy_
npm ci
cp .env.example .env
```

O repositório é privado. O clone no servidor precisa usar uma identidade do
GitHub autorizada, como deploy key somente leitura ou credencial de máquina com
o menor privilégio possível. Não coloque essa credencial no repositório, em URL
de clone, log ou variável exposta ao processo da API.

A BunnyFy carrega `.env` automaticamente quando o arquivo existe. Em produção,
variáveis já injetadas pelo painel/orquestrador continuam válidas e têm
precedência; não é obrigatório manter um `.env` no servidor se o ambiente já
for configurado externamente.

Nunca versione o `.env` real. Chaves e segredos devem ser gerados e
provisionados por um fluxo privado que não os imprima em log, histórico de
shell, documentação ou resposta de automação.

## Autenticação e escopos

Clientes usam `Authorization: Bearer <chave>`. A configuração moderna é
`BUNNYFY_API_KEYS`, um JSON privado com registros no formato conceitual
`id`, `key` e `scopes`. Chaves começam com `bf_test_` ou `bf_live_`; o registro
mantém apenas o digest SHA-256 em memória depois do boot, junto do identificador,
ambiente e escopos não secretos.

Escopos implementados:

| Escopo | Capacidades |
|---|---|
| `media:write` | uploads temporários e visuais |
| `media:read` | leitura autenticada de mídia |
| `downloads:write` | downloads de YouTube |
| `audio:write` | transcrição |
| `images:write` | remoção de fundo e upscale |
| `canvas:write` | Social Canvas |
| `ai:chat` | conversa pelo gateway interno |

Também são aceitos `*` e curingas de família como `images:*`. Uma chave ausente,
inválida ou sem o escopo exigido recebe o mesmo `401 BUNNYFY_AUTH_FAILED`. A
variável legada `BUNNYFY_API_TOKENS` existe somente para migração e concede
escopo amplo; novos consumidores não devem usá-la.

## Pré-deploy

Antes de iniciar um ambiente novo, execute:

```bash
npm run preflight
```

O preflight carrega `.env` quando existir e reporta apenas estado seguro, nunca o
valor de segredos. Ele verifica runtime, npm, plataforma, arquitetura, diretório
de mídia, presença das configurações obrigatórias e disponibilidade de
`yt-dlp`, `ffmpeg`, Deno, `whisper-cli` e modelo Whisper. Para YouTube, a
readiness exige `yt-dlp >= 2026.07.04`, Deno `>= 2.3.0` e ffmpeg.

O resultado separa o núcleo necessário para iniciar das capacidades opcionais.
Um `preflight` verde não substitui os smoke tests reais de cada vertical.

## Rodando

```bash
npm run dev     # watch local via tsx
npm start       # produção via tsx, sem etapa de build
```

Antes de `dev`, `start` e `verify`, o projeto valida explicitamente a versão do
Node. O servidor sobe em `HOST:PORT` (padrão `0.0.0.0:8080`). `GET /health` e
`GET /ready` não exigem autenticação; todo o restante sob `/v1` exige
`Authorization: Bearer <chave>` com o escopo da rota.

## Limites de recursos

Uploads e JSON possuem tetos separados. Os valores padrão podem ser ajustados
por ambiente:

- `JSON_BODY_MAX_BYTES`: 1 MiB;
- `MEDIA_MAX_BYTES`: 100 MiB;
- `DOWNLOAD_MAX_BYTES`: 200 MiB por artefato final de download;
- `YOUTUBE_DOWNLOAD_MAX_CONCURRENCY`: 2 operações por processo;
- `YOUTUBE_DOWNLOAD_TIMEOUT_MS`: 120 segundos;
- `TRANSCRIPTION_MAX_INPUT_BYTES`: 50 MiB;
- `TRANSCRIPTION_MAX_CONCURRENCY`: 2;
- `CANVAS_MAX_CONCURRENCY`: 2;
- `CANVAS_MAX_AVATAR_BYTES`: 5 MiB por avatar;
- `CANVAS_MAX_TOTAL_AVATAR_BYTES`: 20 MiB por renderização;
- `CANVAS_MAX_OUTPUT_BYTES`: 10 MiB;
- `AI_CHAT_TIMEOUT_MS`: 120 segundos;
- `AI_CHAT_MAX_CONCURRENCY`: 2 conversas por processo;
- `AI_CHAT_MAX_CONCURRENCY_PER_CONSUMER`: 1 conversa por identidade de chave;
- `AI_CHAT_MAX_REQUESTS_PER_MINUTE`: 30 conversas por minuto por processo;
- `AI_CHAT_MAX_REQUESTS_PER_MINUTE_PER_CONSUMER`: 10 conversas por minuto por
  identidade de chave;
- `AI_CHAT_MAX_MESSAGES`: 24 mensagens;
- `AI_CHAT_MAX_MESSAGE_CHARS`: 16.000 caracteres por mensagem;
- `AI_CHAT_MAX_TOTAL_CHARS`: 48.000 caracteres por requisição;
- `AI_CHAT_MAX_OUTPUT_TOKENS`: 2.000 tokens por resposta;
- `AI_CHAT_MAX_RESPONSE_BYTES`: 1 MiB de resposta do adaptador.

Na conversa, `temperature` aceita de `0` a `1` e usa `0.7` por padrão. O limite
de saída solicitado pelo cliente não pode ultrapassar o teto configurado. A IA
combina limites globais com limites por `apiKeyPrincipal.id`; ambos são locais
ao processo. Coordenação distribuída entre réplicas pertence ao futuro control
plane.

Entradas remotas de transcrição são gravadas por streaming em arquivo temporário
com teto durante a transferência, sem carregar o corpo inteiro em memória.

## Verificação

```bash
npm run typecheck
npm run lint
npm run test        # node:test executado via tsx
npm run verify      # typecheck + lint + testes
```

A suíte evita rede real nas verificações de contrato e segurança. Testes que
exercitam `ffmpeg` de verdade continuam exigindo o binário instalado. O smoke de
produção com `yt-dlp`, `ffmpeg`, `whisper-cli` e modelo real é uma etapa separada
do deploy e não deve ser substituído por mocks.

O workflow principal executa `npm ci` e `npm run verify` em Node 20.x. Resultados
históricos e o último gate integral ficam registrados no Contexto Mestre; todo
lote atual precisa de um novo gate antes de deploy.

## Endpoints

| Rota | Auth/escopo | Descrição |
|---|---|---|
| `GET /health` | não | liveness do processo |
| `GET /ready` | não | readiness do núcleo e diagnóstico seguro de ferramentas |
| `POST /v1/media` | `media:write` | upload multipart genérico, com mídia temporária assinada |
| `GET /v1/media/:id` | `media:read` ou assinatura | leitura da mídia armazenada |
| `POST /v1/media/images` | `media:write` | JPEG/PNG/GIF/WebP detectados pelos bytes reais e link curto opcional |
| `GET /m/:code` | código opaco | leitura pública temporária de imagem explicitamente registrada |
| `POST /v1/downloads/youtube/audio` | `downloads:write` | download/extração de áudio por URL ou busca textual |
| `POST /v1/downloads/youtube/video` | `downloads:write` | download de vídeo por URL ou busca textual |
| `POST /v1/audio/transcriptions` | `audio:write` | transcrição local via whisper.cpp |
| `POST /v1/images/remove-background` | `images:write` | remoção local de fundo |
| `POST /v1/images/upscale` | `images:write` | upscale local 2x/4x |
| `POST /v1/images/welcome-card` | `canvas:write` | card de entrada/saída |
| `POST /v1/images/profile-card` | `canvas:write` | card de perfil |
| `POST /v1/images/compatibility-card` | `canvas:write` | card de compatibilidade |
| `POST /v1/images/ranking-card` | `canvas:write` | ranking visual |
| `POST /v1/images/achievement-card` | `canvas:write` | card de conquista |
| `POST /v1/ai/chat/completions` | `ai:chat` | conversa pelo adaptador interno, atualmente em laboratório |

Toda resposta segue o envelope canônico `ok/data/error/meta`.

### Exemplo — upload de imagem

```bash
curl -s -X POST http://localhost:8080/v1/media/images \
  -H "Authorization: Bearer $BUNNYFY_TOKEN" \
  -F "file=@avatar.png"
```

A resposta inclui `mediaId`, `mediaUrl`, `expiresAt`, MIME/tamanho e, para essa
rota visual, `shortPath` e `shortUrl`.

### Exemplo — busca e download do YouTube

```bash
curl -s -X POST http://localhost:8080/v1/downloads/youtube/audio \
  -H "Authorization: Bearer $BUNNYFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"nome da música","quality":"best"}'
```

O corpo informa exatamente um entre `query` e `url`. A consulta tem até 200
caracteres e não é devolvida na resposta nem registrada em log. Áudio aceita
`best`; vídeo aceita `360p`, `480p`, `720p`, `1080p` ou `best`. Lives, estreias,
mídias sem duração conhecida e conteúdos acima de 1.800 segundos são recusados.
URL direta precisa ser HTTPS, sem porta, e identificar um único vídeo pelas
formas `watch`, `shorts`, `live`, `embed` ou `youtu.be`; a API extrai o ID e
reconstrói uma URL canônica antes do subprocesso. URLs de busca, playlist,
redirect e canais são recusadas.

O resultado contém o descritor temporário em `data.media`, além de título,
duração e thumbnail quando disponível.

### Exemplo — transcrição

```bash
curl -s -X POST http://localhost:8080/v1/audio/transcriptions \
  -H "Authorization: Bearer $BUNNYFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mediaId":"opaco-de-um-upload-anterior","language":"pt"}'
```

### Exemplo — conversa pelo gateway interno

```bash
curl -s -X POST http://localhost:8080/v1/ai/chat/completions \
  -H "Authorization: Bearer $BUNNYFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Resuma em uma frase."}]}'
```

A entrada aceita `messages`, `temperature`, `maxOutputTokens` e `model`
opcional. Quando omitido, vale `NVIDIA_MODEL`; quando enviado, o identificador
precisa pertencer a `NVIDIA_ALLOWED_MODELS`, que é a autoridade final mesmo que
o bot também mantenha um catálogo local. Se a lista não for configurada, apenas
o modelo padrão é permitido; quando for explícita, ela não pode ter duplicatas
e precisa conter o padrão. O cliente não escolhe provedor, endpoint, headers,
ferramentas ou streaming.

A resposta expõe apenas `text`, `finishReason` e `usage` no envelope BunnyFy;
o modelo não é devolvido nem incluído nos logs da capacidade. O adaptador
realiza uma tentativa externa por requisição; por enquanto o cliente Gyomei
também deve fazer uma única tentativa e não enviar `Idempotency-Key` nessa
rota. Retry/deduplicação só entram depois de existir um contrato próprio
testado.

O gateway foi validado por transporte injetado nos testes locais. Esta
documentação não afirma smoke externo nem disponibilidade na hospedagem.

### Integração administrativa no Gyomei

O comando `!modeloia` continua disponível, mas não amplia a autorização da API.
Em grupos, somente o dono ou um administrador real pode escolher um item do
catálogo conhecido no bot, e a escolha é persistida apenas para aquele grupo.
Fora de grupo, somente o dono altera o padrão. A BunnyFy reaplica
`NVIDIA_ALLOWED_MODELS` e recusa qualquer modelo não listado antes de chamar o
adaptador.

O comando `!setnvidia` não recebe mais credencial de provedor pelo WhatsApp. No
modo BunnyFy exclusivo, ausência ou recusa da chave de acesso gera uma mensagem
de marca BunnyFy nos comandos consumidores. `BUNNYFY_ACCOUNT_URL` é opcional,
só deve ser preenchida com HTTPS e permanece vazia enquanto não houver uma
página comercial real; sua presença futura não transforma o estado de
laboratório em oferta ativa.

## Segurança implementada

- Chaves identificáveis são reduzidas a digest e comparadas em tempo constante;
  autorização exige o escopo da rota.
- Downloads HTTP executados pelo transporte interno passam pela política SSRF
  central. O hostname é resolvido e validado, e a conexão HTTP/HTTPS é fixada
  no mesmo IP aprovado,
  preservando Host e TLS/SNI do hostname original. Cada redirecionamento repete
  resolução, validação e pinning do zero. Cabeçalhos `Host` e `Connection` não
  podem ser sobrescritos pelo chamador.
- Armazenamento temporário usa IDs opacos, arquivos com permissões restritas,
  limite de tamanho e TTL. O startup/sweeper remove de forma conservadora apenas
  órfãos com nomes internos reconhecidos e vencidos, preservando arquivos
  arbitrários que por engano existam no mesmo diretório.
- Arquivos produzidos por ferramentas externas têm o tamanho final revalidado
  antes de serem registrados.
- O vertical YouTube aceita URL validada ou busca textual limitada, nunca ambas;
  reduz URL do cliente a um ID/URL canônica, usa somente o primeiro resultado
  da busca, aplica allowlist de qualidade, recusa lives e duração acima de
  1.800 segundos, exige versões mínimas de yt-dlp/Deno, limita concorrência e
  remove `.part` e sidecars do mesmo ID em erro, timeout ou finalização
  incompleta. O tráfego feito internamente pelo yt-dlp não usa o transporte SSRF
  central; o container precisa bloquear egress para loopback, redes privadas e
  metadata do provedor.
- `--max-filesize` e a revalidação final limitam o artefato publicado, mas não
  constituem quota rígida durante downloads fragmentados/merge. Antes de oferta
  comercial, faltam quota de disco por job/volume e limites por consumidor.
- Subprocessos usam argumentos em array, `shell: false` e timeout.
- Logs redigem autorização, tokens, assinaturas, cookies e códigos de links
  curtos.
- Imagens são identificadas pelos bytes reais, não por MIME/extensão declarados.
- Transcrição por `mediaId` só usa entrada existente e não expirada; entrada por
  URL usa transporte SSRF com IP fixado e streaming limitado para disco;
  intermediários são descartados.
- Transcrição e Social Canvas possuem limites de concorrência independentes.
- Social Canvas limita bytes por avatar, soma de avatares e tamanho da saída.
- O gateway de IA mantém credencial, endpoint, modelo padrão e allowlist no
  ambiente da API. O cliente pode pedir somente um identificador presente na
  allowlist; a rota limita entrada/saída, cancela no timeout ou desconexão e não
  registra prompt, resposta ou modelo selecionado.
- `SIGTERM`/`SIGINT` passam por desligamento gracioso com prazo máximo.

## Deploy

A preparação de deploy é tratada como tarefa técnica e só será considerada
concluída quando houver evidência de:

1. clone limpo no runtime alvo;
2. `npm ci` sem inconsistência;
3. `npm run verify` em Node 20;
4. `npm run preflight` no servidor real;
5. ferramentas externas provisionadas;
6. configuração/secrets fora do Git;
7. `npm start` reproduzível;
8. `/health` e `/ready` válidos;
9. smoke real dos recursos necessários;
10. rollback definido;
11. integração Gyomei gradual antes do corte definitivo.

## BunnyFy-site

O site vive em um repositório separado. Seu primeiro
lote já foi iniciado em segundo plano com landing e catálogo que distinguem
capacidade implementada de disponibilidade comercial. Não há deploy, venda de
chaves, planos ativos, cobrança ou painel de clientes nesta etapa; identidade
final, documentação pública e control plane continuam trabalhos separados.
