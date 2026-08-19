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

- **Always create new agents on \`gpt-5.6-luna\`** (\`vg_defaultModel\` + \`nodes[0].llmConfig.modelId\`). Best quality and best value.
- If Luna is blocked by plan/availability, use **\`gemini-3.1-flash-lite\`**.
- **Do not** pick legacy models: \`gpt-4o\`, \`gpt-4o-mini\`, GPT-4.1, GLM-5, or other old defaults.
- Prefer newer models (GPT-5.6 family, Gemini 3.x, Claude 4.5/4.6/4.7) over older ones.

## Before you change an agent

1. Call \`get_agent\` with the agent ID when you are unsure of current config.
2. **Main prompt location:** if \`enableNodes=true\`, edit \`nodes[0].instructions\`. If legacy/no nodes, use \`vg_instructions\`.
3. **Large prompt edits:** prefer \`patch_agent_prompt\` (exact \`old_string\` → \`new_string\`, Cursor StrReplace style) over rewriting the whole prompt via \`update_agent\`.
4. Prefer \`create_agent_from_template\` for new chat+voice agents (not raw \`create_agent\` unless advanced control is needed).
5. \`ownerID\` / workspace ID is read-only — never try to PATCH it.
6. \`search_agents\` may 404 on some workspaces — use \`list_agents\` or \`get_agent\` instead.

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

- \`list_conversations\` is **cursor-paginated** (max 20/page). For page 2+ pass \`cursor\` from \`nextCursor\` — never bump \`page\` alone.
- List rows are thin (often no \`summary\` / \`capturedVariables\`). For audits: collect IDs → \`get_conversations_bulk\` (max 50 IDs/call) → analyze \`summary\` / vars.
- \`query_conversations\` is an MCP-side filter (list scan + bulk get), not SQL. Bound with \`maxScan\`. Prefer \`get_conversations_bulk\` when you already have IDs.
- Usage across many agents: \`get_agent_usage_bulk\` (max 20). KB audits: \`get_kb_docs_bulk\` (max 30).

## Knowledge base & testing

- **Adding many website pages:** \`create_kb_from_urls\` (max 50 URLs). KB router scrapes (\`scrapeContent=true\`). Do **not** web-fetch / \`scrape_url\` then paste into \`create_kb_doc\`.
- Whole site: \`create_kb_doc\` with \`sourceType=sitemap\`, \`sitemapUrl\`, \`maxPages\`, \`scrapeContent=true\`.
- Single/manual: \`create_kb_doc\` (\`url\` + \`urls[]\` + scrape, or \`doc\` for raw text you already have).
- \`refreshRate\` is \`3d\` | \`7d\` | \`never\` (not hourly).
- Scraping is **async** — create returns quickly; poll \`list_kb_docs\` / \`get_kb_doc\` for status.
- Audits: \`get_kb_docs_bulk\` (max 30). Test chats: \`interact_with_agent\` with \`isTest: true\`.
- **Surgical KB edits:** for large docs use \`patch_kb_doc\` (\`old_string\` / \`new_string\`, same semantics as Cursor StrReplace) instead of rewriting full \`content\` via \`update_kb_doc\`.
- **Validate links/images** (status 200/404, broken CDN, logo URLs): \`scrape_url\` with \`mode: "check"\` + \`urls: [...]\` (default mode). Fast ping — not a full scrape.
- Branding extract (colours/favicon/page text): \`scrape_url\` with \`mode: "scrape"\` + one \`url\`. For KB ingest, always use KB router URL/sitemap tools — not scrape.

---

## Quick decision tree

- **"I created an agent / let me try it / demo link"** → use \`prototypeUrl\` from the tool result, or build \`https://app.convocore.ai/{eu|na}/prototype/{agentId}\` — never \`/agents/\`.
- **"Add chatbot to my site" / "deploy to website" / "where is the code"** → \`get_website_embed_code\` (or \`list_agents\` → then embed tool) → paste \`html\` in reply.
- **"Analyze / score / audit conversations"** → \`list_conversations\` (cursor) → \`get_conversations_bulk\` (chunks of 50) or \`query_conversations\`.
- **"Voice button in my React app"** → \`@tixae-labs/web-sdk\` + agentId + region.
- **"Change widget colors / button look"** → CSS tools (\`get_widget_css_styling_guide\` → \`update_agent_custom_css\`).
- **"Enable cards / buttons / forms / invoice on the agent"** → \`update_agent\` with \`vg_enableUIEngine\` + \`vg_enableUIEngineForms\` / \`vg_enableUIEngineInvoice\` / \`vg_enableUIEngineCalendarBooking\` + optional \`vg_uiEngineChannelConfig\`. Then \`get_ui_engine_spec\` for payloads.
- **"Change what the agent says"** → for small/full rewrites \`update_agent\`; for large prompts \`patch_agent_prompt\` (\`old_string\`/\`new_string\`) → \`nodes[0].instructions\` or \`proactiveMessage\`.
- **"Tweak one section of a big KB doc"** → \`get_kb_doc\` → \`patch_kb_doc\`.
- **"Fix agent not answering in Arabic / wrong language"** → check \`lang\`, voice \`language\`, and main prompt — not the embed script alone.

**Slash prompt:** \`integrate_website_widget\` (pass \`agentId\` + optional \`mode\`) returns a copy-paste embed snippet with real IDs filled in.
`;
