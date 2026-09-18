import { z } from 'zod';

/**
 * Convocore AI Funnel + Lead Scoring (agent.funnelConfig).
 * This is the built-in sales funnel — do NOT invent HTTP webhook tools for “email the sales team”.
 */

export const FunnelStepCategorySchema = z.enum([
  'contact_info',
  'intent',
  'budget',
  'timeline',
  'qualification',
  'custom',
]);

export const FunnelNotificationTypeSchema = z.enum([
  'score_threshold',
  'steps_completed',
  'data_collected',
]);

export const FunnelCooldownStrategySchema = z.enum([
  'immediate',
  'once_per_threshold',
  'once_per_lead',
  'once_per_session',
]);

export const FunnelStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  condition: z.string().min(1).describe('Natural-language condition the LLM evaluates.'),
  points: z.number().min(0).max(100),
  enabled: z.boolean().optional().default(true),
  category: FunnelStepCategorySchema.optional(),
});

export const FunnelNotificationRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  type: FunnelNotificationTypeSchema,
  scoreThreshold: z.number().optional(),
  requiredSteps: z.array(z.string()).optional(),
  requiredFields: z.array(z.string()).optional(),
  cooldownStrategy: FunnelCooldownStrategySchema,
  recipients: z.array(z.string().email()).min(1).describe('Emails to notify on this rule.'),
  emailTemplate: z.string().optional(),
  requireContactInfo: z.boolean().optional().default(true),
});

export const FunnelConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    steps: z.array(FunnelStepSchema).optional(),
    notificationRules: z.array(FunnelNotificationRuleSchema).optional(),
    maxScore: z.number().optional(),
    evaluateOnUserMessage: z.boolean().optional(),
    evaluateOnAIMessage: z.boolean().optional(),
  })
  .describe(
    'AI Funnel & Lead Scoring. Enable this instead of a custom HTTP “notify sales” tool. Runtime scores the conversation and emails recipients when rules fire.'
  );

export const LeadCollectionRulesSchema = z
  .object({
    enabled: z.boolean().optional(),
    rules: z
      .array(
        z.object({
          variables: z.array(z.string()).min(1),
          description: z.string().optional(),
        })
      )
      .optional(),
  })
  .describe(
    'When to persist a CRM lead. If omitted, default is collect when email, phone, or phone_number is present.'
  );

export type FunnelConfig = z.infer<typeof FunnelConfigSchema>;

/** Sensible default funnel for commercial / lead-gen website agents. */
export function buildDefaultLeadFunnelConfig(recipients: string[]): FunnelConfig {
  const emails = recipients.map((e) => e.trim()).filter(Boolean);
  const steps = [
    {
      id: 'contact_email_or_phone',
      name: 'Contact details',
      description: 'Visitor shared an email and/or phone number.',
      condition:
        'The user provided a usable email address and/or phone number we can use to follow up.',
      points: 25,
      enabled: true,
      category: 'contact_info' as const,
    },
    {
      id: 'buying_intent',
      name: 'Buying / booking intent',
      description: 'Visitor wants to buy, book, demo, or get a quote.',
      condition:
        'The user expressed clear commercial intent: wants to buy, book, schedule a demo, get pricing to purchase, or asked to be contacted by sales.',
      points: 30,
      enabled: true,
      category: 'intent' as const,
    },
    {
      id: 'timeline',
      name: 'Timeline',
      description: 'Visitor shared when they want to proceed.',
      condition: 'The user stated a purchase/booking timeline (now, this month, this quarter, etc.).',
      points: 15,
      enabled: true,
      category: 'timeline' as const,
    },
    {
      id: 'qualification',
      name: 'Qualification details',
      description: 'Visitor shared qualifying context (business, budget, device/offering interest, etc.).',
      condition:
        'The user shared qualifying details such as business vs consumer, budget/funding, product/offering of interest, or other sales-qualification facts.',
      points: 20,
      enabled: true,
      category: 'qualification' as const,
    },
  ];

  const notificationRules =
    emails.length > 0
      ? [
          {
            id: 'hot_lead_score',
            name: 'Notify sales — hot lead',
            enabled: true,
            type: 'score_threshold' as const,
            scoreThreshold: 40,
            cooldownStrategy: 'once_per_lead' as const,
            recipients: emails,
            requireContactInfo: true,
            emailTemplate:
              'Hot lead from {{agentTitle}}: score {{score}}. Contact: {{email}} {{phone}}. Summary: {{summary}}',
          },
        ]
      : [];

  return {
    enabled: true,
    steps,
    notificationRules,
    maxScore: 100,
    evaluateOnUserMessage: true,
    evaluateOnAIMessage: true,
  };
}

export const DEFAULT_LEAD_COLLECTION_RULES = {
  enabled: true,
  rules: [
    { variables: ['email'], description: 'Email present' },
    { variables: ['phone'], description: 'Phone present' },
    { variables: ['phone_number'], description: 'phone_number present' },
  ],
};

/** Fields the Convocore PATCH/create API currently rejects as unknown top-level keys. */
export const DEPRECATED_AGENT_TOP_LEVEL_FIELDS = [
  'vg_instructions',
  'vg_systemPrompt',
] as const;

export function stripDeprecatedAgentFields<T extends Record<string, unknown>>(
  agent: T
): T {
  const out = { ...agent };
  for (const key of DEPRECATED_AGENT_TOP_LEVEL_FIELDS) {
    delete (out as Record<string, unknown>)[key];
  }
  return out;
}
