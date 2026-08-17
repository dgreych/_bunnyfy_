import { z } from 'zod';

export const NEXO_RENDER_SCHEMA_VERSION = 1 as const;

const FORBIDDEN_WHATSAPP_FRAGMENT = /@(s\.whatsapp\.net|g\.us|lid|broadcast|newsletter)/i;
const FORBIDDEN_IDENTITY_SENTINEL = /\b(?:jid|phone|telefone|seed|pn|lid|chat[\s_-]*id|user[\s_-]*id|history|hist[oó]rico|hidden(?:[\s_-]*content)?|conte[uú]do[\s_-]*oculto)\b/i;
const PHONE_LIKE_FRAGMENT = /(?:^|\D)\+?\d(?:[\s().-]*\d){8,}(?:$|\D)/;
const UUID_LIKE_FRAGMENT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const LONG_HEX_FRAGMENT = /\b[0-9a-f]{24,}\b/i;

export const NEXO_RENDER_LIMITS = Object.freeze({
  labelLength: 96,
  titleLength: 120,
  locationDescriptionLength: 240,
  metrics: 12,
  highlights: 8,
  techniques: 8,
  traits: 8,
  encounterActions: 6,
  encounterStatuses: 8,
  numericMagnitude: 999_999,
});

function boundedPresentationLabel(max: number) {
  return z.string().trim().min(1).max(max).superRefine((value, context) => {
    if (FORBIDDEN_WHATSAPP_FRAGMENT.test(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Identificadores do WhatsApp não pertencem ao contrato de renderização NEXO.',
      });
    }

    if (FORBIDDEN_IDENTITY_SENTINEL.test(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Metadados de identidade ou estado interno não pertencem ao contrato de renderização NEXO.',
      });
    }

    if (PHONE_LIKE_FRAGMENT.test(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Telefone não pertence aos rótulos de apresentação NEXO.',
      });
    }

    if (UUID_LIKE_FRAGMENT.test(value) || LONG_HEX_FRAGMENT.test(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Identificador bruto não pertence aos rótulos de apresentação NEXO.',
      });
    }
  });
}

const labelSchema = boundedPresentationLabel(NEXO_RENDER_LIMITS.labelLength);
const titleLabelSchema = boundedPresentationLabel(NEXO_RENDER_LIMITS.titleLength);
const locationDescriptionSchema = boundedPresentationLabel(NEXO_RENDER_LIMITS.locationDescriptionLength);
const boundedIntegerSchema = z.number().int()
  .min(-NEXO_RENDER_LIMITS.numericMagnitude)
  .max(NEXO_RENDER_LIMITS.numericMagnitude);
const nonNegativeIntegerSchema = z.number().int()
  .min(0)
  .max(NEXO_RENDER_LIMITS.numericMagnitude);

export const nexoRenderMetricSchema = z.object({
  label: labelSchema,
  value: boundedIntegerSchema,
  max: nonNegativeIntegerSchema.optional(),
}).strict().superRefine((metric, context) => {
  if (metric.max !== undefined && metric.value > metric.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'Valor da métrica não pode exceder o máximo informado.',
    });
  }
});

const metricsSchema = z.array(nexoRenderMetricSchema).max(NEXO_RENDER_LIMITS.metrics);
const highlightsSchema = z.array(labelSchema).max(NEXO_RENDER_LIMITS.highlights);

export const nexoCircleRenderViewSchema = z.object({
  schemaVersion: z.literal(NEXO_RENDER_SCHEMA_VERSION),
  kind: z.literal('circle'),
  titleLabel: titleLabelSchema,
  modeLabel: labelSchema,
  statusLabel: labelSchema,
  metrics: metricsSchema,
  highlights: highlightsSchema,
}).strict();

export const nexoCharacterRenderViewSchema = z.object({
  schemaVersion: z.literal(NEXO_RENDER_SCHEMA_VERSION),
  kind: z.literal('character'),
  titleLabel: titleLabelSchema,
  originLabel: labelSchema,
  toneLabel: labelSchema,
  impulseLabel: labelSchema,
  scarLabel: labelSchema,
  metrics: metricsSchema,
  techniqueLabels: z.array(labelSchema).max(NEXO_RENDER_LIMITS.techniques),
  traitLabels: z.array(labelSchema).max(NEXO_RENDER_LIMITS.traits),
}).strict();

const encounterSideSchema = z.object({
  label: labelSchema,
  metrics: metricsSchema,
}).strict();

const encounterEnemySchema = encounterSideSchema.extend({
  intentLabel: labelSchema,
}).strict();

export const nexoEncounterRenderViewSchema = z.object({
  schemaVersion: z.literal(NEXO_RENDER_SCHEMA_VERSION),
  kind: z.literal('encounter'),
  titleLabel: titleLabelSchema,
  round: z.number().int().min(1).max(9_999),
  postureLabel: labelSchema,
  outcomeLabel: labelSchema.optional(),
  actor: encounterSideSchema,
  enemy: encounterEnemySchema,
  actionLabels: z.array(labelSchema).max(NEXO_RENDER_LIMITS.encounterActions),
  statusLabels: z.array(labelSchema).max(NEXO_RENDER_LIMITS.encounterStatuses),
}).strict();

export const nexoLocationRenderViewSchema = z.object({
  schemaVersion: z.literal(NEXO_RENDER_SCHEMA_VERSION),
  kind: z.literal('location'),
  nameLabel: titleLabelSchema,
  moodLabel: labelSchema,
  descriptionLabel: locationDescriptionSchema,
  highlights: highlightsSchema,
}).strict();

export const nexoRenderViewSchema = z.discriminatedUnion('kind', [
  nexoCircleRenderViewSchema,
  nexoCharacterRenderViewSchema,
  nexoEncounterRenderViewSchema,
  nexoLocationRenderViewSchema,
]);

export type NexoRenderMetric = z.infer<typeof nexoRenderMetricSchema>;
export type NexoCircleRenderView = z.infer<typeof nexoCircleRenderViewSchema>;
export type NexoCharacterRenderView = z.infer<typeof nexoCharacterRenderViewSchema>;
export type NexoEncounterRenderView = z.infer<typeof nexoEncounterRenderViewSchema>;
export type NexoLocationRenderView = z.infer<typeof nexoLocationRenderViewSchema>;
export type NexoRenderView = z.infer<typeof nexoRenderViewSchema>;
