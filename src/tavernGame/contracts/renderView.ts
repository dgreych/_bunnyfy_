import { z } from 'zod';

const FORBIDDEN_JID_FRAGMENT = /@(s\.whatsapp\.net|g\.us|lid|broadcast|newsletter)/i;

function withoutWhatsAppJid(max: number) {
  return z.string().trim().min(1).max(max).refine(
    value => !FORBIDDEN_JID_FRAGMENT.test(value),
    { message: 'Identificadores do WhatsApp não pertencem ao contrato de renderização.' },
  );
}

const labelSchema = withoutWhatsAppJid(120);
const personNameSchema = withoutWhatsAppJid(80).refine(
  value => (value.match(/\d/g) ?? []).length < 7,
  { message: 'Telefone não pertence ao nome público da cena.' },
);
const compactIdSchema = z.string().trim().min(1).max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .refine(value => !FORBIDDEN_JID_FRAGMENT.test(value), {
    message: 'Identificadores do WhatsApp não pertencem ao contrato de renderização.',
  });
const nonNegativeIntegerSchema = z.number().int().min(0).max(99_999);
const smallCountSchema = z.number().int().min(0).max(999);
const matchStatusSchema = z.enum(['ACTIVE', 'FINISHED']);
const matchPhaseSchema = z.enum(['MULLIGAN', 'MAIN']);
const raritySchema = z.enum(['COMMON', 'RARE', 'EPIC', 'LEGENDARY']);
const keywordSchema = compactIdSchema;
const deadlineSchema = z.string().datetime({ offset: true }).nullable();

const heroSchema = z.object({
  hp: nonNegativeIntegerSchema,
  armor: nonNegativeIntegerSchema,
}).strict();

const manaSchema = z.object({
  current: nonNegativeIntegerSchema,
  max: nonNegativeIntegerSchema,
}).strict().refine(value => value.current <= value.max, {
  message: 'Mana atual não pode exceder o máximo.',
});

export const tavernBoardCardRenderViewSchema = z.object({
  cardId: compactIdSchema,
  name: labelSchema,
  rarity: raritySchema,
  classId: compactIdSchema.optional(),
  attack: nonNegativeIntegerSchema,
  health: nonNegativeIntegerSchema,
  keywords: z.array(keywordSchema).max(12),
  canAttack: z.boolean(),
  attacksThisTurn: smallCountSchema,
}).strict();

const boardPlayerSchema = z.object({
  slot: z.enum(['bottom', 'top']),
  displayName: personNameSchema,
  classId: compactIdSchema,
  hero: heroSchema,
  mana: manaSchema,
  handCount: smallCountSchema,
  deckCount: smallCountSchema,
  board: z.array(tavernBoardCardRenderViewSchema).max(7),
}).strict();

export const tavernBoardRenderViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('board'),
  status: matchStatusSchema,
  phase: matchPhaseSchema,
  turn: z.object({
    number: z.number().int().min(1).max(99_999),
    activeSlot: z.enum(['bottom', 'top']),
    deadlineAt: deadlineSchema,
  }).strict(),
  terrain: z.object({ name: labelSchema }).strict().nullable(),
  players: z.tuple([boardPlayerSchema, boardPlayerSchema]).superRefine((players, context) => {
    if (players[0].slot !== 'bottom' || players[1].slot !== 'top') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Jogadores devem estar ordenados nos slots bottom e top.',
      });
    }
  }),
}).strict();

export const tavernHandCardRenderViewSchema = z.object({
  cardId: compactIdSchema,
  name: labelSchema,
  type: z.enum(['MINION', 'SPELL', 'ARTIFACT', 'TERRAIN']),
  rarity: raritySchema,
  cost: nonNegativeIntegerSchema,
  attack: nonNegativeIntegerSchema.optional(),
  health: nonNegativeIntegerSchema.optional(),
  keywords: z.array(keywordSchema).max(12),
  classId: compactIdSchema.optional(),
  text: withoutWhatsAppJid(500).optional(),
}).strict();

export const tavernHandRenderViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('hand'),
  status: matchStatusSchema,
  phase: matchPhaseSchema,
  isActive: z.boolean(),
  viewer: z.object({
    classId: compactIdSchema,
    mana: manaSchema,
    nextSpellDiscount: nonNegativeIntegerSchema,
    boardCount: z.number().int().min(0).max(7),
  }).strict(),
  cards: z.array(tavernHandCardRenderViewSchema).max(10),
}).strict();

const inviteSceneRenderViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('scene'),
  sceneKind: z.literal('invite'),
  payload: z.object({
    challengerName: personNameSchema,
    challengedName: personNameSchema,
    challengerClassId: compactIdSchema,
    challengedClassId: compactIdSchema,
    modeLabel: withoutWhatsAppJid(40),
    expiresLabel: withoutWhatsAppJid(40),
  }).strict(),
}).strict();

const mulliganSceneRenderViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('scene'),
  sceneKind: z.literal('mulligan'),
  payload: z.object({
    playerName: personNameSchema,
    classId: compactIdSchema,
    handSize: z.number().int().min(0).max(20),
  }).strict(),
}).strict();

const turnSceneRenderViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('scene'),
  sceneKind: z.literal('turn'),
  payload: z.object({
    playerName: personNameSchema,
    classId: compactIdSchema,
    turnNumber: z.number().int().min(1).max(99_999),
    deadlineLabel: withoutWhatsAppJid(40).nullable(),
  }).strict(),
}).strict();

const victorySceneRenderViewSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('scene'),
  sceneKind: z.literal('victory'),
  payload: z.object({
    winnerName: personNameSchema,
    classId: compactIdSchema,
    reasonLabel: withoutWhatsAppJid(80),
    progressionLabel: withoutWhatsAppJid(160).nullable(),
  }).strict(),
}).strict();

export const tavernSceneRenderViewSchema = z.discriminatedUnion('sceneKind', [
  inviteSceneRenderViewSchema,
  mulliganSceneRenderViewSchema,
  turnSceneRenderViewSchema,
  victorySceneRenderViewSchema,
]);

export const tavernBoardRenderBodySchema = z.object({
  view: tavernBoardRenderViewSchema,
}).strict();

export const tavernHandRenderBodySchema = z.object({
  view: tavernHandRenderViewSchema,
}).strict();

export const tavernSceneRenderBodySchema = z.object({
  view: tavernSceneRenderViewSchema,
}).strict();

export type TavernBoardRenderView = z.infer<typeof tavernBoardRenderViewSchema>;
export type TavernHandRenderView = z.infer<typeof tavernHandRenderViewSchema>;
export type TavernSceneRenderView = z.infer<typeof tavernSceneRenderViewSchema>;
