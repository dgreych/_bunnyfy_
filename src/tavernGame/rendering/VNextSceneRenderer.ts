// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
import Jimp from 'jimp';

import { TavernAssetRegistry } from './TavernAssetRegistry.ts';
import { COLORS, classVisual } from './VNextVisualTheme.ts';

const WIDTH = 1200;
const HEIGHT = 675;

function rect(canvas, x, y, width, height, color) {
  canvas.composite(new Jimp(width, height, color), x, y);
}

function crop(value, max = 36) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text;
}

class VNextSceneRenderer {
  constructor({ assets = new TavernAssetRegistry() } = {}) {
    this.assets = assets;
  }

  async base(sceneKey) {
    const background = await this.assets.image('background.board');
    const canvas = background ? background.cover(WIDTH, HEIGHT) : new Jimp(WIDTH, HEIGHT, COLORS.obsidian);
    rect(canvas, 0, 0, WIDTH, HEIGHT, sceneKey === 'scene.victory.vnext' ? 0x4a321455 : 0x100c1299);
    rect(canvas, 80, 75, WIDTH - 160, HEIGHT - 150, 0x050407bb);
    return canvas;
  }

  async fonts() {
    return Promise.all([
      this.assets.font(16),
      this.assets.font(32),
      this.assets.font(64)
    ]);
  }

  async crest(classId, size = 172) {
    classVisual(classId);
    const image = await this.assets.image(`class.${classId}`);
    return image ? image.contain(size, size) : null;
  }

  async renderInvite({
    challengerName = 'DESAFIANTE',
    challengedName = 'OPONENTE',
    challengerClassId = 'GUARDIAN',
    challengedClassId = 'EXILE',
    modeLabel = 'NORMAL',
    expiresLabel = '5 MIN'
  } = {}) {
    const canvas = await this.base('scene.invite.vnext');
    const [font16, font32, font64] = await this.fonts();
    const left = classVisual(challengerClassId);
    const right = classVisual(challengedClassId);
    const [leftCrest, rightCrest] = await Promise.all([
      this.crest(challengerClassId, 150),
      this.crest(challengedClassId, 150)
    ]);

    canvas.print(font32, 0, 70, {
      text: 'DESAFIO À MESA',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 40);

    if (leftCrest) canvas.composite(leftCrest, 315, 145);
    if (rightCrest) canvas.composite(rightCrest, 735, 145);

    canvas.print(font32, 210, 315, {
      text: crop(challengerName, 20),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 360, 38);
    canvas.print(font16, 210, 355, {
      text: `${left.archetype} · ${left.label}`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 360, 22);

    canvas.print(font64, 556, 205, {
      text: '×',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 88, 70);

    canvas.print(font32, 630, 315, {
      text: crop(challengedName, 20),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 360, 38);
    canvas.print(font16, 630, 355, {
      text: `${right.archetype} · ${right.label}`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 360, 22);

    rect(canvas, 310, 458, 580, 68, 0x07060add);
    canvas.print(font32, 330, 470, {
      text: `${modeLabel} · RESPONDA EM ${expiresLabel}`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 540, 36);
    canvas.print(font16, 0, 558, {
      text: 'ACEITAR abre a preparação privada · RECUSAR encerra o desafio',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 24);
    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }

  async renderMulligan({
    playerName = 'AVENTUREIRO',
    classId = 'GUARDIAN',
    handSize = 4
  } = {}) {
    const canvas = await this.base('scene.mulligan.vnext');
    const [font16, font32] = await this.fonts();
    const visual = classVisual(classId);
    const crest = await this.crest(classId, 170);
    if (crest) canvas.composite(crest, 515, 120);

    canvas.print(font32, 0, 64, {
      text: 'ESCOLHA SUA ABERTURA',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 42);
    canvas.print(font32, 0, 320, {
      text: crop(playerName, 26),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 38);
    canvas.print(font16, 0, 360, {
      text: `${visual.archetype} · ${visual.label}`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 22);
    canvas.print(font16, 0, 505, {
      text: `${handSize} cartas foram enviadas somente para você`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 22);
    canvas.print(font16, 0, 548, {
      text: 'Troque as que não combinam com sua abertura · ou mantenha todas',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 22);
    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }

  async renderTurn({
    playerName = 'AVENTUREIRO',
    classId = 'GUARDIAN',
    turnNumber = 1,
    deadlineLabel = null
  } = {}) {
    const canvas = await this.base('scene.turn.vnext');
    const [font16, font32, font64] = await this.fonts();
    const visual = classVisual(classId);
    const crest = await this.crest(classId, 185);
    if (crest) canvas.composite(crest, 507, 135);

    canvas.print(font16, 0, 94, {
      text: `TURNO ${turnNumber}`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 24);
    canvas.print(font64, 120, 352, {
      text: crop(playerName, 22),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 960, 72);
    canvas.print(font32, 180, 435, {
      text: `${visual.archetype} · SUA VEZ${deadlineLabel ? ` · ${deadlineLabel}` : ''}`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 840, 40);
    canvas.print(font16, 0, 515, {
      text: 'Sua mão privada mostra apenas as ações disponíveis agora',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 22);
    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }

  async renderVictory({
    winnerName = 'VENCEDOR',
    classId = 'GUARDIAN',
    reasonLabel = 'VITÓRIA',
    progressionLabel = null
  } = {}) {
    const canvas = await this.base('scene.victory.vnext');
    const [font16, font32, font64] = await this.fonts();
    const visual = classVisual(classId);
    const crest = await this.crest(classId, 196);
    if (crest) canvas.composite(crest, 502, 120);

    canvas.print(font32, 0, 60, {
      text: reasonLabel,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, WIDTH, 42);
    canvas.print(font64, 100, 360, {
      text: crop(winnerName, 22),
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 1000, 74);
    canvas.print(font32, 170, 447, {
      text: `${visual.archetype} · ${visual.label}`,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 860, 38);
    if (progressionLabel) {
      canvas.print(font16, 0, 520, {
        text: crop(progressionLabel, 70),
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, WIDTH, 24);
    }
    return canvas.getBufferAsync(Jimp.MIME_PNG);
  }
}

export {
  HEIGHT as VNEXT_SCENE_HEIGHT,
  VNextSceneRenderer,
  WIDTH as VNEXT_SCENE_WIDTH
};
