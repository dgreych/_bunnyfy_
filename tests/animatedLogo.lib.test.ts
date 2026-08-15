import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import {
  LOGO_HEIGHT,
  LOGO_MODELS,
  LOGO_MODEL_DEFINITIONS,
  LOGO_WIDTH,
  renderAnimatedLogo,
  renderLogoSvgFrame,
} from '../src/lib/animatedLogo.ts';
import { SubprocessTimeoutError, ToolNotFoundError } from '../src/lib/subprocess.ts';

function validTexts(model: (typeof LOGO_MODELS)[number]): string[] {
  return LOGO_MODEL_DEFINITIONS[model].textCount === 1 ? ['BunnyFy'] : ['Bunny', 'Fy'];
}

test('os vinte aliases geram frames próprios com dimensões fixas', () => {
  assert.equal(LOGO_MODELS.length, 20);
  for (const model of LOGO_MODELS) {
    const svg = renderLogoSvgFrame({ model, texts: validTexts(model) }, 7);
    assert.match(svg, new RegExp(`width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}"`));
    assert.match(svg, new RegExp(`data-model="${model}"`));
    assert.equal(svg.includes('http://'), true, 'somente o namespace SVG fixo é permitido');
    assert.equal(svg.includes('https://'), false);
    assert.equal(svg.includes('<image'), false);
  }
});

test('o sistema visual separa tipografia, composição e linguagem por família', () => {
  const write = renderLogoSvgFrame({ model: 'write', texts: ['BunnyFy'] }, 7);
  const advanced = renderLogoSvgFrame({ model: 'advanced', texts: ['BunnyFy'] }, 7);
  const pixel = renderLogoSvgFrame({ model: 'pixel', texts: ['BunnyFy'] }, 7);
  const neon = renderLogoSvgFrame({ model: 'neon', texts: ['BunnyFy'] }, 7);
  const contrast = renderLogoSvgFrame({ model: 'pornhub', texts: ['Bunny', 'Fy'] }, 7);
  const shield = renderLogoSvgFrame({ model: 'captainamerica', texts: ['Bunny', 'Fy'] }, 7);
  const rose = renderLogoSvgFrame({ model: 'blackpink', texts: ['Bunny', 'Fy'] }, 7);

  assert.match(write, /font-style="italic"/);
  assert.match(write, /DejaVu Serif/);
  assert.match(advanced, /clipPath id="advancedGlowClip"/);
  assert.doesNotMatch(advanced, /SYSTEM \/ ACTIVE/);
  assert.match(pixel, /shape-rendering="crispEdges"/);
  assert.match(neon, /stroke="url\(#neonTube\)"/);
  assert.match(contrast, /height="112" rx="12"/);
  assert.match(shield, /id="captainamerica-3d"/);
  assert.match(rose, /id="born-pink-lockup"/);

  assert.notEqual(write, advanced);
  assert.notEqual(neon, contrast);
  assert.notEqual(shield, rose);
});

test('os seis modelos-base reproduzem a semântica literal dos efeitos históricos', () => {
  const glitch = renderLogoSvgFrame({ model: 'glitch', texts: ['BunnyFy'] }, 7);
  const write = renderLogoSvgFrame({ model: 'write', texts: ['BunnyFy'] }, 7);
  const neon = renderLogoSvgFrame({ model: 'neon', texts: ['BunnyFy'] }, 7);
  const contrast = renderLogoSvgFrame({ model: 'pornhub', texts: ['Bunny', 'Fy'] }, 7);
  const graffiti = renderLogoSvgFrame({ model: 'graffiti', texts: ['Bunny', 'Fy'] }, 7);
  const stone = renderLogoSvgFrame({ model: 'stone3d', texts: ['Bunny', 'Fy'] }, 7);

  assert.match(glitch, /clip-path="url\(#glitchSliceA\)"/);
  assert.match(glitch, /translate\(/);
  assert.doesNotMatch(glitch, /height="7" fill=/);

  assert.match(write, /id="wet-glass-scene"/);
  assert.match(write, /clipPath id="wetTextClip"/);
  assert.match(write, /filter="url\(#wetBlur\)"/);
  assert.doesNotMatch(write, /width="4" height="102"/);

  assert.match(neon, /stroke="url\(#neonTube\)"/);
  assert.match(neon, /filter="url\(#neonHalo\)"/);
  assert.match(neon, /clip-path="url\(#glitchSliceA\)"/);
  assert.doesNotMatch(neon, /width="768" height="308"/);

  assert.match(contrast, /rx="12"/);
  assert.doesNotMatch(contrast, /M-80 490L540 -20/);

  assert.match(graffiti, /id="graffiti-wall"/);
  assert.match(graffiti, /stroke-linejoin="round"/);
  assert.match(graffiti, /paint-order="stroke fill"/);
  assert.doesNotMatch(graffiti, /M42 420L760 84/);

  assert.match(stone, /clipPath id="stoneFirstClip"/);
  assert.match(stone, /fill="url\(#stoneFace\)"/);
  assert.match(stone, /fill="url\(#stoneEdge\)"/);
  assert.doesNotMatch(stone, /M0 128L166 90/);
});


test('os aliases carregam a semântica nominal dos templates históricos', () => {
  assert.equal(LOGO_MODEL_DEFINITIONS.glitch.label, 'Digital Glitch');
  assert.equal(LOGO_MODEL_DEFINITIONS.write.label, 'Wet Glass Writing');
  assert.equal(LOGO_MODEL_DEFINITIONS.neon.label, 'Neon Glitch');
  assert.equal(LOGO_MODEL_DEFINITIONS.pornhub.label, 'PornHub Style Lockup');
  assert.equal(LOGO_MODEL_DEFINITIONS.graffiti.label, 'Painted Graffiti');
  assert.equal(LOGO_MODEL_DEFINITIONS.stone3d.label, '3D Stone');
});


test('o segundo lote segue os contratos históricos literais', () => {
  const advanced = renderLogoSvgFrame({ model: 'advanced', texts: ['BunnyFy'] }, 9);
  const typography = renderLogoSvgFrame({ model: 'typography', texts: ['BunnyFy'] }, 9);
  const pixel = renderLogoSvgFrame({ model: 'pixel', texts: ['BunnyFy'] }, 9);
  const flag = renderLogoSvgFrame({ model: 'flag', texts: ['BunnyFy'] }, 9);
  const american = renderLogoSvgFrame({ model: 'americanflag', texts: ['BunnyFy'] }, 9);
  const deleting = renderLogoSvgFrame({ model: 'deleting', texts: ['BunnyFy'] }, 9);

  assert.match(advanced, /advancedGlowClip/);
  assert.match(advanced, /filter="url\(#neonHalo\)"/);
  assert.doesNotMatch(advanced, /SYSTEM \/ ACTIVE/);

  assert.match(typography, /id="pavement-scene"/);
  assert.match(typography, /id="pavement-type"/);
  assert.match(typography, /skewX\(-10\)/);

  assert.match(pixel, /shape-rendering="crispEdges"/);
  assert.match(pixel, /glitchSliceA/);
  assert.match(pixel, /glitchSliceB/);

  assert.match(flag, /id="nigeriaFlag"/);
  assert.match(flag, /#008753/);
  assert.match(flag, /#ffffff/);

  assert.match(american, /id="americanTextClip"/);
  assert.match(american, /#c92739/);
  assert.match(american, /#2457a6/);

  assert.match(deleting, /id="paper-scene"/);
  assert.match(deleting, /id="eraser-delete"/);
  assert.match(deleting, /deleteRemaining/);
  assert.match(deleting, /rotate\(-14\)/);
});


test('o terceiro lote fecha os oito contratos históricos restantes', () => {
  const darkgreen = renderLogoSvgFrame({ model: 'darkgreen', texts: ['BunnyFy'] }, 11);
  const avengers = renderLogoSvgFrame({ model: 'avengers', texts: ['Bunny', 'Fy'] }, 11);
  const captain = renderLogoSvgFrame({ model: 'captainamerica', texts: ['Bunny', 'Fy'] }, 11);
  const neon2 = renderLogoSvgFrame({ model: 'neon2', texts: ['Bunny', 'Fy'] }, 11);
  const thor = renderLogoSvgFrame({ model: 'thor', texts: ['Bunny', 'Fy'] }, 11);
  const amongus = renderLogoSvgFrame({ model: 'amongus', texts: ['Bunny', 'Fy'] }, 11);
  const deadpool = renderLogoSvgFrame({ model: 'deadpool', texts: ['Bunny', 'Fy'] }, 11);
  const blackpink = renderLogoSvgFrame({ model: 'blackpink', texts: ['Bunny', 'Fy'] }, 11);

  assert.match(darkgreen, /id="darkgreen-typography"/);
  assert.match(darkgreen, /id="darkGreenFace"/);
  assert.doesNotMatch(darkgreen, /M480 34L745 154/);

  assert.match(avengers, /id="avengers-3d"/);
  assert.match(avengers, /id="avengersMetal"/);
  assert.match(avengers, /avengersLargeClip/);

  assert.match(captain, /id="captain-disc"/);
  assert.match(captain, /id="captainamerica-3d"/);
  assert.match(captain, /id="captainMetal"/);

  assert.match(neon2, /id="dual-neon-lockup"/);
  assert.match(neon2, /filter="url\(#neonHalo\)"/);
  assert.match(neon2, /#eaffff/);

  assert.match(thor, /id="thor-metal"/);
  assert.match(thor, /id="thorFace"/);
  assert.match(thor, /#eaf7ff/);

  assert.match(amongus, /id="amongus-banner"/);
  assert.match(amongus, /id="amongus-copy"/);
  assert.match(amongus, /fill="#bfeeff"/);

  assert.match(deadpool, /id="deadpool-backdrop"/);
  assert.match(deadpool, /id="deadpool-metal"/);
  assert.match(deadpool, /id="deadpoolFace"/);

  assert.match(blackpink, /id="born-pink-frame"/);
  assert.match(blackpink, /id="born-pink-lockup"/);
  assert.match(blackpink, /#ef7fb5/);
});

test('texto é normalizado e escapado antes de entrar no SVG', () => {
  const svg = renderLogoSvgFrame({ model: 'glitch', texts: ['<script> & "x"'] }, 0);
  assert.equal(svg.includes('<script>'), false);
  assert.match(svg, /&lt;SCRIPT&gt; &amp; &quot;X&quot;/);
});

test('cardinalidade, modelo livre, texto vazio e frame inválido são recusados', () => {
  assert.throws(() => renderLogoSvgFrame({ model: 'glitch', texts: ['A', 'B'] }, 0));
  assert.throws(() => renderLogoSvgFrame({ model: 'neon2', texts: ['A'] }, 0));
  assert.throws(() => renderLogoSvgFrame({ model: 'livre' as never, texts: ['A'] }, 0));
  assert.throws(() => renderLogoSvgFrame({ model: 'glitch', texts: [''] }, 0));
  assert.throws(() => renderLogoSvgFrame({ model: 'glitch', texts: ['A'] }, -1));
});

test('ffmpeg real produz MP4 curto válido e remove o workspace isolado', async (t) => {
  // Rastreia o workspace exato criado por ESTA chamada em vez de comparar um
  // snapshot do os.tmpdir() compartilhado. logoStickerRenderer.ts usa o
  // prefixo 'bunnyfy-logo-sticker-', que começa com o mesmo texto
  // 'bunnyfy-logo-' filtrado aqui; como arquivos de teste diferentes rodam em
  // paralelo, um workspace do outro módulo podia ser flagrado como "sobra"
  // por pura coincidência de timing.
  const originalMkdtemp = fs.mkdtemp;
  const capturedWorkspaces: string[] = [];
  t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => {
    const created = await originalMkdtemp(...args);
    capturedWorkspaces.push(created);
    return created;
  });

  const result = await renderAnimatedLogo({ model: 'glitch', texts: ['BunnyFy'] }, {
    ffmpegPath: 'ffmpeg', timeoutMs: 45_000, maxOutputBytes: 8 * 1024 * 1024,
  });
  assert.equal(result.mime, 'video/mp4');
  assert.equal(result.buffer.subarray(4, 8).toString('ascii'), 'ftyp');
  assert.equal(result.width, LOGO_WIDTH);
  assert.equal(result.height, LOGO_HEIGHT);
  assert.ok(result.buffer.length > 10_000);

  assert.equal(capturedWorkspaces.length, 1);
  await assert.rejects(fs.access(capturedWorkspaces[0]!));
});

test('ferramenta ausente e timeout viram erros públicos estáveis', async () => {
  await assert.rejects(
    renderAnimatedLogo({ model: 'neon', texts: ['Teste'] }, {
      ffmpegPath: 'ausente', timeoutMs: 1, maxOutputBytes: 100_000,
      run: async () => { throw new ToolNotFoundError('ausente'); },
    }),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'BUNNYFY_TOOL_UNAVAILABLE'),
  );
  await assert.rejects(
    renderAnimatedLogo({ model: 'neon', texts: ['Teste'] }, {
      ffmpegPath: 'ffmpeg', timeoutMs: 1, maxOutputBytes: 100_000,
      run: async () => { throw new SubprocessTimeoutError('ffmpeg', 1); },
    }),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'BUNNYFY_TIMEOUT'),
  );
});
