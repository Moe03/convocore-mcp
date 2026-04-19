/**
 * ConvoCore pricing knowledge base.
 *
 * This is a static snapshot of the public pricing page so MCP hosts (Claude,
 * Cursor, etc.) can quote plans, add-ons, voice/chat cost rules of thumb,
 * credit conversions, and per-model token prices without hitting the network.
 *
 * Source: https://convocore.ai/pricing
 * Last reviewed: 2026-04-18
 *
 * IMPORTANT: prices are approximate and may change — instruct the model to
 * always direct end users to the live pricing page for the authoritative
 * current numbers.
 */

export interface PlanInfo {
  name: string;
  price: string;
  tagline: string;
  features: string[];
}

export interface AddOnInfo {
  name: string;
  price: string;
  description: string;
}

export interface CreditAction {
  action: string;
  credits: number;
  usd: number;
  notes: string;
}

export interface ModelPriceRow {
  model: string;
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  tier: 'budget' | 'mid' | 'premium' | 'ultra';
}

export interface PricingSnapshot {
  meta: {
    source: string;
    lastReviewed: string;
    creditConversion: { usdPerCredit: number; creditsPerUsd: number };
    notes: string[];
  };
  plans: PlanInfo[];
  addOns: AddOnInfo[];
  creditActions: CreditAction[];
  rulesOfThumb: {
    chat: { unit: string; min: number; max: number; notes: string[] };
    voice: { unit: string; minUsd: number; maxUsd: number; notes: string[] };
  };
  models: ModelPriceRow[];
  faq: Array<{ q: string; a: string }>;
}

export const PRICING: PricingSnapshot = {
  meta: {
    source: 'https://convocore.ai/pricing',
    lastReviewed: '2026-04-18',
    creditConversion: { usdPerCredit: 0.001, creditsPerUsd: 1000 },
    notes: [
      'Prices are approximate and subject to change — always link users to https://convocore.ai/pricing for current numbers.',
      'Every AI interaction costs 1 base credit ($0.001) PLUS LLM token usage based on the chosen model.',
      'BYOK (bring-your-own-API-key) is supported on Pay-As-You-Go and Enterprise; the provider then bills you directly for token usage.',
    ],
  },

  plans: [
    {
      name: 'Free',
      price: '$0/forever',
      tagline: 'For testing and personal projects.',
      features: [
        '5 AI agents',
        '2 clients',
        'Customize agent theme',
        'Text & voice agents',
        'Knowledge base',
        'Live human handoff',
        'Conversation analytics',
        'API access',
        'Community support',
        'Whitelabel trial',
        '750 credits on signup (free trial)',
      ],
    },
    {
      name: 'Pay As You Go',
      price: '$20/mo',
      tagline: 'For growing businesses.',
      features: [
        '$5 USD free credits included',
        '100 AI agents',
        '2 client seats included (2 client companies)',
        'All channels (WhatsApp, Instagram, Messenger, etc.)',
        'Voice AI agents',
        'Unlimited knowledge base',
        'Live handoff',
        'Remove ConvoCore branding from widgets',
        'Priority support',
        'Bring your own API keys (BYOK)',
      ],
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      tagline: 'For agencies and large teams.',
      features: [
        'Volume discounts',
        'Unlimited agents',
        'Custom integrations',
        'Dedicated account manager',
        'SLA guarantees',
        'On-premise option',
        'SSO / SAML',
        'Custom contracts',
        'Custom features',
        'AI agent development',
      ],
    },
  ],

  addOns: [
    {
      name: 'Whitelabel',
      price: '$200/month',
      description:
        'Remove ConvoCore branding and customize with your own. Includes 5 free client seats, 1 free phone number, and 2 free workspace seats. The 5 client seats stack on top of your base plan seats (e.g. Pay As You Go = 2 + Whitelabel = 5 → 7 total).',
    },
    {
      name: 'Workspace Seat',
      price: '$10/month',
      description: 'Extra workspace seat for team collaboration.',
    },
    {
      name: 'Client Seat',
      price: '$15/month',
      description:
        'One client seat = one client company account, including that client\'s internal team (up to 10 members). Example: 3 client companies with 3 users each = 3 client seats, NOT 9.',
    },
    {
      name: 'Concurrent Call Line',
      price: '$5/month',
      description: 'Extra concurrent call line to handle more simultaneous voice calls.',
    },
    {
      name: 'Twilio Phone Number',
      price: '$3/month',
      description: 'Extra Twilio phone number for voice AI agents.',
    },
  ],

  creditActions: [
    {
      action: 'Base interaction fee',
      credits: 1,
      usd: 0.001,
      notes: 'Per interaction on any channel (chat, voice, etc.). Added to LLM token cost.',
    },
    {
      action: 'LLM token usage',
      credits: -1,
      usd: -1,
      notes: 'Varies by model and conversation length. See `models` table for per-model pricing.',
    },
    {
      action: 'Voice call — platform fee (per minute)',
      credits: 20,
      usd: 0.02,
      notes:
        'ConvoCore platform fee only. Voice provider cost (Gemini, Ultravox, etc.) and Twilio telephony are billed separately.',
    },
    {
      action: 'Web scraping (no proxy)',
      credits: 1,
      usd: 0.001,
      notes: 'Works for ~80% of websites.',
    },
    {
      action: 'Web scraping (with proxy)',
      credits: 60,
      usd: 0.06,
      notes: 'For sites that block scrapers.',
    },
  ],

  rulesOfThumb: {
    chat: {
      unit: 'messages per $1',
      min: 100,
      max: 300,
      notes: [
        'Web chat / WhatsApp / Instagram / Messenger.',
        'Solid LLM (e.g. GPT-4o-mini): ~100–200 messages per $1.',
        'Budget LLM (e.g. GLM-4.7): can push 300+ messages per $1.',
        'Actual count depends on conversation length — shorter chats = more messages.',
      ],
    },
    voice: {
      unit: 'USD per minute',
      minUsd: 0.05,
      maxUsd: 0.10,
      notes: [
        'AI stack cost only — Twilio telephony is billed separately.',
        'Gemini voice: ~$0.05–$0.06 / min.',
        'Ultravox: ~$0.07 / min.',
        'Higher-end providers may cost up to ~$0.10 / min.',
      ],
    },
  },

  models: [
    // ConvoCore Hosted (Lowest Cost)
    { model: 'Qwen3-30B', provider: 'ConvoCore Hosted', inputPerMillion: 0.10, outputPerMillion: 0.30, tier: 'budget' },
    { model: 'Qwen3-235B', provider: 'ConvoCore Hosted', inputPerMillion: 0.20, outputPerMillion: 0.60, tier: 'budget' },
    { model: 'GLM-4.5-Air', provider: 'ConvoCore Hosted', inputPerMillion: 0.20, outputPerMillion: 1.20, tier: 'budget' },
    { model: 'Llama-3.3-70B', provider: 'ConvoCore Hosted', inputPerMillion: 0.25, outputPerMillion: 0.75, tier: 'budget' },
    { model: 'GLM-4.7', provider: 'ConvoCore Hosted', inputPerMillion: 0.40, outputPerMillion: 2.00, tier: 'budget' },
    { model: 'Kimi-K2-Instruct', provider: 'ConvoCore Hosted', inputPerMillion: 0.50, outputPerMillion: 2.40, tier: 'budget' },
    { model: 'GLM-4.5', provider: 'ConvoCore Hosted', inputPerMillion: 0.60, outputPerMillion: 2.20, tier: 'mid' },

    // OpenAI
    { model: 'GPT-5 Mini', provider: 'OpenAI', inputPerMillion: 0.375, outputPerMillion: 3.00, tier: 'budget' },
    { model: 'GPT-5 Nano', provider: 'OpenAI', inputPerMillion: 0.50, outputPerMillion: 1.00, tier: 'budget' },
    { model: 'GPT-4o Mini', provider: 'OpenAI', inputPerMillion: 1.00, outputPerMillion: 1.00, tier: 'budget' },
    { model: 'GPT-4.1 Mini', provider: 'OpenAI', inputPerMillion: 1.00, outputPerMillion: 2.00, tier: 'mid' },
    { model: 'GPT-5', provider: 'OpenAI', inputPerMillion: 1.875, outputPerMillion: 15.00, tier: 'premium' },
    { model: 'GPT-5 Chat', provider: 'OpenAI', inputPerMillion: 1.875, outputPerMillion: 15.00, tier: 'premium' },
    { model: 'GPT-5.2', provider: 'OpenAI', inputPerMillion: 2.625, outputPerMillion: 18.00, tier: 'premium' },
    { model: 'GPT-4o', provider: 'OpenAI', inputPerMillion: 3.00, outputPerMillion: 12.00, tier: 'premium' },
    { model: 'GPT-4.1', provider: 'OpenAI', inputPerMillion: 3.00, outputPerMillion: 10.00, tier: 'premium' },

    // Anthropic
    { model: 'Claude Haiku 4.5', provider: 'Anthropic', inputPerMillion: 1.25, outputPerMillion: 6.25, tier: 'mid' },
    { model: 'Claude Sonnet 4.5', provider: 'Anthropic', inputPerMillion: 4.00, outputPerMillion: 18.00, tier: 'premium' },
    { model: 'Claude Opus 4.5', provider: 'Anthropic', inputPerMillion: 19.00, outputPerMillion: 95.00, tier: 'ultra' },

    // Google
    { model: 'Gemini 2.5 Flash', provider: 'Google', inputPerMillion: 1.00, outputPerMillion: 2.00, tier: 'budget' },
    { model: 'Gemini 3 Flash', provider: 'Google', inputPerMillion: 1.25, outputPerMillion: 6.00, tier: 'mid' },
    { model: 'Gemini 3 Pro', provider: 'Google', inputPerMillion: 2.50, outputPerMillion: 15.00, tier: 'premium' },
    { model: 'Gemini 2.5 Pro', provider: 'Google', inputPerMillion: 3.00, outputPerMillion: 18.00, tier: 'premium' },

    // DeepSeek
    { model: 'DeepSeek V3', provider: 'DeepSeek', inputPerMillion: 1.00, outputPerMillion: 1.50, tier: 'budget' },
  ],

  faq: [
    {
      q: 'What happens if I run out of credits?',
      a: 'Agents pause until credits are refilled. Set up auto-recharge or upgrade to avoid interruptions.',
    },
    {
      q: 'What exactly is a client seat?',
      a: 'One client company account (including the client\'s team, up to 10 members). 3 client companies × 3 users each = 3 client seats, not 9.',
    },
    {
      q: 'Do Whitelabel client seats stack with my plan seats?',
      a: 'Yes. Whitelabel adds 5 extra client seats on top of your base plan (Pay As You Go = 2 base + 5 = 7 total).',
    },
    {
      q: 'Can I use my own API keys?',
      a: 'Yes — Pay As You Go and Enterprise customers can BYOK (OpenAI, Anthropic, etc.) and the provider bills you directly.',
    },
    {
      q: 'Is there a free trial?',
      a: 'The Free plan is the trial — 750 credits on signup, no card required.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Yes, no penalties. Agents continue working until the end of the billing period.',
    },
    {
      q: 'Do unused credits roll over?',
      a: 'Pay As You Go credits reset monthly. Enterprise plans can negotiate rollover.',
    },
    {
      q: 'What payment methods are accepted?',
      a: 'All major credit cards, wire transfers (Enterprise), and crypto for annual plans.',
    },
  ],
};

/**
 * Voice provider catalog. The full list of TTS providers Convocore supports
 * via its Voices API. The `workspaceSecretKey` is the env var name used to
 * store a workspace's BYOK key for that provider; if `requiresWorkspaceApiKey`
 * is true, the platform has no server-side fallback and the workspace MUST
 * provide its own key.
 *
 * The live `list_voice_providers` tool will return the authoritative list;
 * this is a documentation/fallback snapshot for offline reasoning.
 */
export const VOICE_PROVIDERS = [
  { slug: 'elevenlabs', name: 'ElevenLabs', workspaceSecretKey: 'ELEVENLABS_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'deepgram', name: 'Deepgram', workspaceSecretKey: 'DEEPGRAM_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'cartesia', name: 'Cartesia', workspaceSecretKey: 'CARTESIA_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'rime-ai', name: 'Rime AI', workspaceSecretKey: 'RIME_AI_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'openai', name: 'OpenAI TTS', workspaceSecretKey: 'OPENAI_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'google-cloud', name: 'Google Cloud TTS', workspaceSecretKey: 'GOOGLE_CLOUD_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'google-live', name: 'Google Gemini Live', workspaceSecretKey: 'GOOGLE_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'ultravox', name: 'Ultravox', workspaceSecretKey: 'ULTRAVOX_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'minimax', name: 'MiniMax', workspaceSecretKey: 'MINIMAX_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'playht', name: 'PlayHT', workspaceSecretKey: 'PLAYHT_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'azure', name: 'Azure Speech', workspaceSecretKey: 'AZURE_SPEECH_API_KEY', requiresWorkspaceApiKey: false },
] as const;
