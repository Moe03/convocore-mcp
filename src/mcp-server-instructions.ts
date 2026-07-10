/**
 * Global MCP server instructions returned in the initialize response.
 * Hosts (Cursor, Claude, etc.) may inject this into the system prompt.
 * Keep comprehensive but scannable — do not duplicate entire tool schemas here.
 */

export type WidgetEmbedMode = 'popup-bottom-right' | 'popup-bottom-left' | 'full-width' | 'modal';

export function widgetRegionFromApiRegion(apiRegion: 'eu-gcp' | 'na-gcp'): 'eu' | 'na' {
  return apiRegion === 'na-gcp' ? 'na' : 'eu';
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

export const MCP_SERVER_INSTRUCTIONS = `# ConvoCore MCP — usage guide

You manage ConvoCore AI agents via this MCP. Follow these rules so integrations work without mistakes.

## CRITICAL — "deploy to website" / "embed code" / "widget script"

When the user asks how to deploy, embed, or add their agent to a website (or asks "where is the code"):
1. **Call \`get_website_embed_code\`** (with their agentId + mode) — or \`list_agents\` first if you don't know the agent ID.
2. **Paste the returned HTML/JS snippet** in your reply. That IS the deployment code.
3. **Do NOT** tell them to go to the dashboard Channels tab, Deployment tab, or platform docs instead of giving code.
4. **Do NOT** answer with only high-level options (popup vs embedded) without the actual script.
5. Mention Shopify/WordPress/Wix only as a one-liner: "paste this snippet before \`</body>\`" — the snippet works on any platform.

## Before you change an agent

1. Call \`get_agent\` with the agent ID when you are unsure of current config.
2. **Main prompt location:** if \`enableNodes=true\`, edit \`nodes[0].instructions\`. If legacy/no nodes, use \`vg_instructions\`.
3. Prefer \`create_agent_from_template\` for new chat+voice agents (not raw \`create_agent\` unless advanced control is needed).
4. \`ownerID\` / workspace ID is read-only — never try to PATCH it.
5. \`search_agents\` may 404 on some workspaces — use \`list_agents\` or \`get_agent\` instead.

## Interact / UI Engine agents

- \`interact_with_agent\` runs a **real** LLM turn (uses credits).
- If \`uiEngineEnabled: true\`, read **\`uiEngineSummary\`** or \`uiEngineSnapshot\` — \`assistantText\` is often empty.
- Call \`get_ui_engine_spec\` before validating or building UI-Engine output.

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

## Knowledge base & testing

- KB: \`create_kb_doc\`, \`list_kb_docs\`, \`update_kb_doc\`; content may appear under \`chunks\` in \`get_kb_doc\`.
- Test agent behavior: \`interact_with_agent\` with \`isTest: true\`; reuse \`convoId\` for multi-turn tests.
- Scrape a site first: \`scrape_url\` → then \`create_agent_from_template\` or KB URL doc.

---

## Quick decision tree

- **"Add chatbot to my site" / "deploy to website" / "where is the code"** → \`get_website_embed_code\` (or \`list_agents\` → then embed tool) → paste \`html\` in reply.
- **"Voice button in my React app"** → \`@tixae-labs/web-sdk\` + agentId + region.
- **"Change widget colors / button look"** → CSS tools (\`get_widget_css_styling_guide\` → \`update_agent_custom_css\`).
- **"Change what the agent says"** → \`update_agent\` → \`nodes[0].instructions\` or \`proactiveMessage\`.
- **"Fix agent not answering in Arabic / wrong language"** → check \`lang\`, voice \`language\`, and main prompt — not the embed script alone.

**Slash prompt:** \`integrate_website_widget\` (pass \`agentId\` + optional \`mode\`) returns a copy-paste embed snippet with real IDs filled in.
`;
