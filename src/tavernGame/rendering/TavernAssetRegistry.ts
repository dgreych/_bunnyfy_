// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Jimp from 'jimp';

const RENDERING_DIR = path.dirname(fileURLToPath(import.meta.url));
// dados/src/tavern/assets (nazuna-gyomei) foi copiado verbatim para
// assets/tavern na raiz do BunnyFy — mesmo conteúdo, novo lugar.
const DEFAULT_ASSET_DIR = path.resolve(RENDERING_DIR, '..', '..', '..', 'assets', 'tavern');

const ASSET_FILES = Object.freeze({
  'background.board': 'generated/backgrounds/tavern_board_v2.png',
  'background.hand': 'generated/backgrounds/tavern_hand_v2.png',
  'branding.logo': 'branding/logo_primary_transparent.png',
  'card.back': 'generated/cards/tavern_card_back_v2.png',
  'frame.COMMON': 'cards/frames/frame_common_744x1039.png',
  'frame.RARE': 'cards/frames/frame_rare_744x1039.png',
  'frame.EPIC': 'cards/frames/frame_epic_744x1039.png',
  'frame.LEGENDARY': 'cards/frames/frame_legendary_744x1039.png',
  'panel.gold': 'ui/panels/panel_gold_1200x700.png',
  'panel.purple': 'ui/panels/panel_purple_1200x700.png',
  'panel.blue': 'ui/panels/panel_blue_1200x700.png',
  'panel.danger': 'ui/panels/panel_danger_1200x700.png',
  'class.GUARDIAN': 'classes/class_guardiao.png',
  'class.EXILE': 'classes/class_exilado.png',
  'class.ORACLE': 'classes/class_oraculo.png',
  'class.SHAMAN': 'classes/class_xama.png',
  'class.PROFANE': 'classes/class_profano.png',
  'class.STORM': 'classes/class_tempestade.png',
  'resource.health': 'resources/resource_vida.png',
  'resource.armor': 'resources/resource_armadura.png',
  'resource.mana': 'resources/resource_mana.png',
  'keyword.GUARD': 'keywords/keyword_guarda.png',
  'keyword.RUSH': 'keywords/keyword_impeto.png',
  'keyword.DEATHRATTLE': 'keywords/keyword_ultimo_suspiro.png',
  'keyword.ON_PLAY': 'keywords/keyword_aparicao.png',
  'keyword.BLEED': 'keywords/keyword_sangria.png',
  'keyword.BOND': 'keywords/keyword_vinculo.png',
  'keyword.AMBUSH': 'keywords/keyword_emboscada.png',
  'keyword.FRENZY': 'keywords/keyword_frenesi.png',
  'card.GY-001': 'cards/sample_cards/GY-001_sentinela_de_pedra.png',
  'card.GY-014': 'cards/sample_cards/GY-014_bruxa_do_veu.png',
  'card.GY-027': 'cards/sample_cards/GY-027_lobo_da_bruma.png',
  'card.GY-042': 'cards/sample_cards/GY-042_guardiao_do_abismo.png',
  'card.GY-061': 'cards/sample_cards/GY-061_oráculo_lunar.png',
  'card.GY-088': 'cards/sample_cards/GY-088_carrasco_exilado.png',
  'card.GY-103': 'cards/sample_cards/GY-103_xama_das_raizes.png',
  'card.GY-148': 'cards/sample_cards/GY-148_dragao_carmesim.png',
  'card.GY-002': 'cards/sample_cards/GY-002_vigilante_da_ponte.jpg',
  'card.GY-003': 'cards/sample_cards/GY-003_corvo_das_ruinas.jpg',
  'card.GY-004': 'cards/sample_cards/GY-004_escudeira_do_limiar.jpg',
  'card.GY-005': 'cards/sample_cards/GY-005_cacador_de_brasas.jpg',
  'card.GY-006': 'cards/sample_cards/GY-006_muralha_runica.jpg',
  'card.GY-007': 'cards/sample_cards/GY-007_adepto_do_trovao.jpg',
  'card.GY-008': 'cards/sample_cards/GY-008_gigante_da_estalagem.jpg',
  'card.GY-009': 'cards/sample_cards/GY-009_sopro_restaurador.jpg',
  'card.GY-EX-201': 'cards/sample_cards/GY-EX-201_batedor_da_cinza.jpg',
  'card.GY-EX-202': 'cards/sample_cards/GY-EX-202_hiena_das_vielas.jpg',
  'card.GY-EX-203': 'cards/sample_cards/GY-EX-203_golpe_de_oportunidade.jpg',
  'card.GY-EX-204': 'cards/sample_cards/GY-EX-204_lamina_sem_casa.jpg',
  'card.GY-EX-205': 'cards/sample_cards/GY-EX-205_flecha_na_penumbra.jpg',
  'card.GY-EX-206': 'cards/sample_cards/GY-EX-206_carrasco_do_caminho.jpg',
  'card.GY-GD-201': 'cards/sample_cards/GY-GD-201_porteiro_do_lampiao.jpg',
  'card.GY-GD-202': 'cards/sample_cards/GY-GD-202_cervejeira_do_bastiao.jpg',
  'card.GY-GD-203': 'cards/sample_cards/GY-GD-203_juramento_da_pedra.jpg',
  'card.GY-GD-204': 'cards/sample_cards/GY-GD-204_vigia_da_ultima_porta.jpg',
  'card.GY-GD-205': 'cards/sample_cards/GY-GD-205_reerguer_as_defesas.jpg',
  'card.GY-GD-206': 'cards/sample_cards/GY-GD-206_capitao_da_muralha.jpg',
  'card.GY-ST-201': 'cards/sample_cards/GY-ST-201_faisca_engarrafada.jpg',
  'card.GY-ST-202': 'cards/sample_cards/GY-ST-202_aprendiz_do_salao_azul.jpg',
  'card.GY-ST-203': 'cards/sample_cards/GY-ST-203_arco_voltaico.jpg',
  'card.GY-ST-204': 'cards/sample_cards/GY-ST-204_escriba_da_tempestade.jpg',
  'card.GY-ST-205': 'cards/sample_cards/GY-ST-205_descarga_errante.jpg',
  'card.GY-ST-206': 'cards/sample_cards/GY-ST-206_mago_do_ultimo_brinde.jpg',
  'card.GY-TOKEN-SPARK-001': 'cards/sample_cards/GY-TOKEN-SPARK-001_centelha_de_iniciativa.jpg',
  'card.GY-TOKEN-SPIRIT-001': 'cards/sample_cards/GY-TOKEN-SPIRIT-001_espirito_da_raiz.jpg'
});

class TavernAssetRegistry {
  constructor({ assetDirectory = DEFAULT_ASSET_DIR, maxEntries = 48 } = {}) {
    this.assetDirectory = assetDirectory;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.fontCache = new Map();
  }

  resolve(key) {
    const relativePath = ASSET_FILES[key];
    return relativePath ? path.join(this.assetDirectory, relativePath) : null;
  }

  async image(key) {
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, cached);
      const image = await cached;
      return image?.clone() || null;
    }

    const assetPath = this.resolve(key);
    if (!assetPath) return null;
    const loading = fs.access(assetPath)
      .then(() => Jimp.read(assetPath))
      .catch(() => null);
    this.cache.set(key, loading);
    while (this.cache.size > this.maxEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
    const image = await loading;
    return image?.clone() || null;
  }

  font(size = 16, color = 'white') {
    const normalizedSize = [16, 32, 64].includes(size) ? size : 16;
    const normalizedColor = color === 'black' ? 'black' : 'white';
    const key = `${normalizedSize}:${normalizedColor}`;
    if (!this.fontCache.has(key)) {
      const constant = `FONT_SANS_${normalizedSize}_${normalizedColor.toUpperCase()}`;
      this.fontCache.set(key, Jimp.loadFont(Jimp[constant]));
    }
    return this.fontCache.get(key);
  }

  clear() {
    this.cache.clear();
    this.fontCache.clear();
  }
}

export { ASSET_FILES, DEFAULT_ASSET_DIR, TavernAssetRegistry };
