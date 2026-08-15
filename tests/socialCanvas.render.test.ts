import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import {
  achievementCardSchema,
  compatibilityCardSchema,
  escapeXml,
  profileCardSchema,
  rankingCardSchema,
  renderSocialCard,
  SOCIAL_CARD_HEIGHT,
  SOCIAL_CARD_WIDTH,
  truncateCanvasText,
  welcomeCardSchema,
  type SocialCardKind,
  type SocialCardInput,
} from '../src/canvas/index.ts';

const CASES: Array<{ kind: SocialCardKind; input: SocialCardInput }> = [
  {
    kind: 'welcome',
    input: welcomeCardSchema.parse({ event: 'join', name: 'Maurício', groupName: 'Gyomei Tavern', memberCount: 248 }),
  },
  {
    kind: 'profile',
    input: profileCardSchema.parse({
      name: 'Membro', handle: '@membro', bio: 'Sempre presente no grupo', level: 12,
      xp: 840, nextLevelXp: 1000, rank: 4, stats: [{ label: 'Mensagens', value: 2430 }], theme: 'ocean',
    }),
  },
  {
    kind: 'compatibility',
    input: compatibilityCardSchema.parse({
      left: { name: 'Ana' }, right: { name: 'Bia' }, score: 87,
      label: 'Dupla lendária', caption: 'Sintonia detectada', theme: 'sakura',
    }),
  },
  {
    kind: 'ranking',
    input: rankingCardSchema.parse({
      title: 'Mais ativos da semana', subtitle: 'Grupo Exemplo', unit: 'pontos', theme: 'emerald',
      entries: Array.from({ length: 10 }, (_, index) => ({ name: `Membro ${index + 1}`, value: 1000 - index * 50 })),
    }),
  },
  {
    kind: 'achievement',
    input: achievementCardSchema.parse({
      name: 'Aventureiro', title: 'Explorador', description: 'Completou 100 explorações',
      progress: 100, rarity: 'epic', unlocked: true, theme: 'sunset',
    }),
  },
];

for (const cardCase of CASES) {
  test(`renderiza ${cardCase.kind} como PNG 1200x675`, async () => {
    const output = await renderSocialCard(cardCase.kind, cardCase.input);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, SOCIAL_CARD_WIDTH);
    assert.equal(metadata.height, SOCIAL_CARD_HEIGHT);
    assert.ok(output.length > 20_000);
  });
}

test('compõe avatar válido sem alterar as dimensões', async () => {
  const avatar = await sharp({ create: { width: 320, height: 320, channels: 4, background: '#ff3366' } }).png().toBuffer();
  const input = welcomeCardSchema.parse({
    event: 'join', name: 'Avatar Real', groupName: 'Grupo', memberCount: 10,
    avatarMediaId: 'avatar_media_123456', theme: 'obsidian',
  });
  const output = await renderSocialCard('welcome', input, new Map([['avatar_media_123456', avatar]]));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, SOCIAL_CARD_WIDTH);
  assert.equal(metadata.height, SOCIAL_CARD_HEIGHT);
  const center = await sharp(output).extract({ left: 206, top: 314, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(center[0]! > 220, 'o avatar rosa deve ocupar o centro do círculo');
  assert.ok(center[1]! < 100);
  assert.ok(center[2]! < 160);
});

test('welcome e leave usam banners temáticos padrão e aceitam fundo personalizado', async () => {
  const join = welcomeCardSchema.parse({ event: 'join', name: 'Entrada', groupName: 'Grupo', memberCount: 4 });
  const leave = welcomeCardSchema.parse({ event: 'leave', name: 'Saída', groupName: 'Grupo', memberCount: 3 });
  const [joinOutput, leaveOutput] = await Promise.all([
    renderSocialCard('welcome', join),
    renderSocialCard('welcome', leave),
  ]);
  assert.notDeepEqual(joinOutput, leaveOutput);

  const custom = await sharp({
    create: { width: 1200, height: 675, channels: 3, background: '#00ff00' },
  }).png().toBuffer();
  const customInput = welcomeCardSchema.parse({
    event: 'join', name: 'Entrada', groupName: 'Grupo', memberCount: 4,
    backgroundMediaId: 'background_media_123456',
  });
  const customOutput = await renderSocialCard(
    'welcome',
    customInput,
    new Map([['background_media_123456', custom]]),
  );
  assert.notDeepEqual(customOutput, joinOutput);
});

test('escapa conteúdo que poderia quebrar o SVG e remove controles', () => {
  const escaped = escapeXml('<script>"x" &\u0000 teste</script>');
  assert.equal(escaped.includes('<script>'), false);
  assert.equal(escaped.includes('\u0000'), false);
  assert.match(escaped, /&lt;script&gt;/);
  assert.match(escaped, /&amp;/);
});

test('trunca por caracteres Unicode sem quebrar emoji', () => {
  assert.equal(truncateCanvasText('😀😀😀😀😀', 4), '😀😀😀…');
});

test('contratos recusam tema livre, XP incoerente e ranking acima de dez', () => {
  assert.equal(welcomeCardSchema.safeParse({ event: 'join', name: 'A', groupName: 'G', memberCount: 1, theme: 'url(externo)' }).success, false);
  assert.equal(profileCardSchema.safeParse({ name: 'A', level: 1, xp: 20, nextLevelXp: 10 }).success, false);
  assert.equal(rankingCardSchema.safeParse({ title: 'Rank', entries: Array.from({ length: 11 }, (_, index) => ({ name: `M${index}`, value: index })) }).success, false);
  assert.equal(welcomeCardSchema.safeParse({ event: 'join', name: 'A', groupName: 'G', memberCount: 1, backgroundMediaId: '../arquivo' }).success, false);
});
