import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { welcomeCardSchema } from '../src/canvas/contracts.ts';
import {
  renderWelcomeCardV2,
  WELCOME_CARD_HEIGHT,
  WELCOME_CARD_WIDTH,
} from '../src/canvas/renderWelcomeCardV2.ts';
import { vectorTextSvg } from '../src/canvas/vectorText.ts';

test('welcome v2 renderiza default Gyomei nas dimensões do card', async () => {
  const input = welcomeCardSchema.parse({
    event: 'join',
    name: 'Maurício Almeida',
    groupName: 'Gyomei Tavern',
    memberCount: 248,
  });
  const output = await renderWelcomeCardV2(input);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, WELCOME_CARD_WIDTH);
  assert.equal(metadata.height, WELCOME_CARD_HEIGHT);
  assert.ok(output.length > 20_000);
});

test('leave v2 usa asset próprio e difere da entrada', async () => {
  const join = welcomeCardSchema.parse({
    event: 'join', name: 'Membro', groupName: 'Grupo', memberCount: 10,
  });
  const leave = welcomeCardSchema.parse({
    event: 'leave', name: 'Membro', groupName: 'Grupo', memberCount: 9,
  });
  const [joinOutput, leaveOutput] = await Promise.all([
    renderWelcomeCardV2(join),
    renderWelcomeCardV2(leave),
  ]);
  assert.notDeepEqual(joinOutput, leaveOutput);
});

test('welcome v2 centraliza avatar real', async () => {
  const avatar = await sharp({
    create: { width: 500, height: 500, channels: 4, background: '#ff3366' },
  }).png().toBuffer();
  const input = welcomeCardSchema.parse({
    event: 'join',
    name: 'Nome Real do Membro',
    groupName: 'Grupo Personalizado',
    memberCount: 123,
    avatarMediaId: 'avatar_media_123456',
  });
  const output = await renderWelcomeCardV2(
    input,
    new Map([['avatar_media_123456', avatar]]),
  );
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, WELCOME_CARD_WIDTH);
  assert.equal(metadata.height, WELCOME_CARD_HEIGHT);
  // Centro do portal medido na arte oficial de "join" (assets/social-canvas/welcome-default.png).
  const center = await sharp(output)
    .extract({ left: 333, top: 499, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok(center[0]! > 220, 'o avatar rosa deve ocupar o centro do portal da arte oficial');
  assert.ok(center[1]! < 100);
});

test('nome real altera bytes do banner sem depender de fonte do sistema', async () => {
  const first = welcomeCardSchema.parse({
    event: 'join', name: 'Maurício Almeida', groupName: 'Grupo', memberCount: 10,
  });
  const second = welcomeCardSchema.parse({
    event: 'join', name: 'Nome Dinâmico Diferente', groupName: 'Grupo', memberCount: 10,
  });
  const [firstOutput, secondOutput] = await Promise.all([
    renderWelcomeCardV2(first),
    renderWelcomeCardV2(second),
  ]);
  assert.notDeepEqual(firstOutput, secondOutput);
});

test('fonte vetorial própria gera somente paths e suporta diacríticos PT-BR', () => {
  const svg = vectorTextSvg('Maurício Çã Êxito', {
    x: 540,
    y: 100,
    maxWidth: 900,
    height: 60,
    color: '#ffffff',
  });
  assert.match(svg, /<path /);
  assert.doesNotMatch(svg, /<text\b/);
  assert.doesNotMatch(svg, /Maurício|Çã|Êxito/);
});

test('backgroundMediaId substitui o default e mantém a composição do card', async () => {
  const custom = await sharp({
    create: { width: 900, height: 900, channels: 3, background: '#00aa44' },
  }).png().toBuffer();
  const input = welcomeCardSchema.parse({
    event: 'join',
    name: 'Membro',
    groupName: 'Grupo',
    memberCount: 4,
    backgroundMediaId: 'background_media_123456',
  });
  const output = await renderWelcomeCardV2(
    input,
    new Map([['background_media_123456', custom]]),
  );
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, WELCOME_CARD_WIDTH);
  assert.equal(metadata.height, WELCOME_CARD_HEIGHT);
});
