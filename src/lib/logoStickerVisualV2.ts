import {
  renderStickerLogoSvg,
  type StickerLogoInput,
  type StickerLogoModel,
} from './logoStickerVisualAll.ts';
import { buildVectorTextPath, vectorTextMask, vectorTextPathElement } from './vectorText.ts';

const REFINED_MODELS = new Set<StickerLogoModel>([
  'flag',
  'avengers',
  'captainamerica',
  'thor',
  'deadpool',
]);

function defs(): string {
  return `<defs>
    <filter id="v2-shadow" x="-70%" y="-70%" width="240%" height="240%"><feDropShadow dx="0" dy="11" stdDeviation="11" flood-color="#000" flood-opacity=".62"/></filter>
    <filter id="v2-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="v2-steel" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffffff"/><stop offset=".18" stop-color="#cfd6df"/><stop offset=".46" stop-color="#596576"/><stop offset=".68" stop-color="#eef2f6"/><stop offset="1" stop-color="#303844"/></linearGradient>
    <linearGradient id="v2-gold" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff5bf"/><stop offset=".22" stop-color="#ddb950"/><stop offset=".55" stop-color="#765116"/><stop offset=".76" stop-color="#edce72"/><stop offset="1" stop-color="#3e2909"/></linearGradient>
    <linearGradient id="v2-red" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff9299"/><stop offset=".18" stop-color="#b91e31"/><stop offset=".62" stop-color="#600611"/><stop offset="1" stop-color="#210307"/></linearGradient>
  </defs>`;
}

function wrap(model: StickerLogoModel, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" data-model="${model}">${defs()}${body}</svg>`;
}

function shape(
  text: string,
  y: number,
  maxWidth: number,
  maxHeight: number,
  weight: number,
  tracking = 5,
  slant = 0,
) {
  return buildVectorTextPath(text, {
    x: 256,
    y,
    maxWidth,
    maxHeight,
    weight,
    tracking,
    slant,
  });
}

function refinedFlag(text: string, phase: number): string {
  const t = shape(text, 250, 394, 142, 20, 5);
  const third = t.width / 3;
  const wave = Math.round(Math.sin(phase * Math.PI * 2) * 5);
  const left = t.x - 18;
  const materialTop = Math.max(142, t.y - 30);
  const materialHeight = Math.min(238, t.height + 60);
  return wrap('flag', `
    ${vectorTextMask('flag-v2-mask', t, { strokeWidth: t.strokeWidth * 1.56, linecap: 'square', linejoin: 'bevel' })}
    <g filter="url(#v2-shadow)">
      <g transform="translate(11 14)">${vectorTextPathElement(t, { stroke: '#032b19', strokeWidth: t.strokeWidth * 1.95, linecap: 'square', linejoin: 'bevel' })}</g>
      ${vectorTextPathElement(t, { stroke: '#075f37', strokeWidth: t.strokeWidth * 1.78, linecap: 'square', linejoin: 'bevel' })}
      <g mask="url(#flag-v2-mask)" transform="translate(0 ${wave})">
        <rect x="${left.toFixed(1)}" y="${materialTop.toFixed(1)}" width="${third.toFixed(1)}" height="${materialHeight.toFixed(1)}" fill="#078348"/>
        <rect x="${(left + third).toFixed(1)}" y="${materialTop.toFixed(1)}" width="${third.toFixed(1)}" height="${materialHeight.toFixed(1)}" fill="#f7fff9"/>
        <rect x="${(left + third * 2).toFixed(1)}" y="${materialTop.toFixed(1)}" width="${third.toFixed(1)}" height="${materialHeight.toFixed(1)}" fill="#078348"/>
        <path d="M${left.toFixed(1)} 210Q256 178 ${(left + t.width + 36).toFixed(1)} 210M${left.toFixed(1)} 286Q256 320 ${(left + t.width + 36).toFixed(1)} 286" fill="none" stroke="#fff" stroke-width="10" stroke-opacity=".18"/>
      </g>
      ${vectorTextPathElement(t, { stroke: '#dffbed', strokeWidth: t.strokeWidth * .28, opacity: .58, linecap: 'square', linejoin: 'bevel' })}
      <path d="M104 351C164 371 220 365 256 350C298 332 350 338 410 357" fill="none" stroke="#078348" stroke-width="8" stroke-linecap="round" opacity=".74"/>
      <path d="M104 351C164 371 220 365 256 350C298 332 350 338 410 357" fill="none" stroke="#f8fff9" stroke-width="2" stroke-linecap="round" opacity=".64"/>
    </g>`);
}

function refinedAvengers(first: string, second: string, phase: number): string {
  const top = shape(first, 205, 324, 58, 12, 7);
  const main = shape(second, 296, 388, 104, 20, 5);
  const sweep = -80 + Math.round(phase * 520);
  return wrap('avengers', `
    <g filter="url(#v2-shadow)">
      <circle cx="256" cy="264" r="155" fill="#070b12" fill-opacity=".52" stroke="#8a98aa" stroke-width="4" stroke-opacity=".16"/>
      <path d="M191 354L258 143L327 354M224 278H302" fill="none" stroke="#8392a6" stroke-width="13" opacity=".10"/>
      <path d="M111 338Q256 384 401 338" fill="none" stroke="#8b98a9" stroke-width="3" opacity=".22"/>
      ${vectorTextPathElement(top, { stroke: '#151c26', strokeWidth: top.strokeWidth * 1.7, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(top, { stroke: 'url(#v2-steel)', strokeWidth: top.strokeWidth * 1.25, linecap: 'square', linejoin: 'bevel' })}
      <g transform="translate(10 12)">${vectorTextPathElement(main, { stroke: '#111720', strokeWidth: main.strokeWidth * 1.85, linecap: 'square', linejoin: 'bevel' })}</g>
      ${vectorTextPathElement(main, { stroke: 'url(#v2-steel)', strokeWidth: main.strokeWidth * 1.52, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(main, { stroke: '#ffffff', strokeWidth: main.strokeWidth * .22, opacity: .46, linecap: 'square', linejoin: 'bevel' })}
      <clipPath id="avengers-sweep"><rect x="${sweep}" y="152" width="44" height="220"/></clipPath>
      <g clip-path="url(#avengers-sweep)">${vectorTextPathElement(main, { stroke: '#ffffff', strokeWidth: main.strokeWidth * .58, opacity: .68, linecap: 'square', linejoin: 'bevel' })}</g>
    </g>`);
}

function refinedCaptainAmerica(first: string, second: string, phase: number): string {
  const top = shape(first, 205, 318, 56, 12, 6);
  const main = shape(second, 304, 370, 98, 19, 5);
  const pulse = .985 + Math.sin(phase * Math.PI * 2) * .012;
  return wrap('captainamerica', `
    <g filter="url(#v2-shadow)" transform="translate(256 256) scale(${pulse.toFixed(3)}) translate(-256 -256)">
      <circle cx="256" cy="258" r="154" fill="#070d18" stroke="#a91f35" stroke-width="18" opacity=".94"/>
      <circle cx="256" cy="258" r="123" fill="none" stroke="#edf1f4" stroke-width="13" opacity=".72"/>
      <circle cx="256" cy="258" r="96" fill="#183d70" opacity=".78"/>
      <path d="M256 173l19 39 43 6-31 30 7 43-38-20-38 20 8-43-32-30 43-6z" fill="#fff" opacity=".10"/>
      <rect x="103" y="176" width="306" height="168" rx="34" fill="#070b12" fill-opacity=".44"/>
      ${vectorTextPathElement(top, { stroke: '#17202c', strokeWidth: top.strokeWidth * 1.65, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(top, { stroke: '#f5f7f9', strokeWidth: top.strokeWidth * 1.18, linecap: 'square', linejoin: 'bevel' })}
      <g transform="translate(8 10)">${vectorTextPathElement(main, { stroke: '#300710', strokeWidth: main.strokeWidth * 1.82, linecap: 'square', linejoin: 'bevel' })}</g>
      ${vectorTextPathElement(main, { stroke: 'url(#v2-red)', strokeWidth: main.strokeWidth * 1.5, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(main, { stroke: '#fff2f3', strokeWidth: main.strokeWidth * .22, opacity: .5, linecap: 'square', linejoin: 'bevel' })}
    </g>`);
}

function refinedThor(first: string, second: string, phase: number): string {
  const top = shape(first, 202, 318, 55, 12, 7);
  const main = shape(second, 300, 378, 106, 21, 5);
  const bolt = Math.round(Math.sin(phase * Math.PI * 4) * 8);
  return wrap('thor', `
    <g filter="url(#v2-shadow)">
      <path d="M112 346Q256 392 400 346" fill="none" stroke="#c79d3e" stroke-width="5" opacity=".34"/>
      <circle cx="256" cy="258" r="154" fill="#080b0f" fill-opacity=".24" stroke="#d1b064" stroke-width="2" stroke-dasharray="6 18" opacity=".28"/>
      <path d="M94 178l38 28-23 35 45 24M418 180l-39 27 23 34-46 25" fill="none" stroke="#e7fbff" stroke-width="5" stroke-linecap="round" opacity=".48" transform="translate(${bolt} 0)"/>
      <path d="M232 129h48l22 38-22 28h-48l-22-28z" fill="#9e7a31" opacity=".14"/>
      ${vectorTextPathElement(top, { stroke: '#171d25', strokeWidth: top.strokeWidth * 1.62, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(top, { stroke: 'url(#v2-steel)', strokeWidth: top.strokeWidth * 1.22, linecap: 'square', linejoin: 'bevel' })}
      <g transform="translate(10 12)">${vectorTextPathElement(main, { stroke: '#2a1d08', strokeWidth: main.strokeWidth * 1.9, linecap: 'square', linejoin: 'bevel' })}</g>
      ${vectorTextPathElement(main, { stroke: 'url(#v2-gold)', strokeWidth: main.strokeWidth * 1.56, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(main, { stroke: '#fff4be', strokeWidth: main.strokeWidth * .22, opacity: .56, linecap: 'square', linejoin: 'bevel' })}
    </g>`);
}

function refinedDeadpool(first: string, second: string, phase: number): string {
  const top = shape(first, 204, 318, 56, 12, 6);
  const main = shape(second, 302, 370, 102, 20, 5);
  const slash = Math.round(Math.sin(phase * Math.PI * 2) * 5);
  return wrap('deadpool', `
    <g filter="url(#v2-shadow)">
      <circle cx="256" cy="258" r="151" fill="#0a0708" fill-opacity=".72" stroke="#8d1421" stroke-width="9" opacity=".78"/>
      <circle cx="256" cy="258" r="119" fill="none" stroke="#3c0b11" stroke-width="3" opacity=".62"/>
      <path d="M256 150V366" stroke="#8e1321" stroke-width="11" opacity=".42"/>
      <path d="M174 204Q212 174 239 222Q217 263 177 258M338 204Q300 174 273 222Q295 263 335 258" fill="none" stroke="#a61b29" stroke-width="12" opacity=".17"/>
      <rect x="105" y="177" width="302" height="168" rx="30" fill="#050506" fill-opacity=".48"/>
      <path d="M104 356L166 292M408 356L346 292" stroke="#b51d2d" stroke-width="6" stroke-linecap="round" opacity=".52" transform="translate(${slash} 0)"/>
      ${vectorTextPathElement(top, { stroke: '#1b1c20', strokeWidth: top.strokeWidth * 1.62, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(top, { stroke: '#f3eeee', strokeWidth: top.strokeWidth * 1.18, linecap: 'square', linejoin: 'bevel' })}
      <g transform="translate(8 10)">${vectorTextPathElement(main, { stroke: '#25050a', strokeWidth: main.strokeWidth * 1.82, linecap: 'square', linejoin: 'bevel' })}</g>
      ${vectorTextPathElement(main, { stroke: 'url(#v2-red)', strokeWidth: main.strokeWidth * 1.5, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(main, { stroke: '#ffd4d8', strokeWidth: main.strokeWidth * .2, opacity: .46, linecap: 'square', linejoin: 'bevel' })}
    </g>`);
}

export function renderStickerLogoSvgV2(input: StickerLogoInput, frame = 0): string {
  if (!REFINED_MODELS.has(input.model)) return renderStickerLogoSvg(input, frame);
  if (!Number.isInteger(frame) || frame < 0 || frame >= 24) throw new TypeError('Frame inválido.');
  const texts = input.texts.map((text) => String(text ?? '').trim()).filter(Boolean);
  const phase = frame / 24;
  if (input.model === 'flag') {
    if (texts.length !== 1) throw new TypeError('Modelo exige um texto.');
    return refinedFlag(texts[0]!, phase);
  }
  if (texts.length !== 2) throw new TypeError('Modelo exige dois textos.');
  switch (input.model) {
    case 'avengers': return refinedAvengers(texts[0]!, texts[1]!, phase);
    case 'captainamerica': return refinedCaptainAmerica(texts[0]!, texts[1]!, phase);
    case 'thor': return refinedThor(texts[0]!, texts[1]!, phase);
    case 'deadpool': return refinedDeadpool(texts[0]!, texts[1]!, phase);
    default: return renderStickerLogoSvg(input, frame);
  }
}
