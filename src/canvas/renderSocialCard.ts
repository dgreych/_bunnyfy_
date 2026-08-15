import sharp, { type OverlayOptions } from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AchievementCardInput,
  CompatibilityCardInput,
  ProfileCardInput,
  RankingCardInput,
  SocialCardKind,
  SocialCardInput,
  WelcomeCardInput,
} from './contracts.ts';
import { SOCIAL_THEME_MAP, type SocialTheme } from './themes.ts';
import { displayNumber, escapeXml, initials, truncateCanvasText } from './text.ts';

export const SOCIAL_CARD_WIDTH = 1200;
export const SOCIAL_CARD_HEIGHT = 675;
export const SOCIAL_CARD_MAX_INPUT_PIXELS = 16_000_000;

export type VisualMediaMap = ReadonlyMap<string, Buffer>;
export type AvatarMap = VisualMediaMap;

interface AvatarPlacement {
  mediaId?: string;
  name: string;
  x: number;
  y: number;
  size: number;
}

interface CardComposition {
  svg: string;
  avatars: AvatarPlacement[];
  backgroundMediaId?: string;
  defaultBackground?: 'join' | 'leave';
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKGROUND_PATHS = {
  join: path.resolve(moduleDir, '../../assets/social-canvas/welcome-default.png'),
  leave: path.resolve(moduleDir, '../../assets/social-canvas/leave-default.png'),
} as const;
const defaultBackgroundCache = new Map<'join' | 'leave', Promise<Buffer>>();

function loadDefaultBackground(event: 'join' | 'leave'): Promise<Buffer> {
  const cached = defaultBackgroundCache.get(event);
  if (cached) return cached;
  const pending = fs.readFile(DEFAULT_BACKGROUND_PATHS[event]);
  defaultBackgroundCache.set(event, pending);
  return pending;
}

function shell(theme: SocialTheme, content: string, backgroundVisible = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOCIAL_CARD_WIDTH}" height="${SOCIAL_CARD_HEIGHT}" viewBox="0 0 ${SOCIAL_CARD_WIDTH} ${SOCIAL_CARD_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${theme.backgroundA}"/><stop offset="1" stop-color="${theme.backgroundB}"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="${theme.accent}" stop-opacity=".42"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000" flood-opacity=".38"/></filter>
    <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M42 0H0V42" fill="none" stroke="${theme.text}" stroke-opacity=".035"/></pattern>
  </defs>
  <rect width="1200" height="675" rx="32" fill="url(#bg)"${backgroundVisible ? ' opacity=".68"' : ''}/>
  <circle cx="1050" cy="90" r="310" fill="url(#glow)"/>
  <circle cx="90" cy="650" r="260" fill="url(#glow)" opacity=".45"/>
  <rect x="18" y="18" width="1164" height="639" rx="26" fill="url(#grid)" stroke="${theme.accent}" stroke-opacity=".34" stroke-width="2"/>
  ${content}
</svg>`;
}

function panel(theme: SocialTheme, x: number, y: number, width: number, height: number, radius = 24): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${theme.panel}" stroke="${theme.accent}" stroke-opacity=".24" filter="url(#shadow)"/>`;
}

function avatarFrame(theme: SocialTheme, placement: AvatarPlacement): string {
  const centerX = placement.x + placement.size / 2;
  const centerY = placement.y + placement.size / 2;
  const fontSize = Math.round(placement.size * 0.32);
  return `<circle cx="${centerX}" cy="${centerY}" r="${placement.size / 2 + 7}" fill="${theme.accent}" opacity=".92"/>
  <circle cx="${centerX}" cy="${centerY}" r="${placement.size / 2}" fill="${theme.panelStrong}"/>
  <text x="${centerX}" y="${centerY + fontSize * 0.34}" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="${fontSize}" font-weight="800" fill="${theme.text}">${escapeXml(initials(placement.name))}</text>`;
}

function welcomeComposition(input: WelcomeCardInput): CardComposition {
  const theme = SOCIAL_THEME_MAP[input.theme];
  const avatar: AvatarPlacement = { mediaId: input.avatarMediaId, name: input.name, x: 82, y: 190, size: 250 };
  const eventLabel = input.event === 'join' ? 'NOVA PRESENÇA' : 'ATÉ A PRÓXIMA';
  const defaultHeadline = input.event === 'join' ? 'Bem-vindo ao grupo' : 'Obrigado por fazer parte';
  const content = `${panel(theme, 48, 72, 1104, 531, 32)}
  <rect x="82" y="108" width="194" height="36" rx="18" fill="${theme.accent}"/>
  <text x="179" y="133" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="15" font-weight="900" letter-spacing="2" fill="${theme.backgroundA}">${eventLabel}</text>
  ${avatarFrame(theme, avatar)}
  <text x="382" y="228" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="28" font-weight="600" fill="${theme.muted}">${escapeXml(truncateCanvasText(input.headline || defaultHeadline, 44))}</text>
  <text x="382" y="304" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="58" font-weight="900" fill="${theme.text}">${escapeXml(truncateCanvasText(input.name, 28))}</text>
  <rect x="382" y="336" width="680" height="3" rx="2" fill="${theme.accent}" opacity=".75"/>
  <text x="382" y="401" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="30" font-weight="700" fill="${theme.text}">${escapeXml(truncateCanvasText(input.groupName, 42))}</text>
  <text x="382" y="453" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="22" fill="${theme.muted}">Agora somos ${input.memberCount.toLocaleString('pt-BR')} membros</text>
  <circle cx="1091" cy="548" r="18" fill="${theme.accent}"/><circle cx="1044" cy="548" r="9" fill="${theme.accent}" opacity=".52"/>`;
  return {
    svg: shell(theme, content, true),
    avatars: [avatar],
    backgroundMediaId: input.backgroundMediaId,
    defaultBackground: input.event,
  };
}

function profileComposition(input: ProfileCardInput): CardComposition {
  const theme = SOCIAL_THEME_MAP[input.theme];
  const avatar: AvatarPlacement = { mediaId: input.avatarMediaId, name: input.name, x: 74, y: 96, size: 220 };
  const ratio = Math.max(0, Math.min(1, input.xp / input.nextLevelXp));
  const stats = input.stats.map((stat, index) => {
    const x = 84 + index * 268;
    return `${panel(theme, x, 514, 244, 105, 18)}
      <text x="${x + 20}" y="550" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="16" font-weight="700" fill="${theme.muted}">${escapeXml(truncateCanvasText(stat.label, 18).toUpperCase())}</text>
      <text x="${x + 20}" y="594" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="30" font-weight="900" fill="${theme.text}">${escapeXml(displayNumber(stat.value))}</text>`;
  }).join('');
  const content = `${panel(theme, 48, 52, 1104, 407, 32)}
  ${avatarFrame(theme, avatar)}
  <text x="340" y="140" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="52" font-weight="900" fill="${theme.text}">${escapeXml(truncateCanvasText(input.name, 30))}</text>
  <text x="342" y="181" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="21" font-weight="600" fill="${theme.accent}">${escapeXml(truncateCanvasText(input.handle, 36))}</text>
  <text x="342" y="238" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="21" fill="${theme.muted}">${escapeXml(truncateCanvasText(input.bio || 'Sem bio definida', 74))}</text>
  <rect x="342" y="285" width="742" height="18" rx="9" fill="${theme.panelStrong}"/>
  <rect x="342" y="285" width="${Math.round(742 * ratio)}" height="18" rx="9" fill="${theme.accent}"/>
  <text x="342" y="338" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="20" font-weight="700" fill="${theme.text}">NÍVEL ${input.level}</text>
  <text x="1084" y="338" text-anchor="end" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="18" fill="${theme.muted}">${input.xp.toLocaleString('pt-BR')} / ${input.nextLevelXp.toLocaleString('pt-BR')} XP</text>
  ${input.rank ? `<text x="342" y="397" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="24" font-weight="800" fill="${theme.success}">RANK #${input.rank.toLocaleString('pt-BR')}</text>` : ''}
  ${stats}`;
  return { svg: shell(theme, content), avatars: [avatar] };
}

function compatibilityComposition(input: CompatibilityCardInput): CardComposition {
  const theme = SOCIAL_THEME_MAP[input.theme];
  const left: AvatarPlacement = { mediaId: input.left.avatarMediaId, name: input.left.name, x: 104, y: 178, size: 220 };
  const right: AvatarPlacement = { mediaId: input.right.avatarMediaId, name: input.right.name, x: 876, y: 178, size: 220 };
  const circumference = 2 * Math.PI * 112;
  const dash = Math.round(circumference * input.score / 100);
  const content = `${panel(theme, 48, 54, 1104, 566, 32)}
  <text x="600" y="122" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="24" font-weight="800" letter-spacing="3" fill="${theme.muted}">COMPATIBILIDADE</text>
  ${avatarFrame(theme, left)}${avatarFrame(theme, right)}
  <circle cx="600" cy="306" r="112" fill="${theme.panelStrong}" stroke="${theme.muted}" stroke-opacity=".2" stroke-width="18"/>
  <circle cx="600" cy="306" r="112" fill="none" stroke="${theme.accent}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${dash} ${Math.round(circumference - dash)}" transform="rotate(-90 600 306)"/>
  <text x="600" y="327" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="66" font-weight="900" fill="${theme.text}">${input.score}%</text>
  <text x="214" y="445" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="28" font-weight="800" fill="${theme.text}">${escapeXml(truncateCanvasText(input.left.name, 18))}</text>
  <text x="986" y="445" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="28" font-weight="800" fill="${theme.text}">${escapeXml(truncateCanvasText(input.right.name, 18))}</text>
  <text x="600" y="500" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="34" font-weight="900" fill="${theme.accent}">${escapeXml(truncateCanvasText(input.label, 32))}</text>
  <text x="600" y="548" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="20" fill="${theme.muted}">${escapeXml(truncateCanvasText(input.caption, 70))}</text>`;
  return { svg: shell(theme, content), avatars: [left, right] };
}

function rankingComposition(input: RankingCardInput): CardComposition {
  const theme = SOCIAL_THEME_MAP[input.theme];
  const avatars: AvatarPlacement[] = [];
  const rows = input.entries.map((entry, index) => {
    const column = index >= 5 ? 1 : 0;
    const row = index % 5;
    const x = 64 + column * 548;
    const y = 184 + row * 86;
    const avatar: AvatarPlacement = { mediaId: entry.avatarMediaId, name: entry.name, x: x + 64, y: y + 9, size: 58 };
    avatars.push(avatar);
    const medal = index === 0 ? theme.success : index < 3 ? theme.accent : theme.muted;
    return `${panel(theme, x, y, 524, 74, 18)}
      <circle cx="${x + 32}" cy="${y + 37}" r="20" fill="${medal}" opacity=".92"/>
      <text x="${x + 32}" y="${y + 44}" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="17" font-weight="900" fill="${theme.backgroundA}">${index + 1}</text>
      ${avatarFrame(theme, avatar)}
      <text x="${x + 138}" y="${y + 34}" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="21" font-weight="800" fill="${theme.text}">${escapeXml(truncateCanvasText(entry.name, 23))}</text>
      <text x="${x + 138}" y="${y + 58}" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="14" fill="${theme.muted}">${escapeXml(input.unit || 'pontos')}</text>
      <text x="${x + 500}" y="${y + 45}" text-anchor="end" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="24" font-weight="900" fill="${theme.accent}">${escapeXml(displayNumber(entry.value))}</text>`;
  }).join('');
  const content = `<text x="64" y="93" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="46" font-weight="900" fill="${theme.text}">${escapeXml(truncateCanvasText(input.title, 38))}</text>
  <text x="66" y="132" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="20" fill="${theme.muted}">${escapeXml(truncateCanvasText(input.subtitle, 62))}</text>
  ${rows}`;
  return { svg: shell(theme, content), avatars };
}

function achievementComposition(input: AchievementCardInput): CardComposition {
  const theme = SOCIAL_THEME_MAP[input.theme];
  const avatar: AvatarPlacement = { mediaId: input.avatarMediaId, name: input.name, x: 78, y: 206, size: 190 };
  const rarityLabels = { common: 'COMUM', rare: 'RARO', epic: 'ÉPICO', legendary: 'LENDÁRIO' } as const;
  const content = `${panel(theme, 48, 60, 1104, 555, 32)}
  <text x="82" y="126" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="20" font-weight="900" letter-spacing="3" fill="${theme.muted}">CONQUISTA ${input.unlocked ? 'DESBLOQUEADA' : 'EM PROGRESSO'}</text>
  ${avatarFrame(theme, avatar)}
  <rect x="322" y="190" width="170" height="36" rx="18" fill="${theme.accent}"/>
  <text x="407" y="215" text-anchor="middle" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="15" font-weight="900" letter-spacing="2" fill="${theme.backgroundA}">${rarityLabels[input.rarity]}</text>
  <text x="322" y="295" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="52" font-weight="900" fill="${theme.text}">${escapeXml(truncateCanvasText(input.title, 30))}</text>
  <text x="324" y="344" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="22" font-weight="700" fill="${theme.accent}">${escapeXml(truncateCanvasText(input.name, 36))}</text>
  <text x="324" y="397" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="20" fill="${theme.muted}">${escapeXml(truncateCanvasText(input.description, 74))}</text>
  <rect x="324" y="458" width="742" height="22" rx="11" fill="${theme.panelStrong}"/>
  <rect x="324" y="458" width="${Math.round(742 * input.progress / 100)}" height="22" rx="11" fill="${theme.accent}"/>
  <text x="324" y="525" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="20" font-weight="800" fill="${theme.text}">PROGRESSO</text>
  <text x="1066" y="525" text-anchor="end" font-family="Inter,DejaVu Sans,Arial,sans-serif" font-size="26" font-weight="900" fill="${theme.success}">${input.progress}%</text>`;
  return { svg: shell(theme, content), avatars: [avatar] };
}

function buildComposition(kind: SocialCardKind, input: SocialCardInput): CardComposition {
  if (kind === 'welcome') return welcomeComposition(input as WelcomeCardInput);
  if (kind === 'profile') return profileComposition(input as ProfileCardInput);
  if (kind === 'compatibility') return compatibilityComposition(input as CompatibilityCardInput);
  if (kind === 'ranking') return rankingComposition(input as RankingCardInput);
  return achievementComposition(input as AchievementCardInput);
}

async function roundedAvatar(buffer: Buffer, size: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(buffer, { limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

export async function renderSocialCard(kind: SocialCardKind, input: SocialCardInput, avatars: VisualMediaMap = new Map()): Promise<Buffer> {
  const composition = buildComposition(kind, input);
  const layers: OverlayOptions[] = [];

  for (const placement of composition.avatars) {
    if (!placement.mediaId) continue;
    const source = avatars.get(placement.mediaId);
    if (!source) continue;
    const rounded = await roundedAvatar(source, placement.size);
    layers.push({ input: rounded, left: placement.x, top: placement.y });
  }

  const svgLayer = await sharp(Buffer.from(composition.svg), {
    density: 144,
    limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS,
  })
    .resize(SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();

  let background: Buffer | undefined;
  if (composition.backgroundMediaId) {
    background = avatars.get(composition.backgroundMediaId);
  }
  if (!background && composition.defaultBackground) {
    background = await loadDefaultBackground(composition.defaultBackground);
  }

  const base = background
    ? await sharp(background, { limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize(SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT, { fit: 'cover' })
        .png()
        .toBuffer()
    : svgLayer;
  const overlays = background ? [{ input: svgLayer }, ...layers] : layers;

  return sharp(base, { limitInputPixels: SOCIAL_CARD_MAX_INPUT_PIXELS, failOn: 'error' })
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
