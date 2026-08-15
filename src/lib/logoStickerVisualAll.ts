import { renderAnchorLogoSvg, type AnchorLogoModel } from './logoStickerVisual.ts';
import { buildVectorTextPath, vectorTextMask, vectorTextPathElement } from './vectorText.ts';

export const STICKER_LOGO_MODELS = [
  'darkgreen', 'glitch', 'write', 'advanced', 'typography', 'pixel', 'neon', 'flag',
  'americanflag', 'deleting', 'pornhub', 'avengers', 'graffiti', 'captainamerica',
  'stone3d', 'neon2', 'thor', 'amongus', 'deadpool', 'blackpink',
] as const;
export type StickerLogoModel = (typeof STICKER_LOGO_MODELS)[number];
export interface StickerLogoInput { readonly model: StickerLogoModel; readonly texts: readonly string[]; }

const ANCHORS = new Set<StickerLogoModel>(['glitch','write','neon','pornhub','stone3d','graffiti']);
const ONE_TEXT = new Set<StickerLogoModel>(['darkgreen','glitch','write','advanced','typography','pixel','neon','flag','americanflag','deleting']);

function defs(): string {
  return `<defs>
    <filter id="s" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".62"/></filter>
    <filter id="g" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="gb" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18"/></filter>
    <linearGradient id="emerald" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#8fffc9"/><stop offset=".18" stop-color="#24b66b"/><stop offset=".62" stop-color="#0a653d"/><stop offset="1" stop-color="#043522"/></linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".22" stop-color="#abb8c8"/><stop offset=".5" stop-color="#3c4859"/><stop offset=".7" stop-color="#d9e0e8"/><stop offset="1" stop-color="#343b45"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff4ba"/><stop offset=".25" stop-color="#d2aa4c"/><stop offset=".58" stop-color="#79571d"/><stop offset=".78" stop-color="#e7c66d"/><stop offset="1" stop-color="#47320f"/></linearGradient>
    <linearGradient id="redmetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff8c91"/><stop offset=".22" stop-color="#a51e2c"/><stop offset=".68" stop-color="#4a0710"/><stop offset="1" stop-color="#1b0307"/></linearGradient>
  </defs>`;
}
function wrap(model: StickerLogoModel, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" data-model="${model}">${defs()}${body}</svg>`;
}
function v(text: string, y=256, maxWidth=380, maxHeight=132, weight=16, tracking=5, slant=0) {
  return buildVectorTextPath(text, { x:256, y, maxWidth, maxHeight, weight, tracking, slant });
}
function darkgreen(text: string, phase: number): string {
  const t=v(text,256,388,142,19,5); const sweep=86+Math.round(phase*350);
  return wrap('darkgreen', `${vectorTextMask('m',t,{strokeWidth:t.strokeWidth*1.42,linecap:'square',linejoin:'bevel'})}<g filter="url(#s)"><ellipse cx="256" cy="340" rx="164" ry="24" fill="#00170d" opacity=".45"/><g transform="translate(10 13)">${vectorTextPathElement(t,{stroke:'#012718',strokeWidth:t.strokeWidth*1.78,linecap:'square',linejoin:'bevel'})}</g>${vectorTextPathElement(t,{stroke:'url(#emerald)',strokeWidth:t.strokeWidth*1.55,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(t,{stroke:'#c4ffe2',strokeWidth:t.strokeWidth*.3,opacity:.52,linecap:'square',linejoin:'bevel'})}<g mask="url(#m)"><rect x="${sweep}" y="160" width="42" height="210" fill="#dffff0" opacity=".22" transform="skewX(-18)"/></g><path d="M98 354Q256 382 414 350" fill="none" stroke="#1fe178" stroke-width="3" opacity=".28"/></g>`);
}
function advanced(text: string, phase: number): string {
  const t=v(text,256,382,136,9,7); const pulse=.72+Math.sin(phase*Math.PI*4)*.12;
  return wrap('advanced', `<g filter="url(#s)"><ellipse cx="256" cy="256" rx="200" ry="112" fill="#03101b" opacity=".72"/><ellipse cx="256" cy="256" rx="178" ry="90" fill="none" stroke="#46cfff" stroke-width="3" opacity=".16"/><g filter="url(#gb)" opacity=".28">${vectorTextPathElement(t,{stroke:'#26c8ff',strokeWidth:t.strokeWidth*5})}</g><g filter="url(#g)" opacity="${pulse.toFixed(2)}">${vectorTextPathElement(t,{stroke:'#8ee7ff',strokeWidth:t.strokeWidth*1.65})}</g>${vectorTextPathElement(t,{stroke:'#fff',strokeWidth:t.strokeWidth*.52,opacity:.96})}<path d="M102 318C176 344 340 344 410 316" fill="none" stroke="#5ed8ff" stroke-width="4" opacity=".38"/></g>`);
}
function typography(text: string, phase: number): string {
  const t=v(text,260,354,116,18,4,-.11); const glint=Math.round(Math.sin(phase*Math.PI*2)*8);
  return wrap('typography', `<g filter="url(#s)" transform="rotate(-5 256 256)"><path d="M60 160L444 112L458 350L84 402L46 330Z" fill="#2a2a28" stroke="#4c4b46" stroke-width="3"/><g stroke="#d7d3c7" stroke-opacity=".12"><path d="M70 218L448 170M58 290L454 244M96 366L452 314"/><path d="M186 144L208 382M332 128L352 364"/></g><path d="M70 326L446 278" stroke="#f1e8bc" stroke-width="6" stroke-dasharray="48 22" opacity=".2"/>${vectorTextPathElement(t,{stroke:'#0b0b0a',strokeWidth:t.strokeWidth*2.1,linecap:'square',linejoin:'bevel'})}<g transform="translate(${glint} -3)">${vectorTextPathElement(t,{stroke:'#ece8dc',strokeWidth:t.strokeWidth*1.35,linecap:'square',linejoin:'bevel'})}</g>${vectorTextPathElement(t,{stroke:'#fffdf5',strokeWidth:t.strokeWidth*.25,opacity:.45,linecap:'square',linejoin:'bevel'})}</g>`);
}
function pixel(text: string, phase: number): string {
  const t=v(text,256,390,126,15,5); const dx=Math.round(Math.sin(phase*Math.PI*8)*10);
  return wrap('pixel', `<g filter="url(#s)"><g opacity=".55" transform="translate(${-7+dx} 0)">${vectorTextPathElement(t,{stroke:'#ff2dca',strokeWidth:t.strokeWidth*1.35,linecap:'square',linejoin:'bevel'})}</g><g opacity=".62" transform="translate(${7-dx} 0)">${vectorTextPathElement(t,{stroke:'#23eeff',strokeWidth:t.strokeWidth*1.35,linecap:'square',linejoin:'bevel'})}</g>${vectorTextPathElement(t,{stroke:'#f9fbff',strokeWidth:t.strokeWidth*1.05,linecap:'square',linejoin:'bevel'})}<g fill="#23eeff"><rect x="92" y="184" width="28" height="12"/><rect x="382" y="300" width="40" height="14"/><rect x="146" y="334" width="18" height="18"/></g><g fill="#ff2dca"><rect x="402" y="194" width="18" height="18"/><rect x="78" y="304" width="38" height="12"/><rect x="336" y="164" width="24" height="10"/></g></g>`);
}
function flag(text: string, phase: number): string {
  const t=v(text,256,388,144,19,5); const shift=Math.round(Math.sin(phase*Math.PI*2)*5);
  return wrap('flag', `${vectorTextMask('m',t,{strokeWidth:t.strokeWidth*1.48,linecap:'square',linejoin:'bevel'})}<g filter="url(#s)"><g transform="translate(10 13)">${vectorTextPathElement(t,{stroke:'#063d23',strokeWidth:t.strokeWidth*1.78,linecap:'square',linejoin:'bevel'})}</g><g mask="url(#m)" transform="translate(${shift} 0)"><rect x="60" y="150" width="132" height="220" fill="#06834a"/><rect x="192" y="150" width="128" height="220" fill="#fff"/><rect x="320" y="150" width="132" height="220" fill="#06834a"/><path d="M58 222Q256 190 454 222M58 294Q256 326 454 294" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="8"/></g>${vectorTextPathElement(t,{stroke:'#ddffed',strokeWidth:t.strokeWidth*.28,opacity:.5,linecap:'square',linejoin:'bevel'})}<path d="M104 360Q256 386 408 356" fill="none" stroke="#07834b" stroke-width="5" opacity=".42"/></g>`);
}
function americanflag(text: string, phase: number): string {
  const t=v(text,256,390,144,18,5); const shift=Math.round(Math.sin(phase*Math.PI*2)*4);
  return wrap('americanflag', `${vectorTextMask('m',t,{strokeWidth:t.strokeWidth*1.48,linecap:'square',linejoin:'bevel'})}<g filter="url(#s)"><g transform="translate(10 13)">${vectorTextPathElement(t,{stroke:'#281018',strokeWidth:t.strokeWidth*1.78,linecap:'square',linejoin:'bevel'})}</g><g mask="url(#m)" transform="translate(${shift} 0)"><rect x="56" y="150" width="404" height="220" fill="#f7f3e8"/><g fill="#b51d31"><rect x="56" y="150" width="404" height="24"/><rect x="56" y="198" width="404" height="24"/><rect x="56" y="246" width="404" height="24"/><rect x="56" y="294" width="404" height="24"/><rect x="56" y="342" width="404" height="24"/></g><rect x="56" y="150" width="152" height="116" fill="#1f3f79"/><g fill="#fff" opacity=".9"><circle cx="80" cy="174" r="5"/><circle cx="112" cy="192" r="5"/><circle cx="146" cy="174" r="5"/><circle cx="178" cy="194" r="5"/><circle cx="88" cy="228" r="5"/><circle cx="132" cy="232" r="5"/><circle cx="176" cy="230" r="5"/></g></g>${vectorTextPathElement(t,{stroke:'#fff',strokeWidth:t.strokeWidth*.25,opacity:.42,linecap:'square',linejoin:'bevel'})}</g>`);
}
function deleting(text: string, phase: number): string {
  const t=v(text,246,344,118,11,4,-.04); const eraseX=112+Math.round(Math.min(1,phase*1.18)*310);
  return wrap('deleting', `<mask id="erase"><rect width="512" height="512" fill="#000"/><path d="${t.d}" fill="none" stroke="#fff" stroke-width="${(t.strokeWidth*1.15).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/><rect x="${eraseX-64}" y="174" width="84" height="170" rx="22" fill="#000"/></mask><g filter="url(#s)" transform="rotate(-3 256 256)"><path d="M72 132L430 116L450 370L86 396L58 338Z" fill="#e9e4d9" stroke="#beb8ab" stroke-width="3"/><g stroke="#9d978c" stroke-opacity=".15"><path d="M86 184H430M82 238H436M78 292H442M86 346H438"/></g><g mask="url(#erase)">${vectorTextPathElement(t,{stroke:'#252729',strokeWidth:t.strokeWidth*1.15,opacity:.88})}</g><g transform="translate(${eraseX} 250) rotate(-18)"><rect x="-34" y="-22" width="68" height="44" rx="10" fill="#f3a7b0" stroke="#d17885" stroke-width="3"/><rect x="-34" y="4" width="68" height="18" rx="6" fill="#f6d8cf" opacity=".82"/></g><g fill="#4c4b47" opacity=".36"><circle cx="${eraseX-54}" cy="314" r="3"/><circle cx="${eraseX-40}" cy="324" r="2"/><circle cx="${eraseX-22}" cy="318" r="2.5"/></g></g>`);
}
function avengers(first:string,second:string,phase:number):string {
  const a=v(first,214,338,82,13,6); const b=v(second,304,382,112,20,5); const sweep=Math.round(phase*420)-60;
  return wrap('avengers', `<g filter="url(#s)"><circle cx="256" cy="264" r="154" fill="#080d15" opacity=".62" stroke="#6c788b" stroke-width="7" stroke-opacity=".18"/><path d="M192 368L262 134L326 368M234 282H300" fill="none" stroke="#7d8da5" stroke-width="16" opacity=".12"/>${vectorTextPathElement(a,{stroke:'url(#metal)',strokeWidth:a.strokeWidth*1.3,linecap:'square',linejoin:'bevel'})}<g transform="translate(9 12)">${vectorTextPathElement(b,{stroke:'#12171f',strokeWidth:b.strokeWidth*1.7,linecap:'square',linejoin:'bevel'})}</g>${vectorTextPathElement(b,{stroke:'url(#metal)',strokeWidth:b.strokeWidth*1.5,linecap:'square',linejoin:'bevel'})}<clipPath id="sw"><rect x="${sweep}" y="150" width="48" height="230"/></clipPath><g clip-path="url(#sw)">${vectorTextPathElement(b,{stroke:'#fff',strokeWidth:b.strokeWidth*.55,opacity:.75,linecap:'square',linejoin:'bevel'})}</g></g>`);
}
function captainamerica(first:string,second:string,phase:number):string {
  const a=v(first,210,330,80,13,5); const b=v(second,306,360,112,19,5); const pulse=.9+Math.sin(phase*Math.PI*2)*.05;
  return wrap('captainamerica', `<g filter="url(#s)" transform="scale(${pulse.toFixed(3)}) translate(${((1-pulse)*256).toFixed(1)} ${((1-pulse)*256).toFixed(1)})"><circle cx="256" cy="262" r="150" fill="#07101e" stroke="#b32136" stroke-width="20"/><circle cx="256" cy="262" r="118" fill="none" stroke="#eee" stroke-width="18" opacity=".8"/><circle cx="256" cy="262" r="86" fill="#163d71" opacity=".9"/><path d="M256 194l18 38 42 6-31 29 8 42-37-20-37 20 8-42-31-29 42-6z" fill="#fff" opacity=".14"/>${vectorTextPathElement(a,{stroke:'#f5f6f7',strokeWidth:a.strokeWidth*1.3,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(b,{stroke:'url(#redmetal)',strokeWidth:b.strokeWidth*1.5,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(b,{stroke:'#fff',strokeWidth:b.strokeWidth*.26,opacity:.4,linecap:'square',linejoin:'bevel'})}</g>`);
}
function neon2(first:string,second:string,phase:number):string {
  const a=v(first,218,340,90,8,5); const b=v(second,304,340,94,8,5); const flicker=.82+Math.sin(phase*Math.PI*10)*.1;
  return wrap('neon2', `<g filter="url(#s)"><path d="M82 120Q256 94 430 120L446 374Q256 402 66 374Z" fill="#09070d" fill-opacity=".88" stroke="#3b2b45" stroke-width="2"/><g filter="url(#gb)" opacity=".26">${vectorTextPathElement(a,{stroke:'#43f1ff',strokeWidth:a.strokeWidth*5})}${vectorTextPathElement(b,{stroke:'#ff4fd0',strokeWidth:b.strokeWidth*5})}</g><g opacity="${flicker.toFixed(2)}" filter="url(#g)">${vectorTextPathElement(a,{stroke:'#53f4ff',strokeWidth:a.strokeWidth*1.7})}${vectorTextPathElement(b,{stroke:'#ff55d5',strokeWidth:b.strokeWidth*1.7})}</g>${vectorTextPathElement(a,{stroke:'#f3ffff',strokeWidth:a.strokeWidth*.45})}${vectorTextPathElement(b,{stroke:'#fff2fb',strokeWidth:b.strokeWidth*.45})}<path d="M114 352H398" stroke="#ff55d5" stroke-width="3" opacity=".28"/></g>`);
}
function thor(first:string,second:string,phase:number):string {
  const a=v(first,214,340,86,13,6); const b=v(second,306,372,112,20,5); const bolt=Math.round(Math.sin(phase*Math.PI*4)*7);
  return wrap('thor', `<g filter="url(#s)"><path d="M80 350Q256 400 432 350" fill="none" stroke="#b78b31" stroke-width="5" opacity=".32"/><circle cx="256" cy="258" r="154" fill="none" stroke="#d2b56c" stroke-width="2" stroke-dasharray="8 20" opacity=".18"/><path d="M92 194l34 22-18 30 40 20M420 190l-36 26 20 28-42 22" fill="none" stroke="#dff7ff" stroke-width="5" opacity=".52" transform="translate(${bolt} 0)"/>${vectorTextPathElement(a,{stroke:'url(#metal)',strokeWidth:a.strokeWidth*1.25,linecap:'square',linejoin:'bevel'})}<g transform="translate(9 12)">${vectorTextPathElement(b,{stroke:'#30220c',strokeWidth:b.strokeWidth*1.75,linecap:'square',linejoin:'bevel'})}</g>${vectorTextPathElement(b,{stroke:'url(#gold)',strokeWidth:b.strokeWidth*1.5,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(b,{stroke:'#fff5c7',strokeWidth:b.strokeWidth*.25,opacity:.55,linecap:'square',linejoin:'bevel'})}</g>`);
}
function amongus(first:string,second:string,phase:number):string {
  const a=v(first,214,336,78,13,6); const b=v(second,296,352,76,10,4); const float=Math.round(Math.sin(phase*Math.PI*2)*5);
  return wrap('amongus', `<g filter="url(#s)"><path d="M54 148Q256 96 458 148L446 370Q256 418 66 370Z" fill="#070b22" stroke="#26305f" stroke-width="3"/><g fill="#fff" opacity=".55"><circle cx="108" cy="188" r="2"/><circle cx="396" cy="170" r="2"/><circle cx="344" cy="354" r="2"/><circle cx="166" cy="340" r="1.5"/></g><g transform="translate(74 ${250+float})"><path d="M0 0q0-34 28-34h22q28 0 28 34v56H52V34H26v22H0z" fill="#ef4150"/><rect x="40" y="-20" width="32" height="20" rx="10" fill="#9fd2e0"/><rect x="-12" y="6" width="16" height="34" rx="8" fill="#b52c3b"/></g><g transform="translate(366 ${256-float})"><path d="M0 0q0-30 25-30h20q25 0 25 30v52H46V32H24v20H0z" fill="#54c7d8"/><rect x="35" y="-18" width="29" height="18" rx="9" fill="#c7ecf2"/><rect x="-10" y="5" width="14" height="30" rx="7" fill="#2b8b9b"/></g>${vectorTextPathElement(a,{stroke:'#fff',strokeWidth:a.strokeWidth*1.15,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(b,{stroke:'#61d8ff',strokeWidth:b.strokeWidth*1.15})}<path d="M120 328H392" stroke="#6edcff" stroke-width="3" opacity=".36"/></g>`);
}
function deadpool(first:string,second:string,phase:number):string {
  const a=v(first,214,330,78,13,5); const b=v(second,306,350,106,18,5); const turn=phase*10-5;
  return wrap('deadpool', `<g filter="url(#s)" transform="rotate(${turn.toFixed(1)} 256 256)"><circle cx="256" cy="258" r="154" fill="#100306" stroke="#8e1322" stroke-width="10"/><circle cx="256" cy="258" r="118" fill="#08090b" stroke="#3c090f" stroke-width="4"/><path d="M256 142V374" stroke="#9f1725" stroke-width="14"/><path d="M190 202Q224 176 244 226Q220 270 190 260ZM322 202Q288 176 268 226Q292 270 322 260Z" fill="#a91b29" opacity=".32"/>${vectorTextPathElement(a,{stroke:'#f0e9e9',strokeWidth:a.strokeWidth*1.15,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(b,{stroke:'url(#redmetal)',strokeWidth:b.strokeWidth*1.5,linecap:'square',linejoin:'bevel'})}<path d="M102 354L160 292M410 354L352 292" stroke="#b21b2b" stroke-width="5" opacity=".55"/></g>`);
}
function blackpink(first:string,second:string,phase:number):string {
  const a=v(first,214,340,82,13,5); const b=v(second,302,350,100,17,5); const pulse=.92+Math.sin(phase*Math.PI*2)*.035;
  return wrap('blackpink', `<g filter="url(#s)" transform="scale(${pulse.toFixed(3)}) translate(${((1-pulse)*256).toFixed(1)} ${((1-pulse)*256).toFixed(1)})"><path d="M70 132L442 132L458 194L432 194L450 374L62 374L80 194L54 194Z" fill="#070607" stroke="#ff68b4" stroke-width="3"/><path d="M104 164H408M98 346H414" stroke="#ff68b4" stroke-width="2" opacity=".72"/><path d="M76 128L108 92L128 128M436 128L404 92L384 128M76 378L108 414L128 378M436 378L404 414L384 378" fill="none" stroke="#ff68b4" stroke-width="5" opacity=".58"/>${vectorTextPathElement(a,{stroke:'#fff',strokeWidth:a.strokeWidth*1.18,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(b,{stroke:'#ff63b6',strokeWidth:b.strokeWidth*1.45,linecap:'square',linejoin:'bevel'})}${vectorTextPathElement(b,{stroke:'#fff2fa',strokeWidth:b.strokeWidth*.24,opacity:.55,linecap:'square',linejoin:'bevel'})}</g>`);
}

export function renderStickerLogoSvg(input: StickerLogoInput, frame=0): string {
  if (!Number.isInteger(frame)||frame<0||frame>=24) throw new TypeError('Frame inválido.');
  const texts=input.texts.map(x=>String(x??'').trim()).filter(Boolean);
  const expected=ONE_TEXT.has(input.model)?1:2;
  if(texts.length!==expected) throw new TypeError(`Modelo exige ${expected} texto${expected===1?'':'s'}.`);
  if(ANCHORS.has(input.model)) return renderAnchorLogoSvg({model:input.model as AnchorLogoModel,texts},frame);
  const p=frame/24;
  switch(input.model){
    case 'darkgreen': return darkgreen(texts[0]!,p);
    case 'advanced': return advanced(texts[0]!,p);
    case 'typography': return typography(texts[0]!,p);
    case 'pixel': return pixel(texts[0]!,p);
    case 'flag': return flag(texts[0]!,p);
    case 'americanflag': return americanflag(texts[0]!,p);
    case 'deleting': return deleting(texts[0]!,p);
    case 'avengers': return avengers(texts[0]!,texts[1]!,p);
    case 'captainamerica': return captainamerica(texts[0]!,texts[1]!,p);
    case 'neon2': return neon2(texts[0]!,texts[1]!,p);
    case 'thor': return thor(texts[0]!,texts[1]!,p);
    case 'amongus': return amongus(texts[0]!,texts[1]!,p);
    case 'deadpool': return deadpool(texts[0]!,texts[1]!,p);
    case 'blackpink': return blackpink(texts[0]!,texts[1]!,p);
    default: throw new TypeError('Modelo sem renderer sticker-first.');
  }
}
