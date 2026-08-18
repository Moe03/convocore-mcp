/**
 * Convocore pricing knowledge base.
 *
 * This is a static snapshot of the public pricing page so MCP hosts (Claude,
 * Cursor, etc.) can quote plans, add-ons, voice/chat cost rules of thumb,
 * credit conversions, and per-model token prices without hitting the network.
 *
 * Source: https://convocore.ai/pricing
 * Last reviewed: 2026-08-14
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
  modelId: string;
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  /** 4 = Free value, 3 = Starter+, 2 = Pro+, 1 = Business+ flagship */
  planTier: 1 | 2 | 3 | 4;
  unlocksOn: 'Free' | 'Starter+' | 'Pro+' | 'Business+';
  recommended?: boolean;
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
    lastReviewed: '2026-08-14',
    creditConversion: { usdPerCredit: 0.001, creditsPerUsd: 1000 },
    notes: [
      'Prices are approximate and subject to change — always link users to https://convocore.ai/pricing for current numbers.',
      'Every AI interaction costs 1 base credit ($0.001) PLUS LLM token usage based on the chosen model.',
      'New agents should use gpt-5.6-luna (best quality/value). Fallback: gemini-3.1-flash-lite. Do not default to gpt-4o or other legacy models.',
      'Higher plans include every lower model tier (Business+ unlocks Tiers 1–4).',
      'Unused monthly credits do not roll over.',
    ],
  },

  plans: [
    {
      name: 'Free',
      price: 'Free',
      tagline: 'Tier 4 models. 500 one-time credits.',
      features: [
        'Tier 4 — value & speed models',
        '500 credits (one-time)',
        'Text agents + knowledge base',
      ],
    },
    {
      name: 'Starter',
      price: '$29/mo',
      tagline: 'Unlocks Tier 3+ (includes Gemini 3.1 Flash-Lite). 5,000 credits / mo.',
      features: ['5,000 monthly credits', 'Tier 3 + Tier 4 models', 'Production support agents'],
    },
    {
      name: 'Pro',
      price: '$59/mo',
      tagline: 'Unlocks Tier 2+ including GPT-5.6 Luna (recommended default). 15,000 credits / mo.',
      features: ['15,000 monthly credits', 'Tier 2–4 models', 'GPT-5.6 Luna + thinking models'],
    },
    {
      name: 'Business',
      price: '$99/mo',
      tagline: 'Unlocks Tier 1 flagship + voice/phone. 25,000 credits / mo.',
      features: ['25,000 monthly credits', 'All model tiers', 'Voice / phone unlocks'],
    },
    {
      name: 'White Label',
      price: '$199/mo',
      tagline: '60,000 credits / mo plus branding.',
      features: ['60,000 monthly credits', 'All model tiers', 'White-label branding'],
    },
    {
      name: 'White Label Elite',
      price: '$349/mo',
      tagline: '120,000 credits / mo for high volume.',
      features: ['120,000 monthly credits', 'All model tiers', 'White-label branding'],
    },
  ],

  addOns: [
    {
      name: 'Whitelabel',
      price: '$200/month',
      description:
        'Remove Convocore branding and customize with your own. Includes 5 free client seats, 1 free phone number, and 2 free workspace seats. The 5 client seats stack on top of your base plan seats (e.g. Pay As You Go = 2 + Whitelabel = 5 → 7 total).',
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
        'Convocore platform fee only. Voice provider cost (Gemini, Ultravox, etc.) and Twilio telephony are billed separately.',
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
        'GPT-5.6 Luna (recommended): ~1.1 cr/msg typical (~2,500 in + 300 out) plus 1 interaction credit.',
        'Gemini 3.1 Flash-Lite (fallback): ~1.6 cr/msg typical plus 1 interaction credit.',
        'Value Tier 4 models: ~0.3–4 cr/msg. Flagship Tier 1: ~6–83 cr/msg.',
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
    // Tier 4 — Free
    { model: 'NVIDIA-Nemotron-3-Nano-30B-A3B', modelId: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', provider: 'convocore', inputPerMillion: 0.09, outputPerMillion: 0.36, planTier: 4, unlocksOn: 'Free' },
    { model: 'GPT 5 Nano', modelId: 'gpt-5-nano-2025-08-07', provider: 'openai', inputPerMillion: 0.075, outputPerMillion: 0.6, planTier: 4, unlocksOn: 'Free' },
    { model: 'Gemma 4 26B MoE', modelId: 'gemma-4-26b-moe', provider: 'google', inputPerMillion: 0.105, outputPerMillion: 0.3, planTier: 4, unlocksOn: 'Free' },
    { model: 'Gemini 2.5 Flash-Lite', modelId: 'gemini-2.5-flash-lite', provider: 'google', inputPerMillion: 0.15, outputPerMillion: 0.6, planTier: 4, unlocksOn: 'Free' },
    { model: 'Llama-3.3-70B-Instruct', modelId: 'meta-llama/Llama-3.3-70B-Instruct', provider: 'convocore', inputPerMillion: 0.195, outputPerMillion: 0.6, planTier: 4, unlocksOn: 'Free' },
    { model: 'Gemma 4 31B Dense', modelId: 'gemma-4-31b-dense', provider: 'google', inputPerMillion: 0.21, outputPerMillion: 0.6, planTier: 4, unlocksOn: 'Free' },
    { model: 'GPT-OSS-120B', modelId: 'openai/gpt-oss-120b', provider: 'convocore', inputPerMillion: 0.225, outputPerMillion: 0.9, planTier: 4, unlocksOn: 'Free' },
    { model: 'GPT-4o Mini', modelId: 'gpt-4o-mini', provider: 'openai', inputPerMillion: 0.225, outputPerMillion: 0.9, planTier: 4, unlocksOn: 'Free' },
    { model: 'Qwen-Turbo Latest', modelId: 'qwen-turbo-latest', provider: 'alibaba', inputPerMillion: 0.6, outputPerMillion: 0.3, planTier: 4, unlocksOn: 'Free' },
    { model: 'MiniMax-M2.5', modelId: 'MiniMaxAI/MiniMax-M2.5', provider: 'convocore', inputPerMillion: 0.45, outputPerMillion: 1.8, planTier: 4, unlocksOn: 'Free' },
    { model: 'MiniMax-M3', modelId: 'MiniMaxAI/MiniMax-M3', provider: 'convocore', inputPerMillion: 0.45, outputPerMillion: 1.8, planTier: 4, unlocksOn: 'Free' },
    { model: 'Qwen3.5-397B-A17B', modelId: 'Qwen/Qwen3.5-397B-A17B', provider: 'convocore', inputPerMillion: 0.9, outputPerMillion: 5.4, planTier: 4, unlocksOn: 'Free' },

    // Tier 3 — Starter+
    { model: 'Gemini 3.1 Flash-Lite', modelId: 'gemini-3.1-flash-lite', provider: 'google', inputPerMillion: 0.375, outputPerMillion: 2.25, planTier: 3, unlocksOn: 'Starter+', recommended: true },
    { model: 'GPT 5 Mini', modelId: 'gpt-5-mini-2025-08-07', provider: 'openai', inputPerMillion: 0.375, outputPerMillion: 3.0, planTier: 3, unlocksOn: 'Starter+' },
    { model: 'Qwen-Max 72B', modelId: 'qwen-max-latest', provider: 'alibaba', inputPerMillion: 0.6, outputPerMillion: 1.8, planTier: 3, unlocksOn: 'Starter+' },
    { model: 'Qwen-Plus Latest', modelId: 'qwen-plus-latest', provider: 'alibaba', inputPerMillion: 0.6, outputPerMillion: 1.8, planTier: 3, unlocksOn: 'Starter+' },
    { model: 'GPT-4.1 Mini', modelId: 'gpt-4.1-mini-2025-04-14', provider: 'openai', inputPerMillion: 0.6, outputPerMillion: 2.4, planTier: 3, unlocksOn: 'Starter+' },
    { model: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash', provider: 'google', inputPerMillion: 0.45, outputPerMillion: 3.75, planTier: 3, unlocksOn: 'Starter+' },
    { model: 'Kimi-K2.6', modelId: 'moonshotai/Kimi-K2.6', provider: 'convocore', inputPerMillion: 1.43, outputPerMillion: 6.0, planTier: 3, unlocksOn: 'Starter+' },
    { model: 'Claude Haiku 4.5', modelId: 'claude-haiku-4-5-20251001', provider: 'anthropic', inputPerMillion: 1.5, outputPerMillion: 7.5, planTier: 3, unlocksOn: 'Starter+' },
    { model: 'DeepSeek-V4-Pro', modelId: 'deepseek-ai/DeepSeek-V4-Pro', provider: 'convocore', inputPerMillion: 2.63, outputPerMillion: 5.25, planTier: 3, unlocksOn: 'Starter+' },

    // Tier 2 — Pro+
    { model: 'GPT-5.6 Luna', modelId: 'gpt-5.6-luna', provider: 'openai', inputPerMillion: 0.26, outputPerMillion: 1.56, planTier: 2, unlocksOn: 'Pro+', recommended: true },
    { model: 'GPT-5', modelId: 'gpt-5-2025-08-07', provider: 'openai', inputPerMillion: 1.88, outputPerMillion: 15.0, planTier: 2, unlocksOn: 'Pro+' },
    { model: 'Gemini 3.5 Flash', modelId: 'gemini-3.5-flash', provider: 'google', inputPerMillion: 2.25, outputPerMillion: 13.5, planTier: 2, unlocksOn: 'Pro+' },
    { model: 'GPT-4.1', modelId: 'gpt-4.1-2025-04-14', provider: 'openai', inputPerMillion: 3.0, outputPerMillion: 12.0, planTier: 2, unlocksOn: 'Pro+' },
    { model: 'GPT-5.2', modelId: 'gpt-5.2-2025-12-11', provider: 'openai', inputPerMillion: 2.63, outputPerMillion: 21.0, planTier: 2, unlocksOn: 'Pro+' },
    { model: 'Gemini 3.1 Pro', modelId: 'gemini-3.1-pro-preview', provider: 'google', inputPerMillion: 3.0, outputPerMillion: 18.0, planTier: 2, unlocksOn: 'Pro+' },
    { model: 'GPT-4o', modelId: 'gpt-4o', provider: 'openai', inputPerMillion: 3.75, outputPerMillion: 15.0, planTier: 2, unlocksOn: 'Pro+' },
    { model: 'Claude Sonnet 4.5', modelId: 'claude-sonnet-4-5-20250929', provider: 'anthropic', inputPerMillion: 4.5, outputPerMillion: 22.5, planTier: 2, unlocksOn: 'Pro+' },

    // Tier 1 — Business+
    { model: 'o3-mini', modelId: 'o3-mini', provider: 'openai', inputPerMillion: 1.65, outputPerMillion: 6.6, planTier: 1, unlocksOn: 'Business+' },
    { model: 'Grok 4.5', modelId: 'grok-4.5', provider: 'xai', inputPerMillion: 3.0, outputPerMillion: 9.0, planTier: 1, unlocksOn: 'Business+' },
    { model: 'GPT-5.6 Terra', modelId: 'gpt-5.6-terra', provider: 'openai', inputPerMillion: 2.6, outputPerMillion: 15.6, planTier: 1, unlocksOn: 'Business+' },
    { model: 'GPT-5.4 Thinking', modelId: 'gpt-5.4-thinking-latest', provider: 'openai', inputPerMillion: 3.0, outputPerMillion: 24.0, planTier: 1, unlocksOn: 'Business+' },
    { model: 'GPT-4.5 Preview', modelId: 'gpt-4.5-preview-2025-02-27', provider: 'openai', inputPerMillion: 4.5, outputPerMillion: 18.0, planTier: 1, unlocksOn: 'Business+' },
    { model: 'Kimi-K3', modelId: 'moonshotai/Kimi-K3', provider: 'convocore', inputPerMillion: 4.5, outputPerMillion: 22.5, planTier: 1, unlocksOn: 'Business+' },
    { model: 'Claude Opus 4.7', modelId: 'claude-opus-4-7', provider: 'anthropic', inputPerMillion: 7.5, outputPerMillion: 37.5, planTier: 1, unlocksOn: 'Business+' },
    { model: 'Claude Opus 4.6', modelId: 'claude-opus-4-6', provider: 'anthropic', inputPerMillion: 7.5, outputPerMillion: 37.5, planTier: 1, unlocksOn: 'Business+' },
    { model: 'Claude Opus 4.5', modelId: 'claude-opus-4-5-20251101', provider: 'anthropic', inputPerMillion: 7.5, outputPerMillion: 37.5, planTier: 1, unlocksOn: 'Business+' },
    { model: 'GPT-5.6 Sol', modelId: 'gpt-5.6', provider: 'openai', inputPerMillion: 7.5, outputPerMillion: 45.0, planTier: 1, unlocksOn: 'Business+' },
    { model: 'o1', modelId: 'o1', provider: 'openai', inputPerMillion: 22.5, outputPerMillion: 90.0, planTier: 1, unlocksOn: 'Business+' },
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
      a: 'Unused monthly credits do not roll over.',
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
  { slug: 'grok-live', name: 'Grok Live', workspaceSecretKey: 'XAI_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'minimax', name: 'MiniMax', workspaceSecretKey: 'MINIMAX_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'playht', name: 'PlayHT', workspaceSecretKey: 'PLAYHT_API_KEY', requiresWorkspaceApiKey: false },
  { slug: 'azure', name: 'Azure Speech', workspaceSecretKey: 'AZURE_SPEECH_API_KEY', requiresWorkspaceApiKey: false },
] as const;
