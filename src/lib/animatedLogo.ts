import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { escapeXml, normalizeCanvasText } from '../canvas/text.ts';
import { AppError } from '../envelope.ts';
import {
  runSubprocess,
  SubprocessExitError,
  SubprocessTimeoutError,
  ToolNotFoundError,
} from './subprocess.ts';

export const LOGO_WIDTH = 960;
export const LOGO_HEIGHT = 540;
export const LOGO_FPS = 10;
export const LOGO_FRAMES = 24;
export const LOGO_DURATION_SECONDS = LOGO_FRAMES / LOGO_FPS;
const LOGO_SVG_MAX_INPUT_PIXELS = 16_000_000;

export const ONE_TEXT_LOGO_MODELS = [
  'darkgreen', 'glitch', 'write', 'advanced', 'typography',
  'pixel', 'neon', 'flag', 'americanflag', 'deleting',
] as const;
export const TWO_TEXT_LOGO_MODELS = [
  'pornhub', 'avengers', 'graffiti', 'captainamerica', 'stone3d',
  'neon2', 'thor', 'amongus', 'deadpool', 'blackpink',
] as const;
export const LOGO_MODELS = [...ONE_TEXT_LOGO_MODELS, ...TWO_TEXT_LOGO_MODELS] as const;

export type LogoModel = (typeof LOGO_MODELS)[number];

type LogoStyle =
  | 'emerald' | 'glitch' | 'script' | 'future' | 'kinetic'
  | 'pixel' | 'neon' | 'wave' | 'patriot' | 'dissolve'
  | 'contrast' | 'heroic' | 'spray' | 'shield' | 'stone'
  | 'duoneon' | 'storm' | 'cosmic' | 'crimson' | 'rose';

type LogoTypography = 'sans' | 'serif' | 'mono';

interface LogoDefinition {
  textCount: 1 | 2;
  style: LogoStyle;
  backgroundA: string;
  backgroundB: string;
  accentA: string;
  accentB: string;
  accentC: string;
  typography: LogoTypography;
  uppercase: boolean;
  tracking: number;
  label: string;
}

export const LOGO_MODEL_DEFINITIONS: Readonly<Record<LogoModel, LogoDefinition>> = Object.freeze({
  darkgreen: {
    textCount: 1, style: 'emerald',
    backgroundA: '#06110b', backgroundB: '#010302',
    accentA: '#2ea56a', accentB: '#0c4b31', accentC: '#d9f4e4',
    typography: 'sans', uppercase: true, tracking: 2, label: 'Dark Green Typography',
  },
  glitch: {
    textCount: 1, style: 'glitch',
    backgroundA: '#05060a', backgroundB: '#020205',
    accentA: '#00f5ff', accentB: '#ff2bd6', accentC: '#f6fbff',
    typography: 'sans', uppercase: true, tracking: 1, label: 'Digital Glitch',
  },
  write: {
    textCount: 1, style: 'script',
    backgroundA: '#182226', backgroundB: '#070b0d',
    accentA: '#d9eef2', accentB: '#7d979e', accentC: '#f5fbfc',
    typography: 'serif', uppercase: false, tracking: 1, label: 'Wet Glass Writing',
  },
  advanced: {
    textCount: 1, style: 'future',
    backgroundA: '#04060a', backgroundB: '#010102',
    accentA: '#55eaff', accentB: '#4378ff', accentC: '#f7fdff',
    typography: 'sans', uppercase: false, tracking: 2, label: 'Advanced Glow',
  },
  typography: {
    textCount: 1, style: 'kinetic',
    backgroundA: '#2c2d2d', backgroundB: '#111212',
    accentA: '#f1eee5', accentB: '#b7b2a6', accentC: '#fffdf6',
    typography: 'sans', uppercase: false, tracking: 1, label: 'Typography on Pavement',
  },
  pixel: {
    textCount: 1, style: 'pixel',
    backgroundA: '#050609', backgroundB: '#010102',
    accentA: '#00eaff', accentB: '#ff315c', accentC: '#f8fbff',
    typography: 'mono', uppercase: true, tracking: 2, label: 'Pixel Glitch',
  },
  neon: {
    textCount: 1, style: 'neon',
    backgroundA: '#08010b', backgroundB: '#010102',
    accentA: '#ff58dc', accentB: '#63f6ff', accentC: '#fff2fd',
    typography: 'sans', uppercase: false, tracking: 3, label: 'Neon Glitch',
  },
  flag: {
    textCount: 1, style: 'wave',
    backgroundA: '#07130d', backgroundB: '#020503',
    accentA: '#008753', accentB: '#ffffff', accentC: '#006b3f',
    typography: 'sans', uppercase: true, tracking: 2, label: 'Nigeria 3D Flag',
  },
  americanflag: {
    textCount: 1, style: 'patriot',
    backgroundA: '#07101f', backgroundB: '#020306',
    accentA: '#f7f8fb', accentB: '#c92739', accentC: '#2457a6',
    typography: 'sans', uppercase: true, tracking: 2, label: 'American Flag 3D',
  },
  deleting: {
    textCount: 1, style: 'dissolve',
    backgroundA: '#d7d4cd', backgroundB: '#aaa79f',
    accentA: '#2d2d2b', accentB: '#e7a0a4', accentC: '#191a18',
    typography: 'sans', uppercase: false, tracking: 1, label: 'Eraser Deleting',
  },
  pornhub: {
    textCount: 2, style: 'contrast',
    backgroundA: '#070707', backgroundB: '#030303',
    accentA: '#ffffff', accentB: '#ff9f1c', accentC: '#151515',
    typography: 'sans', uppercase: false, tracking: 1, label: 'PornHub Style Lockup',
  },
  avengers: {
    textCount: 2, style: 'heroic',
    backgroundA: '#071016', backgroundB: '#010203',
    accentA: '#a7b7c0', accentB: '#4c5d66', accentC: '#eef3f5',
    typography: 'sans', uppercase: true, tracking: 2, label: 'Avengers 3D',
  },
  graffiti: {
    textCount: 2, style: 'spray',
    backgroundA: '#09090a', backgroundB: '#030405',
    accentA: '#edff55', accentB: '#ff4fb4', accentC: '#80f3ff',
    typography: 'sans', uppercase: true, tracking: 1, label: 'Painted Graffiti',
  },
  captainamerica: {
    textCount: 2, style: 'shield',
    backgroundA: '#071222', backgroundB: '#090204',
    accentA: '#edf3f7', accentB: '#b32636', accentC: '#295d9d',
    typography: 'sans', uppercase: true, tracking: 2, label: 'Cinematic Captain America',
  },
  stone3d: {
    textCount: 2, style: 'stone',
    backgroundA: '#111313', backgroundB: '#040404',
    accentA: '#c9c0aa', accentB: '#6d685e', accentC: '#eee7d4',
    typography: 'sans', uppercase: true, tracking: 2, label: '3D Stone',
  },
  neon2: {
    textCount: 2, style: 'duoneon',
    backgroundA: '#08060a', backgroundB: '#010101',
    accentA: '#58f4ff', accentB: '#ff4fd3', accentC: '#fff9ff',
    typography: 'sans', uppercase: false, tracking: 2, label: 'Neon Text',
  },
  thor: {
    textCount: 2, style: 'storm',
    backgroundA: '#0c1016', backgroundB: '#020303',
    accentA: '#d9c88f', accentB: '#665f4c', accentC: '#f4eee0',
    typography: 'serif', uppercase: true, tracking: 2, label: 'Thor Logo Style',
  },
  amongus: {
    textCount: 2, style: 'cosmic',
    backgroundA: '#06081b', backgroundB: '#02030a',
    accentA: '#ef4f55', accentB: '#5fd0ff', accentC: '#f5f7ff',
    typography: 'sans', uppercase: true, tracking: 2, label: 'Among Us Banner',
  },
  deadpool: {
    textCount: 2, style: 'crimson',
    backgroundA: '#120306', backgroundB: '#020202',
    accentA: '#b51f2f', accentB: '#3c3c3c', accentC: '#e6e1dc',
    typography: 'sans', uppercase: true, tracking: 2, label: 'Deadpool Logo Style',
  },
  blackpink: {
    textCount: 2, style: 'rose',
    backgroundA: '#090407', backgroundB: '#010101',
    accentA: '#ef7fb5', accentB: '#ffc5df', accentC: '#f8f2f5',
    typography: 'sans', uppercase: true, tracking: 4, label: 'BLACKPINK BORN PINK',
  },
});

export interface AnimatedLogoInput {
  model: LogoModel;
  texts: string[];
}

export interface AnimatedLogoDeps {
  ffmpegPath: string;
  timeoutMs: number;
  maxOutputBytes: number;
  run?: typeof runSubprocess;
}

export interface AnimatedLogoResult {
  buffer: Buffer;
  mime: 'video/mp4';
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
}

export function isLogoModel(value: unknown): value is LogoModel {
  return typeof value === 'string' && Object.hasOwn(LOGO_MODEL_DEFINITIONS, value);
}

export function normalizeAnimatedLogoInput(input: AnimatedLogoInput): AnimatedLogoInput {
  if (!isLogoModel(input?.model) || !Array.isArray(input?.texts)) {
    throw AppError.badRequest('Modelo ou textos inválidos para o logotipo.');
  }
  const definition = LOGO_MODEL_DEFINITIONS[input.model];
  if (input.texts.length !== definition.textCount) {
    throw AppError.badRequest(`O modelo exige ${definition.textCount} texto(s).`);
  }
  const texts = input.texts.map((value) => normalizeCanvasText(String(value || '')));
  const max = definition.textCount === 1 ? 40 : 28;
  if (texts.some((value) => value.length === 0 || [...value].length > max)) {
    throw AppError.badRequest(`Cada texto deve ter entre 1 e ${max} caracteres.`);
  }
  return { model: input.model, texts };
}

function fontFamily(definition: LogoDefinition): string {
  switch (definition.typography) {
    case 'serif':
      return 'DejaVu Serif,Georgia,serif';
    case 'mono':
      return 'DejaVu Sans Mono,monospace';
    default:
      return 'DejaVu Sans,Arial,sans-serif';
  }
}

function displayText(definition: LogoDefinition, text: string): string {
  return definition.uppercase ? text.toLocaleUpperCase('pt-BR') : text;
}

function fitFontSize(
  text: string,
  maxWidth: number,
  preferred: number,
  minimum: number,
  widthFactor = 0.58,
  tracking = 0,
): number {
  const length = Math.max(1, [...text].length);
  const trackingWidth = Math.max(0, length - 1) * Math.max(0, tracking);
  const availableWidth = Math.max(minimum * widthFactor, maxWidth - trackingWidth);
  return Math.max(minimum, Math.min(preferred, Math.floor(availableWidth / (length * widthFactor))));
}

function seededParticles(seed: string, phase: number, count = 22): string {
  let state = [...seed].reduce(
    (total, character) => (total * 33 + character.codePointAt(0)!) >>> 0,
    5381,
  );
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  return Array.from({ length: count }, (_, index) => {
    const x = Math.round(next() * LOGO_WIDTH);
    const baseY = next() * LOGO_HEIGHT;
    const y = Math.round((baseY - phase * (28 + next() * 54) + LOGO_HEIGHT) % LOGO_HEIGHT);
    const radius = (1 + next() * 2.8).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="currentColor" opacity="${(0.08 + (index % 5) * 0.045).toFixed(2)}"/>`;
  }).join('');
}

function backgroundLayer(definition: LogoDefinition, phase: number): string {
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  const drift = Math.round(Math.sin(phase * Math.PI * 2) * 18);
  switch (definition.style) {
    case 'emerald':
      return `<g id="darkgreen-texture" opacity=".11"><path d="M84 416C248 360 350 390 480 344S714 312 876 352" fill="none" stroke="${definition.accentA}" stroke-width="2"/><g fill="${definition.accentA}">${Array.from({ length: 28 }, (_, i) => `<circle cx="${120 + ((i * 73) % 720)}" cy="${110 + ((i * 47) % 320)}" r="${1 + (i % 3)}" opacity="${.08 + (i % 4) * .03}"/>`).join('')}</g></g>`;
    case 'glitch':
      return `<g opacity=".065" fill="${definition.accentC}">
        ${Array.from({ length: 18 }, (_, i) => `<rect x="0" y="${18 + i * 29}" width="960" height="1"/>`).join('')}
      </g>`;
    case 'script':
      return `<g id="wet-glass-scene">
        <g filter="url(#wetBlur)" opacity=".26">
          <circle cx="180" cy="150" r="64" fill="#7aa8b6"/><circle cx="760" cy="180" r="76" fill="#d0aa79"/>
          <circle cx="700" cy="392" r="54" fill="#668390"/><circle cx="286" cy="414" r="48" fill="#bdcdd1"/>
        </g>
        <rect x="0" y="0" width="960" height="540" fill="#d8e3e5" opacity=".065"/>
        <g stroke="${definition.accentC}" stroke-linecap="round" opacity=".26">
          ${Array.from({ length: 28 }, (_, i) => {
            const x = 36 + ((i * 79) % 900);
            const y = 24 + ((i * 53 + phase * 150) % 470);
            const length = 12 + (i % 5) * 7;
            return `<path d="M${x} ${y.toFixed(1)}v${length}" stroke-width="${1 + (i % 3) * .6}"/>`;
          }).join('')}
        </g>
        <g fill="none" stroke="${definition.accentA}" opacity=".18">
          ${Array.from({ length: 16 }, (_, i) => {
            const x = 56 + ((i * 113) % 850);
            const y = 72 + ((i * 67) % 390);
            const r = 4 + (i % 4) * 2.5;
            return `<ellipse cx="${x}" cy="${y}" rx="${r.toFixed(1)}" ry="${(r * 1.55).toFixed(1)}" stroke-width="1.2"/>`;
          }).join('')}
        </g>
      </g>`;
    case 'future':
      return `<g opacity=".16" filter="url(#softGlow)"><ellipse cx="480" cy="278" rx="340" ry="126" fill="${definition.accentB}" opacity="${(0.10 + pulse * .08).toFixed(2)}"/></g>`;
    case 'kinetic':
      return `<g id="pavement-scene"><path d="M0 78L960 42V540H0Z" fill="#8d8b84" opacity=".09"/><path d="M-40 430L1000 352" stroke="#d9d4c9" stroke-width="3" opacity=".08"/><path d="M-60 466L1020 382" stroke="#050505" stroke-width="5" opacity=".12"/><g fill="#e8e3d7" opacity=".07">${Array.from({ length: 48 }, (_, i) => `<circle cx="${24 + ((i * 91) % 920)}" cy="${70 + ((i * 67) % 430)}" r="${1 + (i % 4) * .8}"/>`).join('')}</g></g>`;
    case 'pixel':
      return `<g opacity=".07" shape-rendering="crispEdges">${Array.from({ length: 12 }, (_, i) => `<rect x="0" y="${38 + i * 42}" width="960" height="1" fill="${i % 2 ? definition.accentA : definition.accentB}"/>`).join('')}</g>`;
    case 'neon':
      return `<g opacity=".07">
        <rect x="112" y="146" width="736" height="248" rx="28" fill="#ffffff" opacity=".025"/>
        <path d="M150 394H810" stroke="${definition.accentB}" stroke-width="1"/>
      </g>`;
    case 'wave':
      return `<g opacity=".08"><ellipse cx="480" cy="318" rx="330" ry="54" fill="#000"/></g>`;
    case 'patriot':
      return `<g opacity=".10"><ellipse cx="480" cy="322" rx="350" ry="58" fill="#000"/></g>`;
    case 'dissolve':
      return `<g id="paper-scene"><rect width="960" height="540" fill="#f4f0e6" opacity=".18"/><g fill="#2d2d2b" opacity=".045">${Array.from({ length: 44 }, (_, i) => `<circle cx="${22 + ((i * 83) % 920)}" cy="${26 + ((i * 59) % 490)}" r="${.8 + (i % 3) * .6}"/>`).join('')}</g><path d="M104 356H856" stroke="#73716c" stroke-width="1" opacity=".16"/></g>`;
    case 'contrast':
      return '';
    case 'heroic':
      return `<g id="avengers-backdrop" fill="none" opacity=".10"><circle cx="480" cy="278" r="180" stroke="${definition.accentA}" stroke-width="2"/><path d="M364 104L460 276L398 276M596 104L500 276L562 276" stroke="${definition.accentB}" stroke-width="7"/></g>`;
    case 'spray':
      return `<g id="graffiti-wall">
        <rect x="0" y="0" width="960" height="540" fill="#d8d2c5" opacity=".055"/>
        <g stroke="#f4efe7" stroke-width="1" opacity=".055"><path d="M0 176H960M0 352H960"/><path d="M160 0V176M480 0V176M800 0V176M0 176V352M320 176V352M640 176V352M160 352V540M480 352V540M800 352V540"/></g>
        <g opacity=".10" fill="${definition.accentB}">${Array.from({ length: 18 }, (_, i) => `<circle cx="${180 + ((i * 97 + drift + 600) % 600)}" cy="${154 + ((i * 61) % 250)}" r="${2 + (i % 3) * 2}"/>`).join('')}</g>
      </g>`;
    case 'shield':
      return `<g id="captain-disc" opacity=".12"><circle cx="480" cy="278" r="182" fill="none" stroke="#edf3f7" stroke-width="18"/><circle cx="480" cy="278" r="150" fill="none" stroke="#b32636" stroke-width="18"/><circle cx="480" cy="278" r="118" fill="none" stroke="#295d9d" stroke-width="18"/><path d="M480 185L500 246L564 246L512 284L532 346L480 308L428 346L448 284L396 246L460 246Z" fill="#edf3f7"/></g>`;
    case 'stone':
      return `<ellipse cx="480" cy="390" rx="300" ry="34" fill="#000000" opacity=".24"/>`;
    case 'duoneon':
      return `<g id="neon-wall" opacity=".075" stroke="#ffffff" stroke-width="1"><path d="M0 170H960M0 340H960"/><path d="M160 0V170M480 0V170M800 0V170M0 170V340M320 170V340M640 170V340M160 340V540M480 340V540M800 340V540"/></g>`;
    case 'storm':
      return `<g id="thor-backdrop" opacity=".10"><path d="M88 390C240 308 328 352 480 310S720 286 872 354" fill="none" stroke="${definition.accentA}" stroke-width="2"/><path d="M180 128L244 198L222 198L278 276" fill="none" stroke="#e8f4ff" stroke-width="4" opacity="${(0.25 + pulse * .25).toFixed(2)}"/><path d="M782 142L726 206L748 206L694 286" fill="none" stroke="#e8f4ff" stroke-width="4" opacity="${(0.20 + pulse * .25).toFixed(2)}"/></g>`;
    case 'cosmic':
      return `<g id="amongus-banner"><g color="#d9e6ff" opacity=".65">${seededParticles('amongus-stars', phase, 36)}</g><ellipse cx="170" cy="420" rx="250" ry="86" fill="#171b3d" opacity=".7"/><ellipse cx="824" cy="108" rx="190" ry="64" fill="#22133d" opacity=".55"/><g transform="translate(126 210) scale(.74)" opacity=".72"><path d="M52 34c46 0 70 28 70 72v94c0 24-12 36-30 36H76v44H48v-44H30c-18 0-28-12-28-34v-94C2 62 16 34 52 34Z" fill="${definition.accentA}"/><rect x="64" y="62" width="62" height="44" rx="18" fill="#bfeeff" stroke="#18364a" stroke-width="6"/></g><g transform="translate(760 260) scale(.56)" opacity=".5"><path d="M52 34c46 0 70 28 70 72v94c0 24-12 36-30 36H76v44H48v-44H30c-18 0-28-12-28-34v-94C2 62 16 34 52 34Z" fill="${definition.accentB}"/><rect x="64" y="62" width="62" height="44" rx="18" fill="#d9f7ff" stroke="#18364a" stroke-width="6"/></g></g>`;
    case 'crimson':
      return `<g id="deadpool-backdrop" opacity=".13"><circle cx="480" cy="278" r="154" fill="#111" stroke="${definition.accentA}" stroke-width="18"/><path d="M480 126V430" stroke="#080808" stroke-width="20"/><path d="M410 232L456 266L420 308Z" fill="#e8e1dc"/><path d="M550 232L504 266L540 308Z" fill="#e8e1dc"/></g>`;
    case 'rose':
      return `<g id="born-pink-frame" fill="${definition.accentA}" opacity=".34"><path d="M264 84C290 118 302 160 300 210L272 262C256 202 248 140 264 84Z"/><path d="M696 84C670 118 658 160 660 210L688 262C704 202 712 140 696 84Z"/><path d="M272 456C248 414 252 354 276 306L304 336C294 384 286 426 272 456Z"/><path d="M688 456C712 414 708 354 684 306L656 336C666 384 674 426 688 456Z"/></g>`;
    default:
      return '';
  }
}

function effectLayer(definition: LogoDefinition, phase: number): string {
  const pulse = 0.55 + 0.45 * Math.sin(phase * Math.PI * 2);
  const shift = Math.round(Math.sin(phase * Math.PI * 4) * 14);
  const scan = Math.round((phase * LOGO_HEIGHT) % LOGO_HEIGHT);
  switch (definition.style) {
    case 'glitch':
      return `<g opacity=".10"><rect y="${scan}" width="960" height="2" fill="${definition.accentA}"/><rect y="${(scan + 187) % 540}" width="960" height="1" fill="${definition.accentB}"/></g>`;
    case 'future': {
      const beamX = Math.round(240 + phase * 480);
      return `<g opacity="${(0.22 + pulse * .18).toFixed(2)}" filter="url(#softGlow)"><rect x="${beamX}" y="190" width="34" height="170" rx="17" fill="${definition.accentA}" opacity=".16"/></g>`;
    }
    case 'pixel':
      return `<g fill="${definition.accentA}" opacity=".18" shape-rendering="crispEdges">${Array.from({ length: 12 }, (_, i) => `<rect x="${286 + ((i * 47 + shift + 360) % 390)}" y="${214 + ((i * 31) % 128)}" width="${4 + (i % 3) * 4}" height="${4 + (i % 3) * 4}"/>`).join('')}</g>`;
    case 'script':
      return `<path d="M${Math.round(150 + phase * 660)} 118c12 26 3 52 -5 74" fill="none" stroke="${definition.accentC}" stroke-width="2" stroke-linecap="round" opacity=".16"/>`;
    case 'storm':
      return `<g opacity="${(0.12 + pulse * 0.28).toFixed(2)}" filter="url(#softGlow)"><path d="M284 204l32 34-18 0 28 38M676 214l-30 34 18 0-26 38" fill="none" stroke="#e9f5ff" stroke-width="3"/></g>`;
    case 'dissolve': {
      const eraserX = Math.round(196 + phase * 568);
      return `<g opacity=".22" fill="${definition.accentA}">${Array.from({ length: 14 }, (_, i) => `<circle cx="${Math.max(190, eraserX - 92 + ((i * 23) % 84))}" cy="${288 + ((i * 19) % 72)}" r="${1 + (i % 3)}"/>`).join('')}</g>`;
    }
    case 'spray':
      return `<g opacity=".16" fill="${definition.accentC}">${Array.from({ length: 8 }, (_, i) => `<circle cx="${244 + i * 66}" cy="${190 + ((i * 41 + shift + 180) % 180)}" r="${2 + (i % 3) * 2}"/>`).join('')}</g>`;
    case 'crimson':
      return `<path d="M${344 + Math.round(shift * .4)} 376L394 286M566 376L616 286" stroke="${definition.accentA}" stroke-width="4" opacity=".20"/>`;
    case 'neon':
      return `<circle cx="${Math.round(250 + phase * 460)}" cy="204" r="2.2" fill="${definition.accentC}" opacity="${(0.18 + pulse * 0.26).toFixed(2)}" filter="url(#softGlow)"/>`;
    case 'duoneon':
      return `<g opacity="${(0.18 + pulse * .24).toFixed(2)}" filter="url(#softGlow)"><circle cx="${Math.round(300 + phase * 360)}" cy="206" r="2" fill="${definition.accentA}"/><circle cx="${Math.round(660 - phase * 360)}" cy="348" r="2" fill="${definition.accentB}"/></g>`;
    case 'contrast':
      return '';
    case 'stone':
      return `<g fill="${definition.accentA}" opacity=".15">${Array.from({ length: 18 }, (_, i) => `<circle cx="${286 + ((i * 43 + shift + 420) % 390)}" cy="${390 + ((i * 17) % 52)}" r="${1.5 + (i % 4)}"/>`).join('')}</g>`;
    case 'emerald':
    case 'heroic':
    case 'shield':
    case 'cosmic':
      return '';
    case 'rose':
      return `<rect x="${Math.round(240 + phase * 470)}" y="176" width="3" height="190" fill="${definition.accentC}" opacity="${(0.12 + pulse * .18).toFixed(2)}" filter="url(#softGlow)"/>`;
    default:
      return `<g color="${definition.accentA}" opacity=".75">${seededParticles(definition.style, phase, 14)}</g>`;
  }
}

function singleTitleLayer(definition: LogoDefinition, rawText: string, phase: number): string {
  const text = escapeXml(displayText(definition, rawText));
  const family = fontFamily(definition);
  const pulse = 0.68 + 0.32 * Math.sin(phase * Math.PI * 2);
  const jitter = definition.style === 'glitch' ? Math.round(Math.sin(phase * Math.PI * 8) * 7) : 0;
  const baseSize = fitFontSize(displayText(definition, rawText), 760, 126, 26, definition.typography === 'mono' ? 0.63 : 0.57, definition.tracking);
  const tracking = definition.tracking;

  switch (definition.style) {
    case 'emerald': {
      const size = fitFontSize(displayText(definition, rawText), 700, 118, 18, 0.62, tracking);
      const shineX = Math.round(260 + phase * 430);
      return `<g id="darkgreen-typography" filter="url(#titleShadow)"><defs><linearGradient id="darkGreenFace" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#79d7a4"/><stop offset=".24" stop-color="${definition.accentA}"/><stop offset=".72" stop-color="#176d48"/><stop offset="1" stop-color="#0b3b28"/></linearGradient><clipPath id="darkGreenClip"><text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}">${text}</text></clipPath></defs>${[11,8,5,2].map((offset) => `<text x="${480 + offset}" y="${304 + offset}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentB}">${text}</text>`).join('')}<text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="url(#darkGreenFace)" stroke="#b7e4ca" stroke-width="1.5" stroke-opacity=".48">${text}</text><g clip-path="url(#darkGreenClip)" opacity=".26"><path d="M180 330L380 180M318 354L518 190M470 352L670 188M610 352L790 214" stroke="#d9f4e4" stroke-width="3"/><rect x="${shineX}" y="170" width="26" height="200" fill="#ffffff" opacity=".22" filter="url(#softGlow)"/></g></g>`;
    }
    case 'glitch': {
      const sliceA = Math.round(Math.sin(phase * Math.PI * 6) * 18);
      const sliceB = Math.round(Math.cos(phase * Math.PI * 8) * 12);
      return `<g filter="url(#titleShadow)">
        <text x="474" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentB}" opacity=".48">${text}</text>
        <text x="486" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentA}" opacity=".48">${text}</text>
        <text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentC}">${text}</text>
        <g clip-path="url(#glitchSliceA)" transform="translate(${sliceA} 0)"><text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentA}">${text}</text></g>
        <g clip-path="url(#glitchSliceB)" transform="translate(${-sliceB} 0)"><text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentB}">${text}</text></g>
        <g clip-path="url(#glitchSliceC)" transform="translate(${Math.round(jitter * .8)} 0)"><text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentC}">${text}</text></g>
      </g>`;
    }
    case 'script': {
      const scriptSize = fitFontSize(rawText, 760, 118, 30, 0.52);
      const reveal = phase < .72 ? Math.min(760, Math.round(90 + (phase / .72) * 760)) : 760;
      return `<g filter="url(#wetTextShadow)">
        <defs><clipPath id="wetTextClip"><text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${scriptSize}" font-style="italic" font-weight="700" letter-spacing="0">${text}</text></clipPath></defs>
        <text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${scriptSize}" font-style="italic" font-weight="700" letter-spacing="0" fill="#0e171a" opacity=".32">${text}</text>
        <rect x="100" y="170" width="${reveal}" height="190" fill="#dfe9eb" opacity=".72" clip-path="url(#wetTextClip)"/>
        <text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${scriptSize}" font-style="italic" font-weight="700" letter-spacing="0" fill="none" stroke="${definition.accentC}" stroke-width="1.3" stroke-opacity=".42">${text}</text>
        <g clip-path="url(#wetTextClip)" fill="#ffffff" opacity=".24">${Array.from({ length: 16 }, (_, i) => `<circle cx="${250 + ((i * 59) % 460)}" cy="${226 + ((i * 31) % 86)}" r="${1.5 + (i % 3)}"/>`).join('')}</g>
      </g>`;
    }
    case 'future': {
      const glowSize = Math.min(baseSize, 116);
      const sweepX = Math.round(180 + phase * 600);
      return `<g><defs><clipPath id="advancedGlowClip"><text x="480" y="306" text-anchor="middle" font-family="${family}" font-size="${glowSize}" font-weight="800" letter-spacing="${tracking}">${text}</text></clipPath></defs><text x="480" y="306" text-anchor="middle" font-family="${family}" font-size="${glowSize}" font-weight="800" letter-spacing="${tracking}" fill="none" stroke="${definition.accentB}" stroke-width="20" stroke-opacity=".16" filter="url(#neonHalo)">${text}</text><text x="480" y="306" text-anchor="middle" font-family="${family}" font-size="${glowSize}" font-weight="800" letter-spacing="${tracking}" fill="${definition.accentA}" opacity=".58" filter="url(#softGlow)">${text}</text><text x="480" y="306" text-anchor="middle" font-family="${family}" font-size="${glowSize}" font-weight="800" letter-spacing="${tracking}" fill="${definition.accentC}">${text}</text><rect x="${sweepX}" y="178" width="58" height="180" fill="#ffffff" opacity=".72" clip-path="url(#advancedGlowClip)" filter="url(#softGlow)"/></g>`;
    }
    case 'kinetic': {
      const size = fitFontSize(displayText(definition, rawText), 780, 118, 26, 0.56, definition.tracking);
      return `<g id="pavement-type" transform="rotate(-5 480 290) skewX(-10) scale(1 .78)" filter="url(#titleShadow)"><text x="480" y="336" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="#171817" opacity=".38">${text}</text><text x="480" y="324" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentA}" stroke="#ddd8cc" stroke-width="1.2" stroke-opacity=".35">${text}</text><path d="M250 356H710" stroke="${definition.accentB}" stroke-width="3" stroke-dasharray="18 9" opacity=".34"/></g>`;
    }
    case 'pixel': {
      const pxSize = Math.min(baseSize, 108);
      const blockShift = Math.round(Math.sin(phase * Math.PI * 6) * 14);
      return `<g shape-rendering="crispEdges" filter="url(#titleShadow)"><text x="474" y="302" text-anchor="middle" font-family="${family}" font-size="${pxSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentB}" opacity=".46">${text}</text><text x="486" y="302" text-anchor="middle" font-family="${family}" font-size="${pxSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentA}" opacity=".46">${text}</text><text x="480" y="302" text-anchor="middle" font-family="${family}" font-size="${pxSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentC}">${text}</text><g clip-path="url(#glitchSliceA)" transform="translate(${blockShift} 0)"><text x="480" y="302" text-anchor="middle" font-family="${family}" font-size="${pxSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentA}">${text}</text></g><g clip-path="url(#glitchSliceB)" transform="translate(${-blockShift} 0)"><text x="480" y="302" text-anchor="middle" font-family="${family}" font-size="${pxSize}" font-weight="900" letter-spacing="${tracking}" fill="${definition.accentB}">${text}</text></g>${Array.from({ length: 10 }, (_, i) => `<rect x="${326 + ((i * 61 + blockShift + 300) % 320)}" y="${226 + ((i * 37) % 112)}" width="${5 + (i % 3) * 5}" height="${5 + (i % 3) * 5}" fill="${i % 2 ? definition.accentA : definition.accentB}" opacity=".72"/>`).join('')}</g>`;
    }
    case 'neon': {
      const neonShift = Math.round(Math.sin(phase * Math.PI * 8) * 9);
      return `<g>
        <text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="700" letter-spacing="${tracking}" fill="none" stroke="${definition.accentA}" stroke-width="22" stroke-opacity="${(0.08 + pulse * .05).toFixed(2)}" filter="url(#neonHalo)">${text}</text>
        <text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="700" letter-spacing="${tracking}" fill="none" stroke="${definition.accentA}" stroke-width="8" stroke-opacity=".56" filter="url(#softGlow)">${text}</text>
        <text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="700" letter-spacing="${tracking}" fill="none" stroke="url(#neonTube)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${text}</text>
        <g clip-path="url(#glitchSliceA)" transform="translate(${neonShift} 0)" opacity=".7"><text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="700" letter-spacing="${tracking}" fill="none" stroke="${definition.accentB}" stroke-width="3.4">${text}</text></g>
        <g clip-path="url(#glitchSliceC)" transform="translate(${-neonShift} 0)" opacity=".62"><text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="700" letter-spacing="${tracking}" fill="none" stroke="${definition.accentC}" stroke-width="2.2">${text}</text></g>
        <text x="480" y="303" text-anchor="middle" font-family="${family}" font-size="${baseSize}" font-weight="700" letter-spacing="${tracking}" fill="none" stroke="${definition.accentC}" stroke-width="1.1" stroke-opacity=".92">${text}</text>
      </g>`;
    }
    case 'wave': {
      const size = fitFontSize(displayText(definition, rawText), 680, 112, 24, 0.57, tracking);
      return `<g filter="url(#titleShadow)"><defs><linearGradient id="nigeriaFlag" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#008753"/><stop offset=".33" stop-color="#008753"/><stop offset=".331" stop-color="#ffffff"/><stop offset=".66" stop-color="#ffffff"/><stop offset=".661" stop-color="#008753"/><stop offset="1" stop-color="#008753"/></linearGradient></defs>${[12,9,6,3].map((offset) => `<text x="${480 + offset}" y="${304 + offset}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="#034f32">${text}</text>`).join('')}<text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="url(#nigeriaFlag)" stroke="#e9efe9" stroke-width="2.2" stroke-opacity=".64">${text}</text><path d="M250 350C360 ${344 + jitter},600 ${356 - jitter},710 348" fill="none" stroke="#008753" stroke-width="3" opacity=".32"/></g>`;
    }
    case 'patriot': {
      const size = fitFontSize(displayText(definition, rawText), 680, 108, 24, 0.57, tracking);
      return `<g filter="url(#titleShadow)"><defs><clipPath id="americanTextClip"><text x="480" y="306" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}">${text}</text></clipPath></defs>${[13,10,7,4].map((offset) => `<text x="${480 + offset}" y="${306 + offset}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="#4a1520">${text}</text>`).join('')}<g clip-path="url(#americanTextClip)"><rect x="120" y="180" width="720" height="180" fill="#f6f5ee"/>${Array.from({ length: 7 }, (_, i) => `<rect x="120" y="${184 + i * 26}" width="720" height="13" fill="#c92739"/>`).join('')}<rect x="120" y="180" width="278" height="94" fill="#2457a6"/>${Array.from({ length: 18 }, (_, i) => `<circle cx="${144 + (i % 6) * 42}" cy="${198 + Math.floor(i / 6) * 28}" r="3" fill="#ffffff"/>`).join('')}</g><text x="480" y="306" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="900" letter-spacing="${tracking}" fill="none" stroke="#f4f6f8" stroke-width="2.4" stroke-opacity=".7">${text}</text></g>`;
    }
    case 'dissolve': {
      const size = Math.min(baseSize, 106);
      const eraseX = Math.round(80 + phase * 800);
      const remainX = Math.min(840, eraseX + 10);
      return `<g id="eraser-delete"><defs><clipPath id="deleteRemaining"><rect x="${remainX}" y="170" width="${Math.max(0, 820 - remainX)}" height="210"/></clipPath><clipPath id="deleteGhost"><rect x="140" y="170" width="${Math.max(0, eraseX - 140)}" height="210"/></clipPath></defs><text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="700" letter-spacing="${tracking}" fill="${definition.accentA}" opacity=".12" clip-path="url(#deleteGhost)">${text}</text><text x="480" y="304" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="700" letter-spacing="${tracking}" fill="${definition.accentC}" clip-path="url(#deleteRemaining)">${text}</text><g transform="translate(${eraseX} 286) rotate(-14)"><rect x="-48" y="-24" width="96" height="48" rx="9" fill="#f0d8d3" stroke="#b9787d" stroke-width="2"/><rect x="6" y="-24" width="42" height="48" rx="7" fill="${definition.accentB}"/><path d="M6 -20V20" stroke="#ba777d" stroke-width="2" opacity=".7"/></g><path d="M${Math.max(168, eraseX - 104)} 332c38 10 68 6 100 0" stroke="#55544f" stroke-width="3" stroke-linecap="round" opacity=".16"/></g>`;
    }
    default:
      return '';
  }
}

function doubleTitleLayer(
  definition: LogoDefinition,
  rawFirst: string,
  rawSecond: string,
  phase: number,
): string {
  const firstDisplay = displayText(definition, rawFirst);
  const secondDisplay = displayText(definition, rawSecond);
  const first = escapeXml(firstDisplay);
  const second = escapeXml(secondDisplay);
  const family = fontFamily(definition);
  const pulse = 0.64 + 0.36 * Math.sin(phase * Math.PI * 2);
  const firstSize = fitFontSize(firstDisplay, 660, 92, 30, definition.typography === 'mono' ? 0.63 : 0.57, definition.tracking);
  const secondSize = fitFontSize(secondDisplay, 660, 92, 30, definition.typography === 'mono' ? 0.63 : 0.57, definition.tracking);

  switch (definition.style) {
    case 'contrast': {
      const glyphFactor = 0.57;
      const totalChars = Math.max(1, [...firstDisplay].length + [...secondDisplay].length);
      const lockupSize = Math.max(24, Math.min(96, Math.floor(760 / (totalChars * glyphFactor))));
      const leftWidth = Math.max(50, Math.ceil([...firstDisplay].length * lockupSize * glyphFactor));
      const rightTextWidth = Math.max(38, Math.ceil([...secondDisplay].length * lockupSize * glyphFactor));
      const rightBoxWidth = rightTextWidth + 42;
      const gap = 20;
      const totalWidth = leftWidth + gap + rightBoxWidth;
      const startX = Math.round((LOGO_WIDTH - totalWidth) / 2);
      const leftEndX = startX + leftWidth;
      const boxX = leftEndX + gap;
      const boxY = 220 - Math.round((pulse - 0.64) * 4);
      return `<g filter="url(#titleShadow)" data-lockup="literal-two-part">
        <text x="${leftEndX}" y="305" text-anchor="end" font-family="${family}" font-size="${lockupSize}" font-weight="900" fill="${definition.accentA}">${first}</text>
        <rect x="${boxX}" y="${boxY}" width="${rightBoxWidth}" height="112" rx="12" fill="${definition.accentB}"/>
        <text x="${boxX + rightBoxWidth / 2}" y="302" text-anchor="middle" font-family="${family}" font-size="${lockupSize}" font-weight="900" fill="${definition.accentC}">${second}</text>
      </g>`;
    }
    case 'heroic': {
      const small = Math.min(firstSize, 58);
      const large = Math.min(secondSize, 112);
      const sweep = Math.round(210 + phase * 540);
      return `<g id="avengers-3d" filter="url(#titleShadow)"><defs><linearGradient id="avengersMetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f4f7f8"/><stop offset=".28" stop-color="#a7b7c0"/><stop offset=".58" stop-color="#566974"/><stop offset=".82" stop-color="#cbd4d8"/><stop offset="1" stop-color="#37464e"/></linearGradient><clipPath id="avengersLargeClip"><text x="480" y="350" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}">${second}</text></clipPath></defs><text x="480" y="224" text-anchor="middle" font-family="${family}" font-size="${small}" font-weight="700" letter-spacing="${definition.tracking + 2}" fill="#dce4e7">${first}</text>${[12,9,6,3].map((offset) => `<text x="${480 + offset}" y="${350 + offset}" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="#29363d">${second}</text>`).join('')}<text x="480" y="350" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#avengersMetal)" stroke="#e5ecef" stroke-width="1.6" stroke-opacity=".5">${second}</text><path d="M250 374L708 194" stroke="#c7d0d4" stroke-width="4" opacity=".32" clip-path="url(#avengersLargeClip)"/><rect x="${sweep}" y="252" width="20" height="134" fill="#ffffff" opacity=".22" clip-path="url(#avengersLargeClip)" filter="url(#softGlow)"/></g>`;
    }
    case 'spray': {
      const top = Math.min(firstSize, 106);
      const bottom = Math.min(secondSize, 110);
      const firstRotations = Array.from({ length: Math.max(1, [...firstDisplay].length) }, (_, i) => [-7, 2, -3, 5, -1][i % 5]).join(' ');
      const secondRotations = Array.from({ length: Math.max(1, [...secondDisplay].length) }, (_, i) => [4, -5, 2, -2, 6][i % 5]).join(' ');
      return `<g filter="url(#titleShadow)" transform="rotate(-4 480 270) skewX(-7)">
        <text x="494" y="254" text-anchor="middle" font-family="${family}" font-size="${top}" font-style="italic" font-weight="900" letter-spacing="-2" fill="#050505" stroke="#050505" stroke-width="20" stroke-linejoin="round">${first}</text>
        <text x="480" y="240" text-anchor="middle" font-family="${family}" font-size="${top}" font-style="italic" font-weight="900" letter-spacing="-2" fill="${definition.accentA}" stroke="#111111" stroke-width="12" stroke-linejoin="round" paint-order="stroke fill"><tspan rotate="${firstRotations}">${first}</tspan></text>
        <text x="480" y="240" text-anchor="middle" font-family="${family}" font-size="${top}" font-style="italic" font-weight="900" letter-spacing="-2" fill="none" stroke="${definition.accentC}" stroke-width="2.4" stroke-opacity=".7"><tspan rotate="${firstRotations}">${first}</tspan></text>
        <text x="496" y="372" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-style="italic" font-weight="900" letter-spacing="-2" fill="#050505" stroke="#050505" stroke-width="20" stroke-linejoin="round">${second}</text>
        <text x="480" y="356" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-style="italic" font-weight="900" letter-spacing="-2" fill="${definition.accentB}" stroke="#111111" stroke-width="12" stroke-linejoin="round" paint-order="stroke fill"><tspan rotate="${secondRotations}">${second}</tspan></text>
        <path d="M286 388C386 374 574 394 706 366" fill="none" stroke="${definition.accentC}" stroke-width="6" stroke-linecap="round" opacity=".8"/>
        <g stroke="${definition.accentB}" stroke-width="5" stroke-linecap="round" opacity=".72"><path d="M338 382v34"/><path d="M414 389v22"/><path d="M594 386v31"/><path d="M654 377v20"/></g>
        <g fill="${definition.accentA}" opacity=".72"><circle cx="272" cy="250" r="7"/><circle cx="294" cy="229" r="3"/><circle cx="712" cy="324" r="6"/><circle cx="735" cy="304" r="3"/></g>
      </g>`;
    }
    case 'shield': {
      const small = fitFontSize(firstDisplay, 760, 60, 20, 0.62, definition.tracking + 1);
      const large = fitFontSize(secondDisplay, 760, 102, 20, 0.62, definition.tracking);
      return `<g id="captainamerica-3d" filter="url(#titleShadow)"><defs><linearGradient id="captainMetal" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#edf3f7"/><stop offset=".34" stop-color="#b32636"/><stop offset=".56" stop-color="#f3f5f5"/><stop offset=".78" stop-color="#295d9d"/><stop offset="1" stop-color="#e8eef2"/></linearGradient></defs><text x="480" y="230" text-anchor="middle" font-family="${family}" font-size="${small}" font-weight="800" letter-spacing="${definition.tracking + 1}" fill="#e7edf1" stroke="#1a314e" stroke-width="2">${first}</text>${[11,8,5,2].map((offset) => `<text x="${480 + offset}" y="${354 + offset}" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="#5a1720">${second}</text>`).join('')}<text x="480" y="354" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#captainMetal)" stroke="#f6f8f9" stroke-width="2" stroke-opacity=".66">${second}</text><path d="M286 382H674" stroke="#edf3f7" stroke-width="3" opacity=".35"/></g>`;
    }
    case 'stone': {
      const top = Math.min(firstSize, 88);
      const bottom = Math.min(secondSize, 96);
      return `<g filter="url(#stoneShadow)">
        <defs>
          <clipPath id="stoneFirstClip"><text x="480" y="240" text-anchor="middle" font-family="${family}" font-size="${top}" font-weight="900" letter-spacing="${definition.tracking}">${first}</text></clipPath>
          <clipPath id="stoneSecondClip"><text x="480" y="358" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-weight="900" letter-spacing="${definition.tracking}">${second}</text></clipPath>
        </defs>
        ${[12,9,6,3].map((offset) => `<text x="${480 + offset}" y="${240 + offset}" text-anchor="middle" font-family="${family}" font-size="${top}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#stoneEdge)">${first}</text>`).join('')}
        <text x="480" y="240" text-anchor="middle" font-family="${family}" font-size="${top}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#stoneFace)" stroke="#5d6362" stroke-width="2.4">${first}</text>
        <g clip-path="url(#stoneFirstClip)">
          <g fill="#343a39" opacity=".24">${Array.from({ length: 22 }, (_, i) => `<circle cx="${292 + (i * 47) % 380}" cy="${174 + (i * 31) % 90}" r="${2 + (i % 4)}"/>`).join('')}</g>
          <path d="M322 180l38 32-24 24 42 32M506 174l-26 34 30 18-22 38M636 192l-34 30 26 28" stroke="#3c4241" stroke-width="3" fill="none" opacity=".82"/>
        </g>
        ${[13,10,7,4].map((offset) => `<text x="${480 + offset}" y="${358 + offset}" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#stoneEdge)">${second}</text>`).join('')}
        <text x="480" y="358" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#stoneFace)" stroke="#5d6362" stroke-width="2.4">${second}</text>
        <g clip-path="url(#stoneSecondClip)">
          <g fill="#303635" opacity=".26">${Array.from({ length: 26 }, (_, i) => `<circle cx="${270 + (i * 53) % 420}" cy="${294 + (i * 37) % 104}" r="${2 + (i % 5)}"/>`).join('')}</g>
          <path d="M300 302l46 28-26 38 38 26M492 296l-34 34 30 28-24 40M650 314l-42 32 34 28" stroke="#3a403f" stroke-width="3.2" fill="none" opacity=".84"/>
        </g>
        <path d="M300 405H660" stroke="#ffffff" stroke-width="1" opacity=".08"/>
      </g>`;
    }
    case 'duoneon': {
      const top = Math.min(firstSize, 88);
      const bottom = Math.min(secondSize, 92);
      return `<g id="dual-neon-lockup"><text x="480" y="244" text-anchor="middle" font-family="${family}" font-size="${top}" font-weight="700" letter-spacing="${definition.tracking}" fill="none" stroke="${definition.accentA}" stroke-width="20" stroke-opacity=".12" filter="url(#neonHalo)">${first}</text><text x="480" y="244" text-anchor="middle" font-family="${family}" font-size="${top}" font-weight="700" letter-spacing="${definition.tracking}" fill="none" stroke="${definition.accentA}" stroke-width="7" stroke-opacity=".52" filter="url(#softGlow)">${first}</text><text x="480" y="244" text-anchor="middle" font-family="${family}" font-size="${top}" font-weight="700" letter-spacing="${definition.tracking}" fill="none" stroke="#eaffff" stroke-width="2.2">${first}</text><text x="480" y="362" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-weight="700" letter-spacing="${definition.tracking}" fill="none" stroke="${definition.accentB}" stroke-width="20" stroke-opacity=".12" filter="url(#neonHalo)">${second}</text><text x="480" y="362" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-weight="700" letter-spacing="${definition.tracking}" fill="none" stroke="${definition.accentB}" stroke-width="7" stroke-opacity=".52" filter="url(#softGlow)">${second}</text><text x="480" y="362" text-anchor="middle" font-family="${family}" font-size="${bottom}" font-weight="700" letter-spacing="${definition.tracking}" fill="none" stroke="#fff0fa" stroke-width="2.2">${second}</text></g>`;
    }
    case 'storm': {
      const small = fitFontSize(firstDisplay, 760, 58, 20, 0.66, definition.tracking + 1);
      const large = fitFontSize(secondDisplay, 760, 104, 20, 0.66, definition.tracking);
      const flash = (0.10 + pulse * .18).toFixed(2);
      return `<g id="thor-metal" filter="url(#titleShadow)"><defs><linearGradient id="thorFace" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff8df"/><stop offset=".25" stop-color="#d9c88f"/><stop offset=".55" stop-color="#746b54"/><stop offset=".76" stop-color="#e4d6a8"/><stop offset="1" stop-color="#4c473a"/></linearGradient></defs><text x="480" y="222" text-anchor="middle" font-family="${family}" font-size="${small}" font-weight="800" letter-spacing="${definition.tracking + 1}" fill="#d9dce0">${first}</text>${[12,9,6,3].map((offset) => `<text x="${480 + offset}" y="${350 + offset}" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="#39362f">${second}</text>`).join('')}<text x="480" y="350" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#thorFace)" stroke="#f5f0df" stroke-width="1.6" stroke-opacity=".6">${second}</text><path d="M314 384H646" stroke="#d9c88f" stroke-width="3" opacity=".4"/><path d="M440 252l24 30-14 0 25 38M526 252l-24 30 14 0-25 38" stroke="#eaf7ff" stroke-width="3" fill="none" opacity="${flash}" filter="url(#softGlow)"/></g>`;
    }
    case 'cosmic': {
      const nameSize = fitFontSize(firstDisplay, 620, 86, 20, 0.60, definition.tracking);
      const sloganSize = fitFontSize(secondDisplay, 620, 54, 18, 0.60, definition.tracking + 1);
      return `<g id="amongus-copy" filter="url(#titleShadow)"><rect x="150" y="178" width="660" height="176" rx="28" fill="#050716" opacity=".62" stroke="#8bdfff" stroke-width="2" stroke-opacity=".22"/><text x="480" y="254" text-anchor="middle" font-family="${family}" font-size="${nameSize}" font-weight="900" letter-spacing="${definition.tracking}" fill="${definition.accentC}" stroke="#1b223a" stroke-width="5" paint-order="stroke fill">${first}</text><path d="M344 282H616" stroke="${definition.accentB}" stroke-width="3" opacity=".55"/><text x="480" y="326" text-anchor="middle" font-family="${family}" font-size="${sloganSize}" font-weight="700" letter-spacing="${definition.tracking + 1}" fill="${definition.accentB}">${second}</text></g>`;
    }
    case 'crimson': {
      const small = Math.min(firstSize, 58);
      const large = Math.min(secondSize, 102);
      return `<g id="deadpool-metal" filter="url(#titleShadow)"><defs><linearGradient id="deadpoolFace" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ef5a62"/><stop offset=".22" stop-color="#b51f2f"/><stop offset=".68" stop-color="#65111c"/><stop offset="1" stop-color="#2b080e"/></linearGradient></defs><text x="480" y="228" text-anchor="middle" font-family="${family}" font-size="${small}" font-weight="800" letter-spacing="${definition.tracking + 1}" fill="${definition.accentC}" stroke="#292929" stroke-width="2">${first}</text>${[10,7,4].map((offset) => `<text x="${480 + offset}" y="${354 + offset}" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="#25070b">${second}</text>`).join('')}<text x="480" y="354" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="url(#deadpoolFace)" stroke="#d4cbc7" stroke-width="1.5" stroke-opacity=".42">${second}</text><path d="M352 374L392 300M568 374L608 300" stroke="#1c1c1c" stroke-width="8" opacity=".7"/></g>`;
    }
    case 'rose': {
      const small = fitFontSize(firstDisplay, 680, 62, 18, 0.62, definition.tracking);
      const large = fitFontSize(secondDisplay, 680, 92, 18, 0.62, definition.tracking);
      return `<g id="born-pink-lockup" filter="url(#titleShadow)"><rect x="120" y="176" width="720" height="192" fill="#050304" stroke="${definition.accentA}" stroke-width="3" opacity=".96"/><text x="480" y="246" text-anchor="middle" font-family="${family}" font-size="${small}" font-weight="800" letter-spacing="${definition.tracking}" fill="${definition.accentC}">${first}</text><text x="480" y="334" text-anchor="middle" font-family="${family}" font-size="${large}" font-weight="900" letter-spacing="${definition.tracking}" fill="${definition.accentA}">${second}</text><path d="M184 270H776" stroke="${definition.accentB}" stroke-width="2" opacity=".7"/><path d="M152 192L172 236M808 192L788 236M152 352L172 316M808 352L788 316" stroke="${definition.accentA}" stroke-width="4" stroke-linecap="round"/></g>`;
    }
    default:
      return '';
  }
}

function titleLayer(definition: LogoDefinition, texts: readonly string[], phase: number): string {
  const first = texts[0];
  if (first === undefined) {
    throw AppError.badRequest('Textos inválidos para o logotipo.');
  }
  if (texts.length === 1) {
    return singleTitleLayer(definition, first, phase);
  }
  const second = texts[1];
  if (second === undefined) {
    throw AppError.badRequest('Textos inválidos para o logotipo.');
  }
  return doubleTitleLayer(definition, first, second, phase);
}

export function renderLogoSvgFrame(input: AnimatedLogoInput, frame: number): string {
  const normalized = normalizeAnimatedLogoInput(input);
  if (!Number.isInteger(frame) || frame < 0 || frame >= LOGO_FRAMES) {
    throw AppError.badRequest('Frame inválido para o logotipo.');
  }
  const definition = LOGO_MODEL_DEFINITIONS[normalized.model];
  const phase = frame / LOGO_FRAMES;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" viewBox="0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}" data-model="${normalized.model}" data-style="${definition.style}">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${definition.backgroundA}"/><stop offset=".56" stop-color="${definition.backgroundB}"/><stop offset="1" stop-color="#010102"/></linearGradient>
    <radialGradient id="vignette" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="${definition.accentA}" stop-opacity=".08"/><stop offset=".68" stop-color="#000" stop-opacity=".02"/><stop offset="1" stop-color="#000" stop-opacity=".52"/></radialGradient>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${definition.accentA}"/><stop offset=".5" stop-color="${definition.accentC}"/><stop offset="1" stop-color="${definition.accentB}"/></linearGradient>
    <linearGradient id="fade"><stop stop-color="${definition.accentA}" stop-opacity="0"/><stop offset=".5" stop-color="${definition.accentA}"/><stop offset="1" stop-color="${definition.accentA}" stop-opacity="0"/></linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${definition.accentC}"/><stop offset=".52" stop-color="${definition.accentA}"/><stop offset="1" stop-color="${definition.accentB}"/></linearGradient>
    <linearGradient id="neonTube" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffffff"/><stop offset=".42" stop-color="${definition.accentC}"/><stop offset="1" stop-color="${definition.accentA}"/></linearGradient>
    <linearGradient id="stoneFace" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f2ead8"/><stop offset=".26" stop-color="${definition.accentA}"/><stop offset=".68" stop-color="#918a79"/><stop offset="1" stop-color="#625d52"/></linearGradient>
    <linearGradient id="stoneEdge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#756f62"/><stop offset="1" stop-color="#2d2a25"/></linearGradient>
    <clipPath id="glitchSliceA"><rect x="0" y="214" width="960" height="23"/></clipPath>
    <clipPath id="glitchSliceB"><rect x="0" y="268" width="960" height="19"/></clipPath>
    <clipPath id="glitchSliceC"><rect x="0" y="318" width="960" height="17"/></clipPath>
    <filter id="glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="softGlow"><feGaussianBlur stdDeviation="4.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="neonGlow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="neonHalo"><feGaussianBlur stdDeviation="13"/></filter>
    <filter id="inkShadow"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".58"/></filter>
    <filter id="wetBlur"><feGaussianBlur stdDeviation="18"/></filter>
    <filter id="wetTextShadow"><feDropShadow dx="0" dy="3" stdDeviation="2.4" flood-color="#000" flood-opacity=".62"/></filter>
    <filter id="titleShadow"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".72"/></filter>
    <filter id="stoneShadow"><feDropShadow dx="6" dy="8" stdDeviation="3" flood-color="#000" flood-opacity=".72"/></filter>
  </defs>

  <rect width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" fill="url(#background)"/>
  ${backgroundLayer(definition, phase)}
  <rect width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" fill="url(#vignette)"/>
  ${effectLayer(definition, phase)}
  ${titleLayer(definition, normalized.texts, phase)}
  </svg>`;
}

function isMp4(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

export async function renderAnimatedLogo(
  input: AnimatedLogoInput,
  deps: AnimatedLogoDeps,
): Promise<AnimatedLogoResult> {
  const normalized = normalizeAnimatedLogoInput(input);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'bunnyfy-logo-'));
  const outputPath = path.join(workspace, 'logo.mp4');
  const run = deps.run ?? runSubprocess;

  try {
    for (let frame = 0; frame < LOGO_FRAMES; frame += 1) {
      const svg = renderLogoSvgFrame(normalized, frame);
      await sharp(Buffer.from(svg), { density: 96, limitInputPixels: LOGO_SVG_MAX_INPUT_PIXELS })
        .resize(LOGO_WIDTH, LOGO_HEIGHT, { fit: 'fill' })
        .png({ compressionLevel: 6 })
        .toFile(path.join(workspace, `frame-${String(frame).padStart(3, '0')}.png`));
    }

    await run(deps.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-framerate', String(LOGO_FPS),
      '-start_number', '0',
      '-i', path.join(workspace, 'frame-%03d.png'),
      '-frames:v', String(LOGO_FRAMES),
      '-vf', 'format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-movflags', '+faststart',
      '-an', '-y', outputPath,
    ], { timeoutMs: deps.timeoutMs, maxBufferBytes: 1024 * 1024 });

    const buffer = await fs.readFile(outputPath);
    if (!isMp4(buffer)) throw AppError.internal('O renderizador produziu um vídeo inválido.');
    if (buffer.length === 0 || buffer.length > deps.maxOutputBytes) {
      throw AppError.payloadTooLarge('O logotipo animado excede o limite permitido.');
    }
    return {
      buffer,
      mime: 'video/mp4',
      width: LOGO_WIDTH,
      height: LOGO_HEIGHT,
      fps: LOGO_FPS,
      frames: LOGO_FRAMES,
      durationSeconds: LOGO_DURATION_SECONDS,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof ToolNotFoundError) {
      throw AppError.toolUnavailable('Renderização animada indisponível no momento.');
    }
    if (error instanceof SubprocessTimeoutError) {
      throw AppError.upstreamTimeout('Tempo esgotado ao renderizar o logotipo.');
    }
    if (error instanceof SubprocessExitError) {
      throw AppError.unavailable('Não foi possível codificar o logotipo animado.');
    }
    throw AppError.internal('Não foi possível renderizar o logotipo.', {
      renderCode: error instanceof Error ? error.name : 'unknown',
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}
