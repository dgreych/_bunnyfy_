// @ts-nocheck -- porte verbatim do renderer Jimp da Tavern (dados/src/tavern/rendering em nazuna-gyomei); não redesenhar.
const COLORS = Object.freeze({
  obsidian: 0x100c12ff,
  coal: 0x19131cff,
  wine: 0x2a171fff,
  gold: 0xd5a441ff,
  oldGold: 0x9b702dff,
  ivory: 0xe7dfcfff,
  iron: 0x686e75ff,
  health: 0xa63643ff,
  armor: 0x507f9aff,
  mana: 0x5c52aeff,
  guardian: 0x46708eff,
  exile: 0x9e422bff,
  storm: 0x5b52a8ff
});

const CLASS_VISUALS = Object.freeze({
  GUARDIAN: Object.freeze({
    label: 'GUARDIÃO',
    archetype: 'BASTIÃO',
    accent: COLORS.guardian
  }),
  EXILE: Object.freeze({
    label: 'EXILADO',
    archetype: 'CAÇADA',
    accent: COLORS.exile
  }),
  STORM: Object.freeze({
    label: 'TEMPESTADE',
    archetype: 'ARCANO',
    accent: COLORS.storm
  })
});

const RARITY_VISUALS = Object.freeze({
  COMMON: Object.freeze({ accent: 0xb8c2ccff, label: 'COMUM' }),
  RARE: Object.freeze({ accent: 0x3d9df2ff, label: 'RARA' }),
  EPIC: Object.freeze({ accent: 0xa352e8ff, label: 'ÉPICA' }),
  LEGENDARY: Object.freeze({ accent: 0xf29a28ff, label: 'LENDÁRIA' })
});

const KEYWORD_LABELS = Object.freeze({
  GUARD: 'GUARDA',
  RUSH: 'ÍMPETO',
  DEATHRATTLE: 'ÚLTIMO SUSPIRO',
  ON_PLAY: 'APARIÇÃO',
  BLEED: 'SANGRIA',
  BOND: 'VÍNCULO',
  AMBUSH: 'EMBOSCADA',
  FRENZY: 'FRENESI'
});

function classVisual(classId) {
  return CLASS_VISUALS[classId] || {
    label: String(classId || 'NEUTRO'),
    archetype: 'TAVERNA',
    accent: COLORS.oldGold
  };
}

function rarityVisual(rarity) {
  return RARITY_VISUALS[rarity] || RARITY_VISUALS.COMMON;
}

export {
  CLASS_VISUALS,
  COLORS,
  KEYWORD_LABELS,
  RARITY_VISUALS,
  classVisual,
  rarityVisual
};
