import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp, { type OverlayOptions } from 'sharp';

import type { WelcomeCardInput } from './contracts.ts';
import { truncateCanvasText } from './text.ts';
import { SOCIAL_CARD_MAX_INPUT_PIXELS, type VisualMediaMap } from './renderSocialCard.ts';
import { vectorTextSvg } from './vectorText.ts';

export const WELCOME_CARD_WIDTH = 1536;
export const WELCOME_CARD_HEIGHT = 1024;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKGROUND_PATHS = {
  join: path.resolve(moduleDir, '../../assets/social-canvas/welcome-default.png'),
  leave: path.resolve(moduleDir, '../../assets/social-canvas/leave-default.png'),
} as const;

/**
 * Centro/raio do portal em círculo já pintado em cada arte oficial (medido
 * diretamente nos PNGs de origem, em `assets/social-canvas/`). O avatar
 * precisa cair exatamente aqui — join e leave são ilustrações distintas,
 * então a moldura não fica no mesmo lugar nas duas.
 */
const PORTAL_GEOMETRY = {
  join: { cx: 333, cy: 499, r: 216 },
  leave: { cx: 368, cy: 444, r: 240 },
} as const;

/** Usado só quando `backgroundMediaId` substitui a arte oficial (sem portal conhecido). */
const FALLBACK_AVATAR_GEOMETRY = { cx: 333, cy: 480, r: 210 };

/**
 * Cacheia o background já rasterizado, não apenas os bytes do PNG. Isso evita
 * repetir o custo de decode/resize em todo evento de entrada/saída.
 */
const backgroundCache = new Map<'join' | 'leave', Promise<Buffer>>();

function loadDefaultBackground(event: 'join' | 'leave'): Promise<Buffer> {
  const cached = backgroundCache.get(event);
  if (cached) return cached;

  const pending = fs.readFile(DEFAULT_BACKGROUND_PATHS[event])
    .then((source) => sharp(source, {
      limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS,
      failOn: 'error',
    })
      .resize(WELCOME_CARD_WIDTH, WELCOME_CARD_HEIGHT, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 6, adaptiveFiltering: true })
      .toBuffer())
    .catch((error) => {
      backgroundCache.delete(event);
      throw error;
    });

  backgroundCache.set(event, pending);
  return pending;
}

function buildOverlay(input: WelcomeCardInput, customBackground: boolean): Buffer {
  const event = input.event === 'leave' ? 'leave' : 'join';
  const accent = event === 'join' ? '#c2a05b' : '#a98cc8';
  const accentSoft = event === 'join' ? '#8e6cd1' : '#80649f';
  const eventLabel = event === 'join' ? 'BEM-VINDO(A)' : 'ATÉ LOGO';
  const defaultHeadline = event === 'join'
    ? 'Que sua jornada aqui seja incrível.'
    : 'Obrigado por fazer parte da nossa história.';
  const headline = truncateCanvasText(input.headline || defaultHeadline, 56);
  const memberName = truncateCanvasText(input.name, 26);
  const groupName = truncateCanvasText(input.groupName, 34);
  const memberCount = event === 'join'
    ? `Agora somos ${input.memberCount.toLocaleString('pt-BR')} membros`
    : `${input.memberCount.toLocaleString('pt-BR')} membros seguem no grupo`;

  // painel de texto: ocupa a metade direita, ao lado do portal da arte.
  // Cada bloco reserva topo/altura fixos com folga deliberada pro próximo,
  // já que a fonte vetorial própria desenha do "y" (topo) até "y + height".
  const panelX = 656;
  const panelY = 366;
  const panelWidth = 824;
  const panelHeight = 388;
  const textX = panelX + 40;
  const textMaxWidth = panelWidth - 80;

  const badgeY = panelY + 36;
  const nameY = panelY + 114;
  const nameH = 58;
  const headlineY = nameY + nameH + 20;
  const headlineH = 24;
  const dividerY = headlineY + headlineH + 16;
  const groupY = dividerY + 20;
  const groupH = 32;
  const countY = groupY + groupH + 16;
  const countH = 20;
  const watermarkY = countY + countH + 22;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" viewBox="0 0 ${WELCOME_CARD_WIDTH} ${WELCOME_CARD_HEIGHT}">
  <rect width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" fill="#050507" opacity="${customBackground ? '.34' : '.02'}"/>
  <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="28" fill="#09080d" fill-opacity=".82" stroke="${accentSoft}" stroke-opacity=".6" stroke-width="2"/>
  <rect x="${textX}" y="${badgeY}" width="216" height="40" rx="20" fill="${accent}"/>
  ${vectorTextSvg(eventLabel, { x: textX + 108, y: badgeY + 10, maxWidth: 196, height: 20, color: '#0d0a07', anchor: 'middle', strokeRatio: .46 })}
  ${vectorTextSvg(memberName, { x: textX, y: nameY, maxWidth: textMaxWidth, height: nameH, color: '#f3eff7', anchor: 'start', strokeRatio: .38, shadow: true })}
  ${vectorTextSvg(headline, { x: textX, y: headlineY, maxWidth: textMaxWidth, height: headlineH, color: '#c8b8d5', anchor: 'start', strokeRatio: .38 })}
  <path d="M${textX} ${dividerY}H${textX + textMaxWidth}" stroke="${accent}" stroke-opacity=".4" stroke-width="2"/>
  ${vectorTextSvg(groupName, { x: textX, y: groupY, maxWidth: textMaxWidth, height: groupH, color: '#d8b7ec', anchor: 'start', strokeRatio: .38 })}
  ${vectorTextSvg(memberCount, { x: textX, y: countY, maxWidth: textMaxWidth, height: countH, color: '#d6d0db', anchor: 'start', strokeRatio: .38 })}
  ${vectorTextSvg('GYOMEI · NAZUNA BOT', { x: textX, y: watermarkY, maxWidth: textMaxWidth, height: 14, color: accent, anchor: 'start', strokeRatio: .36, opacity: .82 })}
</svg>`;

  return Buffer.from(svg);
}

async function roundedAvatar(buffer: Buffer, size: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(buffer, { limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'attention' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
}

async function normalizeCustomBackground(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, {
    limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS,
    failOn: 'error',
  })
    .rotate()
    .resize(WELCOME_CARD_WIDTH, WELCOME_CARD_HEIGHT, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
}

export async function renderWelcomeCardV2(
  input: WelcomeCardInput,
  media: VisualMediaMap = new Map(),
): Promise<Buffer> {
  const customBackground = input.backgroundMediaId ? media.get(input.backgroundMediaId) : undefined;
  const base = customBackground
    ? await normalizeCustomBackground(customBackground)
    : await loadDefaultBackground(input.event);

  const overlays: OverlayOptions[] = [{ input: buildOverlay(input, Boolean(customBackground)) }];

  if (input.avatarMediaId) {
    const avatarSource = media.get(input.avatarMediaId);
    if (avatarSource) {
      const geometry = customBackground
        ? FALLBACK_AVATAR_GEOMETRY
        : PORTAL_GEOMETRY[input.event === 'leave' ? 'leave' : 'join'];
      const avatarSize = geometry.r * 2;
      const avatar = await roundedAvatar(avatarSource, avatarSize);
      overlays.push({
        input: avatar,
        left: Math.round(geometry.cx - geometry.r),
        top: Math.round(geometry.cy - geometry.r),
      });
    }
  }

  return sharp(base, { limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS, failOn: 'error' })
    .composite(overlays)
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
}
