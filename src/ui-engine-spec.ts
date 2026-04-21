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
  'UI ENGINE — TWO LAYERS YOU MUST KEEP STRAIGHT:',
  '',
  'LAYER 1 — AGENT LLM OUTPUT CONTRACT (what the tested agent is INSTRUCTED to emit):',
  '  - The agent\'s system prompt forces its LLM to output ONE JSON ARRAY of message objects:',
  '      [ { "type": "text"|"choice"|"visual"|"cardV2"|"carousel"|"iFrame"|"form"|"input", "payload": {...} }, ... ]',
  '  - The very first character MUST be "[" and the very last MUST be "]". No prose, no ```json fences, no leading/trailing newlines.',
  '  - Preferred message order in the array: text intro -> card / carousel / visual -> iFrame (if video URL exists) -> choice buttons (CTAs).',
  '  - Buttons / image URLs / iFrame URLs MUST come from KB or tool output. NEVER invent URLs. If KB has nothing, omit the button or fall back to text.',
  '  - select / radio fields MUST include a non-empty options[] of { value, label }. If real options are unknown, use type "text" or "textarea" instead.',
  '  - form / input messages WEB CHANNELS ONLY (web-chat / text). On voice / telephony / WhatsApp / SMS / messaging the server strips them.',
  '  - WhatsApp extra rule: only use visual / cardV2 / carousel when you have a verified image URL from KB or a tool — otherwise use text only.',
  '',
  'LAYER 2 — WIRE FORMAT (what arrives over the /interact WebSocket):',
  '  - When chunk.ui_engine === true, chunk.chunk is a JSON-stringified TurnProps SNAPSHOT of the bot turn so far.',
  '  - SNAPSHOTS ARE OVERWRITING — replace the in-progress turn with the latest parse, never concatenate.',
  '  - Parsed shape: { from: "bot", ts, modelId?, messages: ChatMessage[] }.',
  '  - Each ChatMessage wraps the agent\'s array entry: { from: "bot", type, ts, mid?, item: { type, payload } }.',
  '    So agent emits [{ type, payload }, ...]  ->  wire wraps each as { ..., item: { type, payload } } inside messages[].',
  '',
  'PAYLOAD SHAPES (item.payload):',
  '  text     -> { message } (Markdown supported).',
  '  choice   -> { buttons: [{ name, request: { type: "open_url"|"text", payload: { url|message } } }] }.',
  '  visual   -> { image } (URL ending in .png/.jpg/.jpeg/.webp/.gif/.svg/.avif/.bmp).',
  '  cardV2   -> { title, imageUrl?, description?: { text }, buttons?: UiEngineButton[] }.',
  '  carousel -> { cards: CardPayload[] }.',
  '  iFrame   -> { layout: "vertical"|"horizontal", url } (vertical = video embeds, horizontal = general web).',
  '  form     -> { title?, description?, fields: UiEngineInputField[], submitButton?, onSubmit: { type: "submit_form", message? } }. Web channels only.',
  '  input    -> { field: UiEngineInputField, submitOnEnter?, onSubmit: { type: "submit_input", message? } }. Web channels only.',
  '  UiEngineInputField.type: text|email|password|number|tel|url|textarea|select|checkbox|radio|date|time|datetime-local|file.',
  '',
  'WHEN ui_engine === false (or omitted): chunk.chunk is plain Markdown text — append to the in-progress assistant message.',
  'TO FORCE PLAIN TEXT on a UI-Engine-enabled agent for one turn: pass disableUiEngine: true on the InteractRequest.',
  '',
  'SERVER SANITIZERS YOU SHOULD KNOW (so you do not get surprised when a message disappears):',
  '  - form messages with zero valid fields are DROPPED.',
  '  - input messages with an invalid field are DROPPED.',
  '  - select / radio fields with empty / duplicate / missing-label options are DROPPED.',
  '  - any field missing id or label is DROPPED.',
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

  /**
   * The contract the AGENT'S LLM is forced to follow by the system prompt
   * (mirror of `createUiEnginePrompt` on the backend). The wire-side wrap
   * (TurnProps -> messages[].item) is performed by the server AFTER the LLM
   * emits this raw array. Use this section when you want to validate
   * whether the tested agent is producing the right shape.
   */
  agentOutputContract: {
    description:
      "What the tested agent's LLM is INSTRUCTED to emit before the server wraps it into TurnProps. The output MUST be a single JSON array of message objects.",
    rawShape: 'Array<{ type: UiEngineMessageType; payload: object }>',
    hardRules: [
      'First character of the LLM output MUST be "[" and the last MUST be "]".',
      'No prose, no explanations, no leading/trailing whitespace, no ```json fences, no \\n escapes outside of legal JSON strings.',
      'Output ONLY the JSON array. Anything else triggers a parse error and the turn falls back to plain text.',
      'URLs (open_url buttons, visual.image, cardV2.imageUrl, iFrame.url) MUST come from KB context or tool output. NEVER invent URLs.',
      'select / radio fields MUST include a non-empty options[] of { value, label } pairs. If real options are unknown, use type "text" or "textarea" instead.',
      'Image URLs MUST end in a real image extension (.png/.jpg/.jpeg/.webp/.gif/.svg/.avif/.bmp). Never link to .html / .pdf / data: URIs.',
    ],
    serverSanitizers: [
      'form messages with zero valid fields are DROPPED before being persisted.',
      'input messages whose field fails validation are DROPPED.',
      'select / radio fields with empty / duplicate / missing-label options are DROPPED from their parent message.',
      'Any input field missing id or label is DROPPED.',
    ],
  },

  preferredStructure: {
    description:
      'Recommended ordering for the messages[] array — produces the cleanest UX. Not enforced, but the system prompt nudges the LLM toward this.',
    sequence: [
      '1. text — short intro / acknowledgement to anchor the conversation.',
      '2. cardV2 / carousel / visual — surface the visual structure (services, products, screenshots).',
      '3. iFrame — embed video / map / external widget when a relevant URL exists in the KB.',
      '4. form / input — collect data (web channels only).',
      '5. choice — final CTAs / next-step buttons.',
    ],
    sizing: 'Aim for under ~10 messages total. Keep choice.buttons to 1–6 and carousel.cards to 2–8.',
  },

  channelRules: {
    description:
      'How the system prompt mutates per channel. The MCP only sees the result, but knowing this helps interpret why a message is missing.',
    'web-chat / text': {
      allowedTypes: ['text', 'choice', 'visual', 'cardV2', 'carousel', 'iFrame', 'form', 'input'],
      notes: 'Full UI Engine surface available. form / input render inline.',
    },
    voice: {
      allowedTypes: ['text', 'choice', 'visual', 'cardV2', 'carousel', 'iFrame'],
      notes:
        'form / input are stripped — the agent prompt is built without them so the LLM never emits them.',
    },
    whatsapp: {
      allowedTypes: ['text', 'choice', 'visual', 'cardV2', 'carousel', 'iFrame'],
      notes:
        'Extra rule injected: only emit visual / cardV2 / carousel when an image URL is verified from KB / tools / system prompt. Otherwise FALL BACK to text only — never construct an image URL from a website domain (e.g. "https://company.com/uploads/x.png" is forbidden).',
    },
    sms: {
      allowedTypes: ['text', 'choice', 'visual', 'cardV2', 'carousel', 'iFrame'],
      notes: 'Same as WhatsApp; treat image URLs as untrusted unless verified.',
    },
    telephony: {
      allowedTypes: ['text', 'choice'],
      notes: 'Only text and choice render usefully; the rest collapse to text TTS.',
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
    'The agent\'s LLM is instructed to output ONLY a JSON array — first char "[", last char "]", no fences, no prose.',
    'Buttons NEVER invent URLs. open_url buttons must use real URLs surfaced from KB or tool output.',
    'select / radio fields require a non-empty options[] array — never emit empty options. The server drops them otherwise.',
    'visual.image and cardV2.imageUrl must end in a real image extension. No data: URIs, no .html / .pdf.',
    'form and input messages MUST be suppressed on voice / telephony / messaging channels (use lightConvoData.origin to gate).',
    'On WhatsApp / SMS, only emit visual / cardV2 / carousel when the image URL is verified from KB or a tool — otherwise fall back to text.',
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
    'form / input only appear when the channel is "web-chat" or "text".',
    'Every select/radio field has options.length >= 1.',
    'No URL is invented — cross-check open_url URLs against KB / tool output.',
    'When testing on WhatsApp / SMS, no image-bearing message uses an unverified URL.',
  ],

  /**
   * Canonical example outputs lifted from the backend `createUiEnginePrompt`.
   * These show what the agent's LLM is supposed to emit BEFORE the server
   * wraps each entry into messages[].item. Use them as a reference target
   * when validating a UI Engine snapshot.
   */
  examples: {
    basicText: [
      { type: 'text', payload: { message: 'Hello there! How can I help you today?' } },
    ],
    carousel: [
      { type: 'text', payload: { message: "Sure! Here's a showcase of our services in brief details:" } },
      {
        type: 'carousel',
        payload: {
          cards: [
            {
              title: 'Service 1',
              description: { text: 'Service 1 is a great service that helps you with your needs.' },
            },
          ],
        },
      },
    ],
    singleInput: [
      { type: 'text', payload: { message: "I'd be happy to help! What's your email address?" } },
      {
        type: 'input',
        payload: {
          field: {
            id: 'user_email',
            type: 'email',
            label: 'Email Address',
            placeholder: 'Enter your email address',
            required: true,
            validation: { errorMessage: 'Please enter a valid email address' },
          },
          onSubmit: {
            type: 'submit_input',
            message: "Thanks! I'll use this email to send you the information.",
          },
        },
      },
    ],
    multiFieldForm: [
      { type: 'text', payload: { message: "Please fill out this contact form and I'll get back to you soon:" } },
      {
        type: 'form',
        payload: {
          title: 'Contact Information',
          description: 'Please provide your details so we can assist you better.',
          fields: [
            { id: 'full_name', type: 'text', label: 'Full Name', placeholder: 'Enter your full name', required: true },
            { id: 'email', type: 'email', label: 'Email Address', placeholder: 'Enter your email', required: true },
            { id: 'phone', type: 'tel', label: 'Phone Number', placeholder: 'Enter your phone number' },
            {
              id: 'inquiry_type',
              type: 'select',
              label: 'Type of Inquiry',
              required: true,
              options: [
                { value: 'support', label: 'Technical Support' },
                { value: 'sales', label: 'Sales Question' },
                { value: 'general', label: 'General Inquiry' },
              ],
            },
            {
              id: 'message',
              type: 'textarea',
              label: 'Your Message',
              placeholder: 'Tell us how we can help you',
              required: true,
              validation: { minLength: 10, errorMessage: 'Please provide at least 10 characters' },
            },
          ],
          submitButton: { label: 'Send Message', style: 'primary' },
          onSubmit: {
            type: 'submit_form',
            message: "Thank you for contacting us! We'll get back to you within 24 hours.",
          },
        },
      },
    ],
  },
} as const;
