import { buildVectorTextPath, vectorTextMask, vectorTextPathElement } from './vectorText.ts';

export const STICKER_LOGO_SIZE = 512;
export const ANCHOR_LOGO_MODELS = ['glitch', 'write', 'neon', 'pornhub', 'stone3d', 'graffiti'] as const;
export type AnchorLogoModel = (typeof ANCHOR_LOGO_MODELS)[number];

export interface AnchorLogoInput {
  model: AnchorLogoModel;
  texts: readonly string[];
}

function defs(): string {
  return `<defs>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity=".58"/></filter>
    <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="bigGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="16"/></filter>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ccecf6" stop-opacity=".18"/><stop offset=".45" stop-color="#6f9dac" stop-opacity=".08"/><stop offset="1" stop-color="#071014" stop-opacity=".38"/></linearGradient>
    <linearGradient id="stone" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f0e7d0"/><stop offset=".22" stop-color="#bdb39d"/><stop offset=".62" stop-color="#706b60"/><stop offset="1" stop-color="#37352f"/></linearGradient>
    <linearGradient id="stoneEdge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#676257"/><stop offset="1" stop-color="#171715"/></linearGradient>
    <linearGradient id="neonTube" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ff55d8"/><stop offset=".48" stop-color="#fff6ff"/><stop offset="1" stop-color="#5ff4ff"/></linearGradient>
  </defs>`;
}

function wrap(model: AnchorLogoModel, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" data-model="${model}">${defs()}${body}</svg>`;
}

function glitch(text: string, phase: number): string {
  const shape = buildVectorTextPath(text, { x: 256, y: 254, maxWidth: 390, maxHeight: 142, tracking: 7, weight: 14 });
  const slice = Math.round(Math.sin(phase * Math.PI * 6) * 14);
  return wrap('glitch', `
    <g filter="url(#shadow)">
      <path d="M72 154L438 132L454 352L90 374L62 316L78 260L58 212Z" fill="#07090e" fill-opacity=".94" stroke="#1b2430" stroke-width="2"/>
      <path d="M74 174H438M68 204H446M82 334H442" stroke="#d9f7ff" stroke-opacity=".06"/>
      <g opacity=".52" transform="translate(-8 0)">${vectorTextPathElement(shape, { stroke: '#ff2bd6', strokeWidth: shape.strokeWidth * 1.18 })}</g>
      <g opacity=".55" transform="translate(8 0)">${vectorTextPathElement(shape, { stroke: '#00f5ff', strokeWidth: shape.strokeWidth * 1.18 })}</g>
      ${vectorTextPathElement(shape, { stroke: '#f9fcff', strokeWidth: shape.strokeWidth, extra: 'filter="url(#softGlow)"' })}
      <clipPath id="sliceA"><rect x="62" y="216" width="394" height="18"/></clipPath>
      <clipPath id="sliceB"><rect x="62" y="274" width="394" height="14"/></clipPath>
      <g clip-path="url(#sliceA)" transform="translate(${slice} 0)">${vectorTextPathElement(shape, { stroke: '#00f5ff', strokeWidth: shape.strokeWidth * 1.06 })}</g>
      <g clip-path="url(#sliceB)" transform="translate(${-slice} 0)">${vectorTextPathElement(shape, { stroke: '#ff2bd6', strokeWidth: shape.strokeWidth * 1.06 })}</g>
      <g fill="#00f5ff" opacity=".8"><rect x="108" y="186" width="46" height="5"/><rect x="382" y="308" width="38" height="4"/><rect x="320" y="170" width="20" height="3"/></g>
      <g fill="#ff2bd6" opacity=".76"><rect x="94" y="324" width="54" height="4"/><rect x="356" y="198" width="62" height="5"/></g>
    </g>`);
}

function write(text: string, phase: number): string {
  const shape = buildVectorTextPath(text, { x: 256, y: 258, maxWidth: 372, maxHeight: 148, tracking: 3, weight: 11, slant: -0.22 });
  const reveal = 78 + Math.round(Math.min(1, phase * 1.45) * 360);
  const dripShift = Math.round(Math.sin(phase * Math.PI * 2) * 5);
  return wrap('write', `
    <g filter="url(#shadow)" transform="rotate(-2 256 256)">
      <path d="M82 112Q252 72 430 108L446 366Q260 424 68 382L76 226Z" fill="url(#glass)" stroke="#d9f4fb" stroke-opacity=".28" stroke-width="2.4"/>
      <path d="M100 128Q258 92 416 122" fill="none" stroke="#ffffff" stroke-opacity=".30" stroke-width="3"/>
      <g fill="#dff7fb" opacity=".16"><circle cx="156" cy="176" r="44"/><circle cx="362" cy="304" r="56"/><circle cx="302" cy="152" r="28"/></g>
      <g fill="#e9fbff" opacity=".38"><ellipse cx="128" cy="174" rx="8" ry="14"/><ellipse cx="390" cy="202" rx="6" ry="11"/><ellipse cx="344" cy="326" rx="10" ry="17"/><ellipse cx="172" cy="346" rx="5" ry="9"/><ellipse cx="278" cy="126" rx="4" ry="7"/></g>
      <g stroke="#d7f2f8" stroke-opacity=".30" stroke-linecap="round"><path d="M132 160v${60 + dripShift}" stroke-width="3"/><path d="M392 190v${78 - dripShift}" stroke-width="2"/><path d="M346 310v${54 + dripShift}" stroke-width="4"/><path d="M210 126v44" stroke-width="2"/><path d="M278 120v36" stroke-width="1.7"/></g>
      <mask id="reveal"><rect width="512" height="512" fill="#000"/><rect x="64" y="156" width="${reveal}" height="214" rx="36" fill="#fff"/></mask>
      <g opacity=".34" filter="url(#softGlow)">${vectorTextPathElement(shape, { stroke: '#031015', strokeWidth: shape.strokeWidth * 3.4 })}</g>
      <g mask="url(#reveal)" opacity=".92" filter="url(#softGlow)">${vectorTextPathElement(shape, { stroke: '#eefcff', strokeWidth: shape.strokeWidth * 1.65 })}</g>
      ${vectorTextPathElement(shape, { stroke: '#c5e9f0', strokeWidth: shape.strokeWidth * .62, opacity: .98 })}
      <path d="M118 334C182 354 312 356 405 326C374 348 334 359 296 362" fill="none" stroke="#e8fbff" stroke-width="5" stroke-linecap="round" stroke-opacity=".66"/>
      <path d="M118 339C184 360 314 362 408 332" fill="none" stroke="#071418" stroke-width="13" stroke-linecap="round" stroke-opacity=".18"/>
      <circle cx="412" cy="324" r="4" fill="#f5ffff" opacity=".64"/>
    </g>`);
}

function neon(text: string, phase: number): string {
  const shape = buildVectorTextPath(text, { x: 256, y: 256, maxWidth: 372, maxHeight: 138, tracking: 8, weight: 8 });
  const flicker = 0.82 + Math.sin(phase * Math.PI * 8) * .08;
  return wrap('neon', `
    <g filter="url(#shadow)">
      <path d="M76 132Q256 92 436 132L452 344Q256 396 60 344Z" fill="#08060b" fill-opacity=".94" stroke="#312334" stroke-width="2"/>
      <path d="M98 154Q256 126 414 154" fill="none" stroke="#fff" stroke-opacity=".06"/>
      <g opacity=".30" filter="url(#bigGlow)">${vectorTextPathElement(shape, { stroke: '#ff37d0', strokeWidth: shape.strokeWidth * 5.2 })}</g>
      <g opacity=".24" filter="url(#bigGlow)" transform="translate(4 0)">${vectorTextPathElement(shape, { stroke: '#48eaff', strokeWidth: shape.strokeWidth * 4.4 })}</g>
      <g opacity="${flicker.toFixed(2)}" filter="url(#softGlow)">${vectorTextPathElement(shape, { stroke: 'url(#neonTube)', strokeWidth: shape.strokeWidth * 1.45 })}</g>
      ${vectorTextPathElement(shape, { stroke: '#fff9ff', strokeWidth: shape.strokeWidth * .48, opacity: .96 })}
      <g fill="#ff55d8"><circle cx="98" cy="334" r="3"/><circle cx="416" cy="176" r="2"/></g>
      <g fill="#63f6ff"><circle cx="116" cy="174" r="2"/><circle cx="398" cy="330" r="3"/></g>
    </g>`);
}

function pornhub(first: string, second: string): string {
  const left = buildVectorTextPath(first, { x: 244, y: 256, maxWidth: 194, maxHeight: 86, tracking: 3, weight: 15, align: 'right' });
  const right = buildVectorTextPath(second, { x: 270, y: 256, maxWidth: 154, maxHeight: left.height, tracking: 3, weight: 15, align: 'left' });
  const commonTop = 256 - Math.max(left.height, right.height) / 2;
  const commonHeight = Math.max(left.height, right.height);
  const boxX = Math.max(258, right.x - 16);
  const boxW = Math.min(188, right.width + 32);
  const plateX = Math.max(42, left.x - 28);
  const plateRight = Math.min(470, boxX + boxW + 24);
  const plateY = commonTop - 34;
  const plateH = commonHeight + 68;
  return wrap('pornhub', `
    <g filter="url(#shadow)">
      <path d="M${plateX.toFixed(1)} ${(plateY + 10).toFixed(1)}Q256 ${(plateY - 7).toFixed(1)} ${plateRight.toFixed(1)} ${(plateY + 10).toFixed(1)}L${(plateRight - 8).toFixed(1)} ${(plateY + plateH - 6).toFixed(1)}Q256 ${(plateY + plateH + 8).toFixed(1)} ${(plateX + 8).toFixed(1)} ${(plateY + plateH - 6).toFixed(1)}Z" fill="#080808" fill-opacity=".98" stroke="#282828" stroke-width="2"/>
      <path d="M${(plateX + 18).toFixed(1)} ${(plateY + 18).toFixed(1)}H${(plateRight - 18).toFixed(1)}" stroke="#ffffff" stroke-opacity=".08" stroke-width="2"/>
      ${vectorTextPathElement(left, { stroke: '#ffffff', strokeWidth: left.strokeWidth, linecap: 'square', linejoin: 'bevel' })}
      <rect x="${boxX.toFixed(1)}" y="${(commonTop - 14).toFixed(1)}" width="${boxW.toFixed(1)}" height="${(commonHeight + 28).toFixed(1)}" rx="16" fill="#ff9900"/>
      <path d="M${(boxX + 12).toFixed(1)} ${(commonTop - 5).toFixed(1)}H${(boxX + boxW - 12).toFixed(1)}" stroke="#ffc35f" stroke-width="3" stroke-linecap="round" opacity=".68"/>
      ${vectorTextPathElement(right, { stroke: '#111111', strokeWidth: right.strokeWidth, linecap: 'square', linejoin: 'bevel' })}
      <path d="M${(plateX + 20).toFixed(1)} ${(plateY + plateH + 9).toFixed(1)}H${(plateRight - 20).toFixed(1)}" stroke="#ff9900" stroke-width="3" opacity=".62"/>
    </g>`);
}

function stone3d(first: string, second: string, phase: number): string {
  const top = buildVectorTextPath(first, { x: 256, y: 214, maxWidth: 354, maxHeight: 98, tracking: 6, weight: 18 });
  const bottom = buildVectorTextPath(second, { x: 256, y: 306, maxWidth: 378, maxHeight: 116, tracking: 6, weight: 20 });
  const dust = Math.round(Math.sin(phase * Math.PI * 2) * 5);
  return wrap('stone3d', `
    ${vectorTextMask('stoneTop', top, { strokeWidth: top.strokeWidth * 1.28, linecap: 'square', linejoin: 'bevel' })}
    ${vectorTextMask('stoneBottom', bottom, { strokeWidth: bottom.strokeWidth * 1.28, linecap: 'square', linejoin: 'bevel' })}
    <g filter="url(#shadow)">
      <ellipse cx="256" cy="366" rx="168" ry="26" fill="#000" opacity=".34"/>
      <g transform="translate(11 13)" opacity=".88">${vectorTextPathElement(top, { stroke: '#201f1c', strokeWidth: top.strokeWidth * 1.75, linecap: 'square', linejoin: 'bevel' })}${vectorTextPathElement(bottom, { stroke: '#201f1c', strokeWidth: bottom.strokeWidth * 1.75, linecap: 'square', linejoin: 'bevel' })}</g>
      ${vectorTextPathElement(top, { stroke: 'url(#stone)', strokeWidth: top.strokeWidth * 1.55, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(top, { stroke: '#f0e9d8', strokeWidth: top.strokeWidth * .32, opacity: .54, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(bottom, { stroke: 'url(#stone)', strokeWidth: bottom.strokeWidth * 1.55, linecap: 'square', linejoin: 'bevel' })}
      ${vectorTextPathElement(bottom, { stroke: '#f0e9d8', strokeWidth: bottom.strokeWidth * .32, opacity: .52, linecap: 'square', linejoin: 'bevel' })}
      <g mask="url(#stoneTop)" stroke="#35342f" stroke-width="3" opacity=".82"><path d="M142 174l36 38-20 32 38 26M244 164l-22 36 28 24-18 36M342 170l-38 30 30 34"/></g>
      <g mask="url(#stoneBottom)" stroke="#34332e" stroke-width="3.4" opacity=".84"><path d="M130 276l44 34-24 36 44 26M270 260l-34 44 28 22-22 50M380 272l-42 34 34 30"/></g>
      <g fill="#aaa18e" opacity=".72"><circle cx="148" cy="386" r="5"/><circle cx="190" cy="397" r="3"/><circle cx="336" cy="390" r="4"/><circle cx="374" cy="382" r="3"/><circle cx="${256 + dust}" cy="400" r="2"/></g>
    </g>`);
}

function graffiti(first: string, second: string, phase: number): string {
  const top = buildVectorTextPath(first, { x: 256, y: 220, maxWidth: 360, maxHeight: 110, tracking: 2, weight: 18, slant: -0.14 });
  const bottom = buildVectorTextPath(second, { x: 256, y: 310, maxWidth: 376, maxHeight: 118, tracking: 2, weight: 20, slant: -0.12 });
  const wobble = Math.round(Math.sin(phase * Math.PI * 4) * 4);
  return wrap('graffiti', `
    <g filter="url(#shadow)" transform="rotate(-4 256 256)">
      <path d="M62 130L450 108L466 364L82 394L48 326L70 272L48 212Z" fill="#191817" stroke="#3a3833" stroke-width="3"/>
      <g stroke="#d4cec1" stroke-opacity=".09"><path d="M60 190H454M58 274H460M82 354H446"/><path d="M156 122V382M318 116V374"/></g>
      <g transform="translate(${wobble} 0)">${vectorTextPathElement(top, { stroke: '#080808', strokeWidth: top.strokeWidth * 2.5, linecap: 'round', linejoin: 'round' })}</g>
      <g transform="translate(${wobble} 0)">${vectorTextPathElement(top, { stroke: '#eaff55', strokeWidth: top.strokeWidth * 1.45, linecap: 'round', linejoin: 'round' })}</g>
      <g transform="translate(${wobble} 0)">${vectorTextPathElement(top, { stroke: '#80f3ff', strokeWidth: top.strokeWidth * .30, opacity: .8 })}</g>
      <g transform="translate(${-wobble} 0)">${vectorTextPathElement(bottom, { stroke: '#080808', strokeWidth: bottom.strokeWidth * 2.5, linecap: 'round', linejoin: 'round' })}</g>
      <g transform="translate(${-wobble} 0)">${vectorTextPathElement(bottom, { stroke: '#ff4fb4', strokeWidth: bottom.strokeWidth * 1.46, linecap: 'round', linejoin: 'round' })}</g>
      <g transform="translate(${-wobble} 0)">${vectorTextPathElement(bottom, { stroke: '#ffe7f7', strokeWidth: bottom.strokeWidth * .28, opacity: .82 })}</g>
      <g fill="#ff4fb4"><circle cx="92" cy="202" r="8"/><circle cx="112" cy="184" r="3"/><circle cx="410" cy="340" r="7"/><circle cx="432" cy="322" r="3"/></g>
      <g stroke="#ff4fb4" stroke-width="7" stroke-linecap="round" opacity=".8"><path d="M154 356v38"/><path d="M214 364v22"/><path d="M344 354v34"/></g>
      <path d="M116 388Q256 368 408 380" fill="none" stroke="#80f3ff" stroke-width="6" stroke-linecap="round" opacity=".72"/>
    </g>`);
}

export function renderAnchorLogoSvg(input: AnchorLogoInput, frame = 0): string {
  if (!Number.isInteger(frame) || frame < 0 || frame >= 24) throw new TypeError('Frame inválido.');
  const phase = frame / 24;
  const texts = input.texts.map((text) => String(text ?? '').trim()).filter(Boolean);
  if (input.model === 'glitch' || input.model === 'write' || input.model === 'neon') {
    if (texts.length !== 1) throw new TypeError('Modelo exige um texto.');
  } else if (texts.length !== 2) {
    throw new TypeError('Modelo exige dois textos.');
  }
  switch (input.model) {
    case 'glitch': return glitch(texts[0]!, phase);
    case 'write': return write(texts[0]!, phase);
    case 'neon': return neon(texts[0]!, phase);
    case 'pornhub': return pornhub(texts[0]!, texts[1]!);
    case 'stone3d': return stone3d(texts[0]!, texts[1]!, phase);
    case 'graffiti': return graffiti(texts[0]!, texts[1]!, phase);
  }
}
