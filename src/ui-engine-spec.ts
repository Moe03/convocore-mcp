/**
 * Convocore UI Engine spec — embedded reference for MCP clients.
 *
 * The UI Engine is what an agent emits when it has `vg_enableUIEngine: true`
 * and the client did NOT pass `disableUiEngine: true` on the /interact
 * request. Instead of streaming plain Markdown, the server streams full
 * `TurnProps` JSON snapshots whose `messages[].item` entries follow the
 * `UiEngineMessage` shape (text / choice / visual / cardV2 / carousel /
 * iFrame / form / input).
 *
 * This module exports both:
 *  1. A short Markdown primer (`UI_ENGINE_PRIMER`) baked into tool
 *     descriptions so the LLM gets it without an extra round-trip.
 *  2. A full structured spec (`UI_ENGINE_SPEC`) returned by the
 *     `get_ui_engine_spec` MCP tool.
 *
 * Mirror of `src/app/Types/uiEngineMessageSchemas.ts` on the backend —
 * keep in sync.
 */

export const UI_ENGINE_MESSAGE_TYPES = [
  'text',
  'choice',
  'visual',
  'cardV2',
  'carousel',
  'iFrame',
  'form',
  'input',
] as const;

export type UiEngineMessageType = (typeof UI_ENGINE_MESSAGE_TYPES)[number];

/**
 * Compact primer baked into the `interact_with_agent` tool description so
 * the LLM understands UI Engine output WITHOUT having to call
 * `get_ui_engine_spec` first. Must stay short and high-signal.
 */
export const UI_ENGINE_PRIMER = [
  'UI ENGINE OUTPUT (when chunk.ui_engine === true):',
  '  - chunk.chunk is a JSON-stringified TurnProps SNAPSHOT of the bot turn so far.',
  '  - Snapshots are OVERWRITING, not incremental — replace the in-progress turn with the latest parse.',
  '  - Parsed shape: { from: "bot", ts, modelId?, messages: UiEngineMessage[] }.',
  '  - Each message: { from: "bot", type, item: { type, payload } } where type is one of:',
  '      text     -> payload.message (Markdown).',
  '      choice   -> payload.buttons[]: { name, request: { type: "open_url"|"text", payload: { url|message } } }.',
  '      visual   -> payload.image (URL ending in .png/.jpg/.jpeg/.webp/.gif/...).',
  '      cardV2   -> payload: { title, imageUrl?, description?: { text }, buttons?: UiEngineButton[] }.',
  '      carousel -> payload.cards[]: UiEngineCardPayload[].',
  '      iFrame   -> payload: { layout: "vertical"|"horizontal", url } (vertical for video embeds, horizontal for general web).',
  '      form     -> payload: { title?, description?, fields: UiEngineInputField[], submitButton?, onSubmit: { type: "submit_form", message? } }. WEB CHANNELS ONLY (web-chat / text).',
  '      input    -> payload: { field: UiEngineInputField, submitOnEnter?, onSubmit: { type: "submit_input", message? } }. WEB CHANNELS ONLY.',
  '  - UiEngineInputField types: text|email|password|number|tel|url|textarea|select|checkbox|radio|date|time|datetime-local|file. select/radio MUST have non-empty options[].',
  '  - Buttons NEVER invent URLs — they must come from KB / tool output.',
  'WHEN ui_engine === false (or omitted): chunk.chunk is plain Markdown text — append to the in-progress assistant message.',
  'TO FORCE PLAIN TEXT on a UI-Engine-enabled agent: pass disableUiEngine: true on the request.',
].join('\n');

/**
 * Full structured spec returned by the `get_ui_engine_spec` MCP tool.
 * Designed to be small enough to inline into a single MCP response while
 * still giving the LLM everything it needs to (a) validate UI Engine output
 * during interactive testing and (b) build the agent prompt that PRODUCES
 * UI Engine output correctly.
 */
export const UI_ENGINE_SPEC = {
  meta: {
    name: 'Convocore UI Engine',
    version: '1.0.0',
    description:
      'Schema for structured UI messages produced by Convocore agents that have vg_enableUIEngine: true. Mirrors src/app/Types/uiEngineMessageSchemas.ts on the backend.',
    streaming: {
      transport: 'WebSocket /interact',
      chunkType: "ChunkMessage with type: 'chunk' and ui_engine: true",
      payloadShape:
        "chunk.chunk is a JSON-stringified TurnProps: { from: 'bot', ts, modelId?, messages: UiEngineMessage[] }",
      semantics:
        'Each chunk carries the FULL snapshot of the bot turn so far. Replace, do not append. Use the LAST chunk for the final state.',
      forcePlainText: 'Pass disableUiEngine: true on the InteractObject to bypass UI Engine for one turn.',
      requiresAgentFlag: 'vg_enableUIEngine must be true on the agent doc.',
    },
    channelGating: {
      formAndInputOnlyOn: ['web-chat', 'text'],
      reason:
        'form and input message types require an HTML rendering surface and are intentionally suppressed on voice / telephony / messaging channels.',
    },
  },

  envelopes: {
    TurnProps: {
      description: 'Top-level turn shape after JSON.parse(chunk.chunk).',
      properties: {
        from: { type: 'string', enum: ['bot', 'human'] },
        ts: { type: 'number', description: 'Unix timestamp (seconds).' },
        modelId: { type: 'string', optional: true, description: 'Model id that produced this turn.' },
        messages: {
          type: 'array',
          items: '$ChatMessage',
          description: 'Ordered list of structured messages emitted in this turn.',
        },
      },
    },
    ChatMessage: {
      description: 'One entry inside TurnProps.messages.',
      properties: {
        from: { type: 'string', enum: ['bot', 'human'] },
        type: {
          type: 'string',
          description:
            "Mirror of item.type for UI Engine. Common UI values: text, choice, visual, cardV2, carousel, iFrame, form, input. Other values seen on the wire: 'context:form_submission', 'debug:tell', 'debug:error', 'debug:success' — those are NOT UI Engine messages, ignore them when validating.",
        },
        ts: { type: 'number' },
        mid: { type: 'string', optional: true, description: 'Stable message id.' },
        item: '$UiEngineMessage',
      },
    },
  },

  messageTypes: {
    text: {
      description: 'Plain Markdown body. Default fallback type — always safe to use.',
      payload: {
        message: { type: 'string', required: true, description: 'Markdown content.' },
      },
      example: { type: 'text', payload: { message: 'Hello! How can I help?' } },
    },
    choice: {
      description: 'Inline button group. Use for short, finite option sets (1–6 buttons).',
      payload: {
        buttons: { type: 'array', required: true, items: '$UiEngineButton', minItems: 1 },
      },
      example: {
        type: 'choice',
        payload: {
          buttons: [
            { name: 'Pricing', request: { type: 'text', payload: { message: 'Tell me about pricing' } } },
            { name: 'Docs', request: { type: 'open_url', payload: { url: 'https://convocore.ai/docs' } } },
          ],
        },
      },
    },
    visual: {
      description: 'A single image. Image URL MUST end in a real image extension.',
      payload: {
        image: {
          type: 'string',
          required: true,
          description: 'URL ending in .png / .jpg / .jpeg / .webp / .gif / .svg / .avif / .bmp.',
        },
      },
      example: { type: 'visual', payload: { image: 'https://cdn.example.com/x.png' } },
    },
    cardV2: {
      description: 'A single card with optional image, description, and CTA buttons.',
      payload: {
        title: { type: 'string', required: true, description: 'Card title (Markdown ok).' },
        imageUrl: {
          type: 'string',
          optional: true,
          description: 'Image URL with valid image extension (same rule as visual.image).',
        },
        description: {
          type: 'object',
          optional: true,
          properties: { text: { type: 'string', description: 'Description body (Markdown ok).' } },
        },
        buttons: { type: 'array', optional: true, items: '$UiEngineButton' },
      },
      example: {
        type: 'cardV2',
        payload: {
          imageUrl: 'https://cdn.example.com/team.png',
          title: '**Pro plan**',
          description: { text: 'Unlimited agents, voice add-on included.' },
          buttons: [
            { name: 'Upgrade', request: { type: 'open_url', payload: { url: 'https://convocore.ai/billing' } } },
          ],
        },
      },
    },
    carousel: {
      description: 'Horizontal collection of cards. Use 2–8 cards for best UX.',
      payload: {
        cards: { type: 'array', required: true, items: '$UiEngineCardPayload', minItems: 1 },
      },
    },
    iFrame: {
      description: 'Embed an external URL or raw <iframe> markup. Use for video, maps, custom widgets.',
      payload: {
        layout: {
          type: 'string',
          required: true,
          enum: ['vertical', 'horizontal'],
          description: 'vertical = video embeds (YouTube etc.), horizontal = general web embeds.',
        },
        url: {
          type: 'string',
          required: true,
          description: 'Either a plain URL or the full <iframe ...> HTML string for custom embeds.',
        },
      },
    },
    form: {
      description:
        'Multi-field form rendered inline. WEB CHANNELS ONLY (web-chat / text). Suppress on voice / telephony / messaging.',
      payload: {
        title: { type: 'string', optional: true },
        description: { type: 'string', optional: true },
        fields: { type: 'array', required: true, items: '$UiEngineInputField', minItems: 1 },
        submitButton: {
          type: 'object',
          optional: true,
          properties: {
            label: { type: 'string', default: 'Submit' },
            style: { type: 'string', enum: ['primary', 'secondary', 'success', 'warning', 'danger'], default: 'primary' },
          },
        },
        onSubmit: {
          type: 'object',
          required: true,
          properties: {
            type: { type: 'string', enum: ['submit_form'], required: true },
            message: { type: 'string', optional: true, description: 'Bot reply after successful submission.' },
          },
        },
        submittedData: {
          type: 'array',
          optional: true,
          description: 'Server / client populates this after the user submits to render the filled state.',
          items: {
            properties: {
              index: 'integer',
              label: 'string',
              value: 'any',
              field_id: 'string',
              field_type: 'string',
            },
          },
        },
        isSubmitted: { type: 'boolean', optional: true },
      },
    },
    input: {
      description: 'Single inline input field. WEB CHANNELS ONLY.',
      payload: {
        field: { type: '$UiEngineInputField', required: true },
        submitOnEnter: { type: 'boolean', optional: true, default: true },
        onSubmit: {
          type: 'object',
          required: true,
          properties: {
            type: { type: 'string', enum: ['submit_input'], required: true },
            message: { type: 'string', optional: true, description: 'Bot reply after submit.' },
          },
        },
        submittedValue: { type: 'any', optional: true },
        isSubmitted: { type: 'boolean', optional: true },
      },
    },
  },

  shared: {
    UiEngineButton: {
      description: 'Used inside choice.buttons and cardV2.buttons.',
      properties: {
        name: { type: 'string', required: true, description: 'Visible label.' },
        request: {
          type: 'object',
          required: true,
          properties: {
            type: { type: 'string', enum: ['open_url', 'text'], required: true },
            payload: {
              oneOf: [
                {
                  when: 'type === "open_url"',
                  properties: {
                    url: { type: 'string', required: true, description: 'Real URL — must come from KB / tool output, never invented.' },
                  },
                },
                {
                  when: 'type === "text"',
                  properties: {
                    message: { type: 'string', required: true, description: 'User message sent on click.' },
                  },
                },
              ],
            },
          },
        },
      },
    },
    UiEngineInputField: {
      description: 'Single field definition for form.fields[] and input.field.',
      properties: {
        id: { type: 'string', required: true, description: 'Stable form key.' },
        type: {
          type: 'string',
          required: true,
          enum: [
            'text',
            'email',
            'password',
            'number',
            'tel',
            'url',
            'textarea',
            'select',
            'checkbox',
            'radio',
            'date',
            'time',
            'datetime-local',
            'file',
          ],
        },
        label: { type: 'string', required: true },
        placeholder: { type: 'string', optional: true },
        required: { type: 'boolean', optional: true, default: false },
        validation: {
          type: 'object',
          optional: true,
          properties: {
            minLength: 'integer?',
            maxLength: 'integer?',
            min: 'number?',
            max: 'number?',
            pattern: { type: 'string', optional: true, description: 'Regex.' },
            errorMessage: { type: 'string', optional: true },
          },
        },
        options: {
          type: 'array',
          conditionallyRequired: 'when type === "select" or type === "radio"',
          description: 'Non-empty array of { value, label } pairs. Never emit empty.',
          items: { properties: { value: 'string', label: 'string' } },
        },
        defaultValue: { type: 'string | number | boolean', optional: true },
      },
    },
  },

  rules: [
    'UI Engine output is OVERWRITING. Each ui_engine chunk replaces the previous snapshot — never concatenate.',
    'Always emit valid JSON inside chunk.chunk when ui_engine: true. The whole snapshot must round-trip JSON.parse safely.',
    'Buttons NEVER invent URLs. open_url buttons must use real URLs surfaced from KB or tool output.',
    'select / radio fields require a non-empty options[] array — never emit empty options.',
    'visual.image and cardV2.imageUrl must end in a real image extension. No data: URIs, no .html / .pdf.',
    'form and input messages MUST be suppressed on voice / telephony / messaging channels (use lightConvoData.origin to gate).',
    'Mix message types freely in messages[] — e.g. one text + one choice + one cardV2 — but keep total count reasonable (under ~10).',
    'Markdown is supported in text.payload.message, cardV2.title, and cardV2.description.text.',
    'iFrame.layout: use "vertical" for video embeds (YouTube etc.) and "horizontal" for general web embeds.',
    'For long descriptive answers, prefer a single text message. Reach for cards / carousels only when there is real visual structure to convey.',
  ],

  validationChecklist: [
    'JSON.parse(chunk.chunk) succeeds without error.',
    'parsed.from === "bot" and parsed.messages is an array.',
    'Every messages[i].item.type is one of: text, choice, visual, cardV2, carousel, iFrame, form, input.',
    'choice.buttons.length >= 1 and every button has { name, request: { type, payload } }.',
    'cardV2 has a title; if imageUrl is set it ends in a valid image extension.',
    'form / input only appear when lightConvoData.origin is "web-chat" or "text".',
    'Every select/radio field has options.length >= 1.',
    'No URL is invented — cross-check open_url URLs against KB / tool output.',
  ],
} as const;
