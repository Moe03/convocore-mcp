/**
 * Global MCP server instructions returned in the initialize response.
 * Hosts (Cursor, Claude, etc.) may inject this into the system prompt.
 * Keep comprehensive but scannable — do not duplicate entire tool schemas here.
 */

export type WidgetEmbedMode = 'popup-bottom-right' | 'popup-bottom-left' | 'full-width' | 'modal';

export function widgetRegionFromApiRegion(apiRegion: 'eu-gcp' | 'na-gcp'): 'eu' | 'na' {
  return apiRegion === 'na-gcp' ? 'na' : 'eu';
}

/**
 * Public try-it demo URL for an agent (NOT the dashboard /agents/ route).
 * Pattern: https://app.convocore.ai/{eu|na}/prototype/{agentId}
 */
export function buildPrototypeAgentUrl(
  agentId: string,
  apiRegion: 'eu-gcp' | 'na-gcp' | 'eu' | 'na' = 'eu-gcp'
): string {
  const id = agentId.trim();
  const region =
    apiRegion === 'na' || apiRegion === 'na-gcp'
      ? 'na'
      : apiRegion === 'eu' || apiRegion === 'eu-gcp'
        ? 'eu'
        : widgetRegionFromApiRegion(apiRegion);
  return `https://app.convocore.ai/${region}/prototype/${encodeURIComponent(id)}`;
}

export function buildWidgetEmbedSnippet(options: {
  agentId: string;
  region: 'eu' | 'na';
  mode?: WidgetEmbedMode;
  containerWidth?: string;
  containerHeight?: string;
}): string {
  const mode = options.mode ?? 'popup-bottom-right';
  const isFullWidth = mode === 'full-width';
  const render =
    mode === 'popup-bottom-left'
      ? 'bottom-left'
      : mode === 'full-width'
        ? 'full-width'
        : 'bottom-right';
  const modalMode = mode === 'modal';
  const width = isFullWidth ? options.containerWidth ?? '500px' : '0';
  const height = isFullWidth ? options.containerHeight ?? '500px' : '0';

  const modalLine = modalMode ? '\n    modalMode: true,' : '';

  return `<div style="width: ${width}; height: ${height};" id="VG_OVERLAY_CONTAINER"></div>
<script defer>
(function () {
  window.VG_CONFIG = {
    ID: "${options.agentId}",
    region: "${options.region}",
    render: "${render}",${modalLine}
    stylesheets: ["https://cdn.convocore.ai/vg_live_build/styles.css"],
  };
  var s = document.createElement("script");
  s.src = "https://cdn.convocore.ai/vg_live_build/vg_bundle.js";
  s.defer = true;
  document.body.appendChild(s);
})();
</script>`;
}

export function buildVoiceSdkExample(agentId: string, region: 'eu' | 'na'): string {
  return `"use client";
import React from "react";
import { WebCall } from "@tixae-labs/web-sdk";

export default function VoicePage() {
  const [voice, setVoice] = React.useState<WebCall | null>(null);

  React.useEffect(() => {
    (async () => {
      const call = new WebCall();
      await call.init({ agentId: "${agentId}", region: "${region}" });
      call.on("call-start", () => console.log("call started"));
      call.on("final_transcript", (data) => console.log("transcript", data));
      call.on("call-ended", () => console.log("call ended"));
      call.on("error", (err) => console.error(err));
      setVoice(call);
    })();
  }, []);

  return (
    <div>
      <button onClick={() => voice?.startCall()}>Start call</button>
      <button onClick={() => voice?.endCall()}>End call</button>
    </div>
  );
}`;
}

export const MCP_SERVER_INSTRUCTIONS = `# Convocore MCP — usage guide

You manage Convocore AI agents via this MCP. Follow these rules so integrations work without mistakes.

## CRITICAL — public "try the agent" / prototype demo link

After creating or fetching an agent, **always give the user a clickable prototype URL** so they can try the agent in the browser.

**Correct pattern only:**
\`https://app.convocore.ai/{region}/prototype/{agentID}\`

- \`region\` is \`eu\` or \`na\` (from API region: \`eu-gcp\` → \`eu\`, \`na-gcp\` → \`na\`).
- Example: \`https://app.convocore.ai/eu/prototype/6TUWPdhWvPPssnca5z78\`

**Never invent these (they are wrong):**
- \`https://app.convocore.ai/agents/...\`
- \`/app/agents/...\`
- bare dashboard edit URLs as the "try it" link

Tool responses include \`prototypeUrl\` / \`tryItUrl\` when available — **copy that exact URL** into your reply. Do not reconstruct a different path.

## CRITICAL — "deploy to website" / "embed code" / "widget script"

When the user asks how to deploy, embed, or add their agent to a website (or asks "where is the code"):
1. **Call \`get_website_embed_code\`** (with their agentId + mode) — or \`list_agents\` first if you don't know the agent ID.
2. **Paste the returned HTML/JS snippet** in your reply. That IS the deployment code.
3. **Do NOT** tell them to go to the dashboard Channels tab, Deployment tab, or platform docs instead of giving code.
4. **Do NOT** answer with only high-level options (popup vs embedded) without the actual script.
5. Mention Shopify/WordPress/Wix only as a one-liner: "paste this snippet before \`</body>\`" — the snippet works on any platform.

## CRITICAL — chat model for new agents

- **Default:** \`deepseek-ai/DeepSeek-V4-Flash\` (\`vg_defaultModel\` + \`nodes[0].llmConfig.modelId\`).
- **Fallback during testing:** if Flash underperforms (broken UI-Engine JSON, ignores instructions, hallucinates), switch to **\`gpt-5.6-luna\`** via \`update_agent\` / \`modelId\` and **tell the user** which model the agent ended on.
- **Do not** pick legacy models: \`gpt-4o\`, \`gpt-4o-mini\`, GPT-4.1, GLM-5, or other old defaults.

## CRITICAL — scraped images (you must LOOK at them)

Interactive agents live or die on **real, correctly labeled photos**. Filename, alt text, and a URL in the scrape JSON are **not** understanding.

After \`scrape_url\` (\`mode: "scrape"\`) on each important page:

1. Collect candidate image URLs from the scrape (page images, og/hero, product/room/treatment galleries, team photos). Skip 1×1 pixels, tracking pixels, sprites, and tiny UI icons.
2. \`scrape_url\` \`mode: "check"\` on those URLs — keep only \`ok\` responses with an image \`content-type\` and a real image extension (or CDN URL that still returns an image).
3. **You must call \`read_image\` with \`url\` on every high-value photo** (products, rooms, treatments, devices, properties, before/after, team). The host will show you the pixels. Describe what you actually see.
4. Bake a **labeled image catalog** into \`systemPrompt\` / \`nodes[0].instructions\`: exact URL + one-line caption of what the photo is (e.g. "Fusion 8 device, front 3/4 view"). Cards/carousels may use **only** these URLs.
5. Optional backup: \`create_kb_image\` (\`autoCaption: true\`) so RAG has the pictures too — this does **not** replace you looking with \`read_image\`.
6. Never dump unlabeled URL lists. Never invent image URLs. Never use the logo as a stand-in for a product photo.

If \`read_image\` fails for a URL, drop it. Do not put a broken link on a card.

## CRITICAL — KB vs system prompt (node agents)

**Root cause of "KB exists but agent says I don't know":** uploading docs under \`agentId\` is **not** enough by itself. Node agents need **\`nodes[0].kb.enabled: true\`** for automatic retrieval.

MCP now sets this by default on \`create_agent_from_template\` / start nodes (\`enableAutoRag=true\` → \`nodes[0].kb\` with \`maxChunks\`, \`smartSearch\`, \`searchOnStart\`).

**Still mandatory:** bake every critical scraped fact (pricing ranges, offerings, policies, contacts, room/item categories, confirmed image URLs) into **\`systemPrompt\` / \`nodes[0].instructions\`**. KB is a secondary layer. Do not ship an agent whose only copy of ground truth lives in KB docs.

After create: verify with \`interact_with_agent\` fact questions that only the knowledge source answers — if the model deflects, patch more facts into the prompt and re-test.

## CRITICAL — main prompt & agent schema (nodes only)

- **Always node-based.** MCP forces \`enableNodes=true\` on create/update. Do **not** set \`enableNodes\`, \`vg_instructions\`, or \`vg_systemPrompt\` as caller inputs — the API **rejects** \`vg_instructions\` / \`vg_systemPrompt\` as unknown top-level fields. \`update_agent\` / \`create_agent\` strip them automatically.
- **Canonical main prompt** = \`nodes[0].instructions\`. Pass it as \`systemPrompt\` on \`create_agent\` / \`create_agent_from_template\` / \`update_agent\`.
- Prefer \`create_agent_from_template\` for website/branded agents. Use raw \`create_agent\` only for advanced control.
- Large prompt edits: \`patch_agent_prompt\` (\`old_string\` → \`new_string\`) targeting \`nodes0\` / \`auto\`. If get_agent shows an empty prompt, do **not** surgical-patch (that used to replace the entire prompt with \`new_string\`). Use \`update_agent\` + **full** \`systemPrompt\` instead.
- **Never PATCH a partial \`nodes\` array as a full replace**, and **omit \`nodes\` entirely** on unrelated updates (title, UI flags, funnel, model). MCP GET-merges by node id and will refuse a partial graph when get_agent did not return nodes. Still prefer \`systemPrompt\` for prompt writes.

## CRITICAL — AI Funnel & lead scoring (NOT a custom HTTP webhook)

Convocore already has a built-in **AI Funnel + lead score** system on the agent:

- Field: **\`funnelConfig\`** — \`enabled\`, \`steps[]\` (id/name/description/condition/points/category), \`notificationRules[]\` (\`type\`: \`score_threshold\` | \`steps_completed\` | \`data_collected\`, \`recipients\` emails, \`cooldownStrategy\`, optional \`scoreThreshold\` / \`requiredSteps\` / \`requiredFields\`).
- Field: **\`leadCollectionRules\`** — when to persist a CRM lead (default: email or phone present).
- Runtime scores the conversation and **emails \`notificationRules.recipients\`** when a rule fires (hot-lead notify). This **is** the sales funnel. Clones do **not** inherit funnel recipients — set them again.
- Template create: pass **\`ownerNotifyEmails\`** — MCP installs a default lead-score funnel + UI Engine form notify to those inboxes.
- **Do NOT** create HTTP tools like \`notify_sales_team_new_lead\` with placeholder \`serverUrl\`. That is wrong. Use \`funnelConfig\` / \`update_agent\` / \`create_agent_from_template\`.
- CRM backup: \`leads_write\` action=create when the visitor gives contact details.
- UI Engine forms still collect structured fields; funnel scores + emails; CRM stores the lead.

## CRITICAL — list tools: compact by default

All listing tools default to **\`mode=compact\`** (short fields, token-cheap). You choose when to escalate:

| Tool | Compact returns | Use \`mode=full\` when… | Prefer for one item |
|------|-----------------|------------------------|---------------------|
| \`list_agents\` / \`search_agents\` | id, title, description, theme, flags, timestamps | You truly need every nested field in the list | \`get_agent\` |
| \`list_conversations\` | id, ts, summary, user, origin (no messages) | You need raw list rows beyond compact | \`get_conversation\` / \`get_conversations_bulk\` |
| \`list_kb_docs\` | id, name, status, urls (no content bodies) | You need every list field | \`get_kb_doc\` |
| \`leads_read\` action=list | id, name, email, phone, ts, source | You need full metaData on every row | \`leads_read\` action=get |
| \`orgs_read\` list/search/list_* | short org/client/agent fields | Complete org/client payloads in bulk | \`orgs_read\` action=get |
| \`clients_read\` action=list | id, name, email, orgId | Complete client objects in bulk | \`clients_read\` action=get |

**Rules:** stay on compact unless the user needs bulk heavy fields. Never use \`mode=full\` “just in case”. \`list_agents\` compact defaults \`limit=25\`.

## CRITICAL — "Create an agent for this website" (full pipeline)

When the user asks to create an agent for a website/URL (or similar), run this end-to-end — do not skip steps:

### Phase 1 — Discover & scrape (≥10 pages of understanding)
1. Resolve the homepage URL. Call \`scrape_url\` (\`mode: "scrape"\`) on the homepage for title, colours, favicon, and page text.
2. Discover more URLs: follow internal links from the scrape, and/or fetch \`/sitemap.xml\` / common paths (about, services, pricing, products, contact, blog, FAQ).
3. **Scrape at least 10 distinct pages** with \`scrape_url\` (\`mode: "scrape"\`, **\`useProxy=false\`**) before writing the prompt. Cover: home, about, offerings, pricing (if any), contact, and other high-value pages. Parallelize when safe.
4. If a page is blocked without proxy: **stop and ask the user** whether to retry with proxy (much more expensive — ~60 credits/page vs ~1; burns workspace credits). Only after they confirm, retry with \`useProxy: true\` + \`confirmExpensiveProxy: true\`. Never turn on proxy silently.
5. Extract brand: primary hex (\`primaryColor\`), logo/favicon (\`widgetImageUrl\`), tone, languages, CTAs, audience.
6. **Post-process images (mandatory):** collect gallery/product/room/treatment photos from those scrapes → \`scrape_url\` \`mode: "check"\` → **\`read_image\` with \`url\` on each keeper** so you see what it is → labeled URL catalog in the prompt. Do not skip this.

### Phase 2 — Write a comprehensive \`systemPrompt\` (PRIMARY knowledge)
Draft a **long, detailed** main prompt (becomes \`nodes[0].instructions\`) that includes:
- Who the business is, what they sell/do, who they serve, geography
- Products/services/room or item **categories** with specifics from scraped pages (names, amenities)
- A **labeled image catalog**: only URLs you personally inspected with \`read_image\`, each with what the photo shows. UI Engine cards must use this catalog.
- Indicative pricing **only when scraped** — never invent per-SKU / per-room / per-date rates. Still try hard: scrape room/item pages normally, and if blocked ask the user to confirm **proxy** scrape. For hotel chains and dynamic-rate sites: bake whatever categories/amenities/images you did get; state "from $X" honesty + booking link when live rates aren't scrapable; prefer a live rates API tool when the brand exposes one
- Tone, language rules, what to do / never do
- Lead-capture / form behavior (template also appends a standard lead-capture clause)
- Anti-repetition (template appends a standard clause)
- Knowledge boundaries + built-in **web-search** fallback clause

**Do not** rely on KB alone. Prompt = source of truth; KB = backup retrieval.

### Phase 3 — Create the agent
1. Call \`create_agent_from_template\` with: \`title\`, **full \`systemPrompt\`**, \`primaryColor\`, \`widgetImageUrl\`, \`sourceUrl\`, \`ownerNotifyEmails\` (sales inbox — also wires **funnelConfig** email notify), voice as needed.
 Defaults already enable: \`enableAutoRag\`, forms + form-notify, **funnelConfig + leadCollectionRules**, standard prompt clauses, DeepSeek-V4-Flash.
2. Return \`prototypeUrl\` immediately. Note \`modelIdUsed\` and \`webSearchTool\` from the response.
3. Do **not** pass \`enableNodes\` / \`vg_instructions\`.

### Phase 4 — Ingest knowledge (secondary layer)
1. Collect many URLs → \`create_kb_from_urls\` / sitemap. Confirm \`nodes[0].kb.enabled\` via \`get_agent\` if unsure.
2. Poll \`list_kb_docs\` (compact) until ready.
3. Ask: does this business expose a **public rates/availability API**? If yes, wire \`create_agent_tool\` for live pricing instead of static scrape.

### Phase 5 — Lead capture path (required for commercial sites)
1. Template enables \`vg_enableUIEngineForms\` + form notify **and** \`funnelConfig\` (AI Funnel / lead scoring). Pass \`ownerNotifyEmails\` so funnel \`notificationRules\` email sales on hot leads.
2. Prompt must instruct the agent to render a lead form on buying/booking intent **and** qualify into the funnel (contact, intent, timeline, offering). Never invent a notify-sales HTTP tool.
3. Backup: when the user gives contact info, also \`leads_write\` action=create so CRM has the lead.
4. Existing agents missing a funnel: \`update_agent\` with \`funnelConfig\` (use default steps + \`notificationRules.recipients\`) + \`leadCollectionRules\`. Do **not** wait on a webhook URL from the customer.

### Phase 6 — Mandatory test protocol (8–12 turns) — do NOT skip
Use \`interact_with_agent\` with \`isTest: true\` for a multi-turn conversation covering at least:
1. Greeting (\`start\` / hello)
2. Specific fact lookup (must surface prompt/KB data — fail if "I don't have that")
3. Follow-up on same topic (no verbatim repetition)
4. Comparison across two items/properties
5. Out-of-scope question (graceful redirect, no hallucination)
6. Buying-intent message (form / lead path triggers; CRM \`leads_write\` if contact given)
7. Unknown-data question (built-in web-search should fire, else honest "don't know")
8. Rephrased earlier question (anti-repetition)
9. Image/card rendering using **labeled catalog URLs only** (the photos you \`read_image\`'d — not a random hero)
Plus \`run_agent_auto_test\` (full / with-tools) when feasible.
**Report a short test transcript summary to the user.** Agent is not done until this protocol passes. Single-turn smoke tests are insufficient.

**Do not** stop after a single homepage scrape + short prompt. Depth of scrape → rich prompt bake-in → KB → lead path → deep test is mandatory.

## Before you change an agent

1. Call \`get_agent\` when unsure of current config.
2. **Main prompt:** always \`nodes[0].instructions\` (via \`systemPrompt\` / \`patch_agent_prompt\`). Legacy \`vg_instructions\` only if reading a very old agent with no nodes.
3. **Large prompt edits:** prefer \`patch_agent_prompt\` over full rewrites.
4. Prefer \`create_agent_from_template\` for new chat+voice agents.
5. \`ownerID\` / workspace ID is read-only — never PATCH it.
6. \`search_agents\` may 404 on some workspaces — use \`list_agents\` or \`get_agent\` instead.
7. Listing: keep **\`mode=compact\`** unless you explicitly need heavy payloads (see table above).

## Interact / UI Engine agents

- \`interact_with_agent\` runs a **real** LLM turn (uses credits).
- If \`uiEngineEnabled: true\`, read **\`uiEngineSummary\`** or \`uiEngineSnapshot\` — \`assistantText\` is often empty.
- Call \`get_ui_engine_spec\` before validating or building UI-Engine output.
- **Which UI elements the agent may show** is configured on the agent via \`update_agent\` / \`create_agent\`:
  - \`vg_enableUIEngine\` — master switch (cards, choice/buttons, carousels, visuals, iFrames, …)
  - \`vg_enableUIEngineForms\` — form + input
  - \`vg_enableUIEngineInvoice\` — invoice cards
  - \`vg_enableUIEngineCalendarBooking\` — calendar booking widget
  - \`vg_uiEngineChannelConfig\` — per-channel allowlist (\`web\` / \`whatsapp\` / … → type→boolean)
  - Optional: \`vg_maxImagesPerCard\`, \`vg_uiEngineFormNotifyConfig\`, \`vg_uiEngineInvoiceConfig\`, \`vg_uiEngineCalendarConfig\`
- Example: enable cards+buttons on web, no forms: \`{ "vg_enableUIEngine": true, "vg_uiEngineChannelConfig": { "web": { "choice": true, "cardV2": true, "form": false } } }\`

---

## Website embed — chat widget (most common)

When the user asks to put their agent on a website, **call \`get_website_embed_code\`** and paste the returned \`html\` field — do not hand-wave about dashboard tabs.

### Step 1 — get IDs (required)

1. Call \`get_agent\` → use \`data.ID\` (or \`data.id\`) as **AGENT_ID**.
2. Map API region to widget region:
   - \`CONVOCORE_API_REGION=eu-gcp\` or workspace in EU → \`region: 'eu'\`
   - \`CONVOCORE_API_REGION=na-gcp\` or workspace in NA → \`region: 'na'\`
   - If unknown, ask or infer from agent/dashboard URL (\`/app/eu/...\` → \`eu\`, \`/app/na/...\` → \`na\`).

**Never leave placeholder IDs in the final snippet you give the user.**

### Step 2 — pick embed mode

| User wants | \`render\` | \`modalMode\` | \`#VG_OVERLAY_CONTAINER\` size |
|------------|-----------|---------------|--------------------------------|
| Chat **inside a div** (fixed box on page) | \`'full-width'\` | \`false\` / omit | Set width & height on the div (e.g. \`500px\` × \`500px\`) |
| **Floating bubble** bottom-right (default popup) | \`'bottom-right'\` | omit / \`false\` | \`width: 0; height: 0;\` (hidden anchor) |
| Floating bubble bottom-left | \`'bottom-left'\` | omit / \`false\` | \`width: 0; height: 0;\` |
| **Center modal** overlay | \`'bottom-right'\` or \`'bottom-left'\` | \`true\` | \`width: 0; height: 0;\` |

Always include:
- \`<div id="VG_OVERLAY_CONTAINER">\` (required mount point)
- \`window.VG_CONFIG\` with \`ID\`, \`region\`, \`render\`, and \`stylesheets: ["https://cdn.convocore.ai/vg_live_build/styles.css"]\`
- Loader script: \`https://cdn.convocore.ai/vg_live_build/vg_bundle.js\`

Optional \`VG_CONFIG\` fields (only mention if relevant):
- \`user: { name, email, phone }\` — pre-fill visitor info
- \`userID\` — stable visitor id from their auth system
- \`autostart: true\` — open with proactive greeting automatically
- Extra \`stylesheets\` — URLs to custom CSS files (see styling section below)

**Performance:** \`defer\` on the script delays load until HTML is parsed (better for site speed). Removing \`defer\` loads the widget faster but can slow the page.

### Widget snippet template (replace AGENT_ID and REGION)

\`\`\`html
<div style="width: 0; height: 0;" id="VG_OVERLAY_CONTAINER"></div>
<script defer>
(function () {
  window.VG_CONFIG = {
    ID: "AGENT_ID",
    region: "REGION",
    render: "bottom-right",
    stylesheets: ["https://cdn.convocore.ai/vg_live_build/styles.css"],
  };
  var s = document.createElement("script");
  s.src = "https://cdn.convocore.ai/vg_live_build/vg_bundle.js";
  s.defer = true;
  document.body.appendChild(s);
})();
</script>
\`\`\`

For **embedded div** mode: set \`render: 'full-width'\` and size the container, e.g. \`<div style="width:500px;height:500px;" id="VG_OVERLAY_CONTAINER"></div>\`.

For **modal** mode: add \`modalMode: true\` (keep a corner \`render\` for the trigger button).

Give a **full HTML example** only when the user needs a standalone test page (\`<!DOCTYPE html>\` + container + script before \`</body>\`).

---

## Voice-only embed — React / Next.js

For **voice calls only** (no chat widget UI), use npm package \`@tixae-labs/web-sdk\`:

\`\`\`bash
pnpm install @tixae-labs/web-sdk@latest
\`\`\`

Requires **WebRTC** (modern browsers). Same \`agentId\` + \`region\` (\`'eu'\` or \`'na'\`) as the widget.

Minimal pattern:
- \`new WebCall()\` → \`await voice.init({ agentId, region })\`
- \`voice.startCall()\` / \`voice.endCall()\`
- Listen: \`call-start\`, \`final_transcript\`, \`conversation-update\`, \`call-ended\`, \`error\`
- Optional \`options.messagesHistory\` to seed prior messages in \`init()\`

Use widget embed for **text chat**; use **web-sdk** when the user explicitly wants a **custom voice UI** in React.

---

## Widget styling (change button label color, header, bubbles, etc.)

Custom look is stored on the agent as \`customCSS\` (injected into the widget). **This MCP includes full CSS tooling:**

1. \`get_widget_css_styling_guide\` — **call first**; authoritative \`.vg-*\` selector map + rules.
2. \`get_agent_custom_css\` — read existing CSS (optional, for merges).
3. Generate CSS following the guide (use \`!important\`, compound selectors for icons/text).
4. \`update_agent_custom_css\` — persist **full merged CSS** (replaces entire field; never send only a delta).

Examples that work: "make send button purple", "change header text color", "dark theme widget", "style proactive bubble".

**Note:** Some copy (default button labels, placeholder text) may come from agent config (\`proactiveMessage\`, prompts) — use \`update_agent\` for wording, \`customCSS\` for visual styling.

Alternative: host a \`.css\` file and add its URL to \`VG_CONFIG.stylesheets\` (good for static overrides without MCP).

White-label CDN (\`cdn.yourcompany.com\`) is a paid add-on — default is \`cdn.convocore.ai\`.

---

## Conversation audits (bulk)

- \`list_conversations\` defaults to **\`mode=compact\`** (no message bodies). Cursor-paginated (max 20/page). For page 2+ pass \`cursor\` from \`nextCursor\` — never bump \`page\` alone.
- For audits: collect IDs → \`get_conversations_bulk\` (max 50 IDs/call) → analyze \`summary\` / vars. Use \`mode=full\` on list only if you need raw list rows.
- \`query_conversations\` is an MCP-side filter (list scan + bulk get), not SQL. Bound with \`maxScan\`. Prefer \`get_conversations_bulk\` when you already have IDs.
- Usage across many agents: \`get_agent_usage_bulk\` (max 20). KB audits: \`get_kb_docs_bulk\` (max 30).

## Knowledge base & testing

- **Adding many website pages:** \`create_kb_from_urls\` (max 50 URLs). KB router scrapes (\`scrapeContent=true\`). Do **not** web-fetch / \`scrape_url\` then paste into \`create_kb_doc\`.
- Whole site: \`create_kb_doc\` with \`sourceType=sitemap\`, \`sitemapUrl\`, \`maxPages\`, \`scrapeContent=true\`.
- Single/manual: \`create_kb_doc\` (\`url\` + \`urls[]\` + scrape, or \`doc\` for raw text you already have).
- Bulk create (≤20 docs): \`bulk_create_kb_docs\`. Images: \`create_kb_image\`. Quota: \`get_kb_quota\`. Semantic search: \`search_kb_docs\`. Bulk delete: \`bulk_delete_kb_docs\`.
- \`refreshRate\` is \`3d\` | \`7d\` | \`never\` (not hourly).
- Branding extract (colours/favicon/page text): \`scrape_url\` with \`mode: "scrape"\` + one \`url\`. For KB ingest, always use KB router URL/sitemap tools — not scrape.
- **Proxy scrapes (expensive):** default is **no proxy** (\`useProxy=false\`, ~1 credit/page). If a normal scrape fails/blocks, **ask the user first** — proxy is ~**60 credits/page** and **consumes Convocore workspace credits**. Only then call with \`useProxy: true\` **and** \`confirmExpensiveProxy: true\`. Never enable proxy by default or without explicit user confirmation.
- Scraping is **async** — create returns quickly; poll \`list_kb_docs\` / \`get_kb_doc\` for status.
- **Runtime RAG:** \`nodes[0].kb.enabled=true\` (default on template create). Without it, docs sit unused. Still bake critical facts into the system prompt.
- Audits: \`get_kb_docs_bulk\` (max 30). Test chats: \`interact_with_agent\` with \`isTest: true\` — use the **8–12 turn** protocol for new website agents.
- **Surgical KB edits:** for large docs use \`patch_kb_doc\` instead of full rewrites.
- **Validate links/images:** \`scrape_url\` mode \`check\`. Then **\`read_image\`** on keepers so you know what each photo is. Branding extract: mode \`scrape\`.
- **HTTP tools / variables:** CRUD via \`list_agent_tools\` / …. Test with \`test_agent_tool_request\` then \`test_agent_tool\` / \`run_agent_auto_test\`.
- **Built-in web-search:** template sets \`nodes[0].toolsIds\` to include \`web-search\` (Convocore defaultSystemTools — not a custom HTTP/SerpAPI tool). Disable with \`attachWebSearchTool=false\` if needed.
- **Buying-intent lead capture is not optional** for commercial-website agents: UI Engine forms + **\`funnelConfig\` email notify** + \`leads_write\` CRM backup. Never a custom HTTP sales webhook.

---

## Orgs / clients / agency / leads

- Hierarchy: \`agency_read\`/\`agency_write\` (agency account) → \`orgs_read\`/\`orgs_write\` (organizations + assign agents) → \`clients_read\`/\`clients_write\` (end-user client accounts).
- CRM leads: \`leads_read\` / \`leads_write\` (list/get/export + create/update/import/magic_import/clear).
- Unsure which tool: \`search_mcp_tools\` with a keyword (e.g. "leads", "tools", "clone").

---

## Quick decision tree

- **"Create an agent for this website / URL"** → scrape ≥10 → **\`read_image\` every important photo** → bake facts + **labeled image catalog** into \`systemPrompt\` → \`create_agent_from_template\` (auto RAG + forms + **funnelConfig** via \`ownerNotifyEmails\`) → KB ingest → **8–12 turn tests** (including a card with a real labeled photo) → report transcript summary + \`prototypeUrl\`.
- **"Notify sales / lead funnel / lead score / email us new leads"** → \`funnelConfig\` + \`leadCollectionRules\` + \`ownerNotifyEmails\`. Do **not** \`create_agent_tool\` for notify-sales.
- **"Agent ignores KB / says I don't know"** → confirm \`nodes[0].kb.enabled\`; still patch missing facts into \`systemPrompt\`; re-test fact lookup.
- **"Scrape blocked / need proxy"** → ask user first (proxy ~60 credits/page vs ~1; burns workspace credits). Only after yes: \`scrape_url\` \`mode=scrape\` + \`useProxy=true\` + \`confirmExpensiveProxy=true\`.
- **"I created an agent / let me try it / demo link"** → use \`prototypeUrl\` from the tool result, or build \`https://app.convocore.ai/{eu|na}/prototype/{agentId}\` — never \`/agents/\`.
- **"Add chatbot to my site" / "deploy to website" / "where is the code"** → \`get_website_embed_code\` (or \`list_agents\` compact → then embed tool) → paste \`html\` in reply.
- **"List agents / convos / KB / leads / orgs / clients"** → matching list tool with **\`mode=compact\`** (default). Escalate to \`full\` or \`get_*\` only when needed.
- **"Analyze / score / audit conversations"** → \`list_conversations\` (compact + cursor) → \`get_conversations_bulk\` (chunks of 50) or \`query_conversations\`.
- **"Send WhatsApp / Messenger / SMS as the bot"** → \`send_channel_message\` (pushes to channel; does **not** run LLM). Do **not** use \`update_conversation_messages\` for delivery.
- **"Clone this agent"** → \`clone_agent\` (overrides + carryOver). Not \`import_agent\` / template create. Then re-set \`funnelConfig.notificationRules.recipients\` (clones do not inherit them).
- **"List orgs / clients / agency"** → \`orgs_read\` / \`clients_read\` / \`agency_read\` (list actions: compact). Mutate with \`*_write\`.
- **"CRM leads"** → \`leads_read\` / \`leads_write\` (list: compact).
- **"Add / test an HTTP tool or variable"** → \`create_agent_tool\` / \`create_agent_variable\` → \`test_agent_tool_request\` or \`test_agent_tool\` / \`run_agent_auto_test\`.
- **"Which MCP tool do I use?"** → \`search_mcp_tools\`.
- **"Voice button in my React app"** → \`@tixae-labs/web-sdk\` + agentId + region.
- **"Change widget colors / button look"** → CSS tools (\`get_widget_css_styling_guide\` → \`update_agent_custom_css\`).
- **"Enable cards / buttons / forms / invoice on the agent"** → \`update_agent\` with \`vg_enableUIEngine\` + \`vg_enableUIEngineForms\` / \`vg_enableUIEngineInvoice\` / \`vg_enableUIEngineCalendarBooking\` + optional \`vg_uiEngineChannelConfig\`. Then \`get_ui_engine_spec\` for payloads.
- **"Change what the agent says"** → \`systemPrompt\` / \`patch_agent_prompt\` → \`nodes[0].instructions\` (never \`vg_instructions\` as the primary write). \`proactiveMessage\` for greeting bubble copy.
- **"Tweak one section of a big KB doc"** → \`get_kb_doc\` → \`patch_kb_doc\`.
- **"Search KB by meaning"** → \`search_kb_docs\`. Quota → \`get_kb_quota\`.
- **"Fix agent not answering in Arabic / wrong language"** → check \`lang\`, voice \`language\`, and main prompt — not the embed script alone.

**Slash prompt:** \`integrate_website_widget\` (pass \`agentId\` + optional \`mode\`) returns a copy-paste embed snippet with real IDs filled in.
`;
