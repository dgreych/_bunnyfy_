import type { SocialThemeName } from './contracts.ts';

export interface SocialTheme {
  backgroundA: string;
  backgroundB: string;
  panel: string;
  panelStrong: string;
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  success: string;
}

export const SOCIAL_THEME_MAP: Record<SocialThemeName, SocialTheme> = {
  obsidian: {
    backgroundA: '#090a12', backgroundB: '#1d1730', panel: '#151725dd',
    panelStrong: '#20243a', accent: '#a78bfa', accentSoft: '#6d5aa8',
    text: '#f7f5ff', muted: '#aaa7bd', success: '#67e8a5',
  },
  sakura: {
    backgroundA: '#200f1d', backgroundB: '#52233f', panel: '#35172ddd',
    panelStrong: '#54213f', accent: '#ff8fc7', accentSoft: '#b85080',
    text: '#fff5fa', muted: '#ddb5c9', success: '#ffd166',
  },
  ocean: {
    backgroundA: '#061625', backgroundB: '#0d4564', panel: '#092a3ddd',
    panelStrong: '#0d3c56', accent: '#4dd7ff', accentSoft: '#2a8cab',
    text: '#effbff', muted: '#9fc4d2', success: '#68f2c0',
  },
  emerald: {
    backgroundA: '#071a16', backgroundB: '#174b3a', panel: '#0d3027dd',
    panelStrong: '#14513f', accent: '#66f2b3', accentSoft: '#2c9b70',
    text: '#f0fff8', muted: '#a5cfbd', success: '#f8d66d',
  },
  sunset: {
    backgroundA: '#241022', backgroundB: '#743b2c', panel: '#3b1d2ddd',
    panelStrong: '#65302f', accent: '#ffb45e', accentSoft: '#c86d48',
    text: '#fff8ec', muted: '#e6c0ad', success: '#ffe27a',
  },
};
