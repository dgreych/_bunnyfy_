# Mídias de runtime da Gyomei Tavern

Este diretório contém apenas arquivos usados ou reservados para o runtime. Os
concept boards permanecem fora do projeto porque servem como referência, não
como interface final.

## Conjunto visual V2

Os três ativos principais ficam em `generated/`:

- `backgrounds/tavern_board_v2.png`: campo público panorâmico;
- `backgrounds/tavern_hand_v2.png`: mesa privada da mão;
- `cards/tavern_card_back_v2.png`: verso e textura-base das cartas.

`media-manifest.json` registra dimensões e SHA-256 dessas peças. O teste de
integridade falha se um arquivo for trocado, corrompido ou removido sem atualizar
conscientemente o manifesto.

## Demais diretórios

- `branding/`: marca e banners;
- `cards/`: molduras, versos anteriores, amostras e pack;
- `classes/`: emblemas das seis classes;
- `keywords/`: ícones das palavras-chave;
- `resources/`: vida, armadura, mana e moedas;
- `ui/`: painéis e botões;
- `modes/`, `ranks/`, `events/` e `share_cards/`: fases posteriores.

Todos os caminhos usados na Fase B são centralizados em
`rendering/TavernAssetRegistry.js`. Não espalhe caminhos de imagem pelos
comandos ou pelo motor de partida.

## Regras de atualização

1. use nome versionado para uma mudança visual incompatível;
2. confira a imagem em tamanho de celular;
3. mantenha textos e números fora do bitmap quando forem dados de partida;
4. atualize o registro e o manifesto;
5. rode `npm run test:tavern`;
6. confirme que a mão continua sendo enviada somente no privado.
