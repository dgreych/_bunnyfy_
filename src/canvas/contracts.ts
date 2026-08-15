import { z } from 'zod';

export const SOCIAL_THEMES = ['obsidian', 'sakura', 'ocean', 'emerald', 'sunset'] as const;
export type SocialThemeName = (typeof SOCIAL_THEMES)[number];

const themeSchema = z.enum(SOCIAL_THEMES).default('obsidian');
const mediaIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/).optional();
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().default('');

export const welcomeCardSchema = z.object({
  event: z.enum(['join', 'leave']),
  name: shortText(48),
  groupName: shortText(72),
  memberCount: z.number().int().min(0).max(10_000_000),
  avatarMediaId: mediaIdSchema,
  backgroundMediaId: mediaIdSchema,
  headline: optionalText(72),
  theme: themeSchema,
}).strict();

const statSchema = z.object({
  label: shortText(20),
  value: z.union([z.string().trim().min(1).max(24), z.number().finite()]),
}).strict();

export const profileCardSchema = z.object({
  name: shortText(48),
  handle: optionalText(48),
  bio: optionalText(160),
  level: z.number().int().min(0).max(1_000_000),
  xp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  nextLevelXp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  rank: z.number().int().positive().max(10_000_000).optional(),
  avatarMediaId: mediaIdSchema,
  stats: z.array(statSchema).max(4).default([]),
  theme: themeSchema,
}).strict().refine((value) => value.xp <= value.nextLevelXp, {
  message: 'xp não pode ultrapassar nextLevelXp',
  path: ['xp'],
});

const memberSchema = z.object({
  name: shortText(48),
  avatarMediaId: mediaIdSchema,
}).strict();

export const compatibilityCardSchema = z.object({
  left: memberSchema,
  right: memberSchema,
  score: z.number().int().min(0).max(100),
  label: shortText(48),
  caption: optionalText(100),
  theme: themeSchema,
}).strict();

const rankingEntrySchema = z.object({
  name: shortText(48),
  value: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  avatarMediaId: mediaIdSchema,
}).strict();

export const rankingCardSchema = z.object({
  title: shortText(64),
  subtitle: optionalText(72),
  unit: optionalText(16),
  entries: z.array(rankingEntrySchema).min(1).max(10),
  theme: themeSchema,
}).strict();

export const achievementCardSchema = z.object({
  name: shortText(48),
  title: shortText(64),
  description: shortText(140),
  progress: z.number().int().min(0).max(100),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']),
  unlocked: z.boolean(),
  avatarMediaId: mediaIdSchema,
  theme: themeSchema,
}).strict();

export type WelcomeCardInput = z.infer<typeof welcomeCardSchema>;
export type ProfileCardInput = z.infer<typeof profileCardSchema>;
export type CompatibilityCardInput = z.infer<typeof compatibilityCardSchema>;
export type RankingCardInput = z.infer<typeof rankingCardSchema>;
export type AchievementCardInput = z.infer<typeof achievementCardSchema>;

export type SocialCardKind = 'welcome' | 'profile' | 'compatibility' | 'ranking' | 'achievement';
export type SocialCardInput =
  | WelcomeCardInput
  | ProfileCardInput
  | CompatibilityCardInput
  | RankingCardInput
  | AchievementCardInput;
