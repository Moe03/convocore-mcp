# Claude Connectors Directory submission

Everything to paste into the developer portal: [claude.ai/directory/manage](https://claude.ai/directory/manage) →
**Submit new** → **MCP connector**. Field limits come from Anthropic's guide
(https://claude.com/docs/connectors/building/submission). Any paid Claude plan can submit. After submitting, the
listing is auto-scanned and published as a **Community** connector; escalations go to `mcp-review@anthropic.com`.

## Before submitting

- [x] Every tool has `annotations.title` plus `readOnlyHint` / `destructiveHint`
      (`test/tool-annotations.test.mjs` enforces it). **Needs a redeploy of the hosted server** before the portal's
      Tools step will see the titles.
- [ ] Directory users connect to the bare URL, so today they get the "paste your workspace secret" form. Strongly
      recommended to ship [the account sign-in flow](oauth-account-login-proposal.md) first; reviewers expect
      OAuth to sign in to the service, not collect an API key.
- [ ] Fix the unknown-`client_id` redirect check in `src/hosted-oauth.ts` (see the proposal, item 1).
- [ ] Test every tool from Claude as a custom connector (step 8 asks you to confirm this).
- [ ] Reviewer test account populated (step 8).
- [ ] Square icon (see step 3).

## 1. Connection

| Field | Value |
|---|---|
| Server URL | `https://mcp.convocore.ai/mcp` |
| Users connect to different URLs | **No.** Do not pick "Multiple URLs" / "URL pattern" for the `/t/<secret>/mcp` dashboard links: those options can only publish once the listing is Verified. Directory users use the one URL; dashboard install links keep working outside the directory. |

Transport is Streamable HTTP; OAuth discovery is at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`, with dynamic client registration at `/oauth/register`.

## 2. Tools

Synced from the server. The hosted catalog hides the local-machine tools (`run_command`, `read_*`, `inspect_file`,
`import_file_to_kb`), so the portal sees ~138 tools. Read-only vs write grouping comes from the annotations.

Tools that both read and change data depending on their `action` argument. All are annotated
`destructiveHint: true` because at least one action deletes, overwrites or has a real-world effect; mention this
if a reviewer asks why a tool with a read action is listed as write:

| Tool | Read-only actions | Destructive actions |
|---|---|---|
| `agency_branding` | `get` | `update_branding`, `update_login_page` (overwrite) |
| `integrations_write` | `zoho_test_lookup` | `remove_from_agent`, `*_disconnect`, `zoho_remove_agent` |
| `integrations_test` | `inspect` | `run` (real calls through the agent's integrations) |
| `code_tools` | `validate` | `run`, `save` |
| `sms_numbers_write` | none (`test_send` sends a real SMS) | `remove`, `release_rental` |

`agent_gallery_templates` (`list` / `create`) was changed to non-destructive: creating an agent removes nothing.
A later clean-up could split these into `*_read` / `*_write` pairs like the rest of the catalog.

## 3. Listing

**Server name** (≤100): `Convocore`

**One-liner** (≤200):
> Build, edit and run Convocore AI chat and voice agents from Claude: prompts, knowledge base, conversations,
> leads, calls, WhatsApp and analytics.

**Description** (≤2,000):
> Convocore is a platform for AI agents that answer customers on web chat, WhatsApp, Instagram, Messenger, SMS,
> email and phone. This connector gives Claude the same controls as the Convocore dashboard, so you can manage
> your workspace in conversation instead of clicking through it.
>
> Ask Claude to create an agent for a business from its website, rewrite or patch an agent's prompt, add pages
> and files to its knowledge base, attach HTTP tools and variables, and test the agent with a live chat turn
> before going live. Review conversations and transcripts, add review notes, summarize what customers asked
> about, and export data. Work with leads, lead groups and contacts; run outbound call and WhatsApp campaigns;
> check call logs, usage, credits and custom metrics. Agencies can also manage client accounts, folders and
> whitelabel branding.
>
> Reads are marked read-only. Anything that deletes, overwrites, sends a message, places a call or spends
> credits is marked destructive so Claude asks before running it. The connector uses Convocore's own API: data
> stays in your Convocore workspace and is subject to Convocore's privacy policy.
>
> Requires a Convocore account on the Business plan or higher (Business, White Label or White Label Elite).

**Categories** (1–5, pick from the portal's list): customer support, sales & marketing, productivity,
communication, developer tools (whichever of these the portal offers).

| Field | Value |
|---|---|
| Documentation URL | https://convocore.ai/blog/convocore-mcp-setup-guide |
| Privacy policy URL | https://convocore.ai/legal/privacy-policy (`/privacy` is a 404; this is the live page) |
| Terms (if asked) | https://convocore.ai/legal/tos |
| Support contact | support@convocore.ai |
| Icon | **TODO:** square PNG of the current Convocore mark (≥512 px, transparent or solid background). `custom-vf-nextjs/public/sq_logo.png` is the old "glow" mark; don't use it. |
| URL slug | `convocore` (**permanent once published**) |

The setup guide currently tells users to paste a workspace secret if a Convocore page asks for one. Update that
section if the sign-in flow ships.

## 4. Use cases

**Primary use cases**
1. Build a customer-service agent for a business from its website and brand, then test it in chat.
2. Edit an existing agent: prompt changes, knowledge-base updates, tools, variables, widget styling.
3. Review conversations: find what customers asked, read transcripts, add notes, summarize, export.
4. Leads and outreach: import leads, build lead groups, run call / WhatsApp campaigns, read call logs.
5. Reporting: usage, credits, analytics and custom metrics per agent or across the workspace.
6. Agencies: manage client accounts, folders and whitelabel branding.

**What users need first:** a Convocore account on the Business plan or higher. Channels (WhatsApp, phone numbers,
Meta pages, email domains) are connected in the Convocore dashboard; the connector can create the connect links.

**Reads or writes:** both.

## 5. Company

| Field | Value |
|---|---|
| Company name | VECTOR WIZARDS LLC (Convocore) |
| Address (if asked) | 131 Continental Dr Suite 305, Newark DE 19713 |
| Website | https://convocore.ai |
| Primary contact | **TODO:** name + email for review updates |

## 6. Authentication

- Authentication requirement: **Required**.
- Method: **OAuth 2.0** with dynamic client registration (Claude registers itself; leave client ID / secret
  empty, don't ask Anthropic to hold a client).
- Today the authorize page asks for the workspace secret when none is in the URL. With the proposed flow it
  becomes a Convocore sign-in plus a workspace picker.

## 7. Data handling

| Question | Answer |
|---|---|
| Underlying API | **Our own** (Convocore public REST API + `/interact` WebSocket, same as the dashboard). |
| Personal health data | No (not designed for it; customers' own conversations could contain anything they type). |
| Sponsored content | No. |

Notes for the data questions: tool results are returned to Claude and not stored by the MCP server. Usage telemetry
records only tool name, success, duration, the `action` argument and the MCP client name, never arguments or
results (`src/telemetry.ts`), and is sent to the caller's own Convocore region.

## 8. Test & launch

**TODO, fill in before submitting** (only reviewers see this):

```
1. In Claude: Settings → Connectors → Add custom connector → https://mcp.convocore.ai/mcp
   (or install from the directory listing once it is live).
2. When the Convocore page opens:
   - [with sign-in flow] sign in as <reviewer email> / <password>, pick workspace "<name>", click Allow.
   - [today] paste this workspace secret: <dedicated reviewer secret from Account → API Secrets>, click Connect.
3. Try: "List my Convocore agents", "Show the last 5 conversations of <agent>",
   "Add the page <url> to <agent>'s knowledge base", "Chat with <agent>: what are your opening hours?"
```

Reviewer account must be **fully populated**: Business plan, 2–3 agents with prompts and KB docs, real-looking
conversations, leads and a lead group, a custom metric, usage history. Use synthetic data only. Give it a
dedicated API secret named "Anthropic review" so it can be revoked after review. Avoid giving it a connected
phone number / WhatsApp number with credit, since `start_outbound_call`, `send_sms` and campaigns act for real.

Confirm "I've run every tool" only after running them as a custom connector in Claude or through MCP Inspector.

## 9. Compliance (all seven required)

| Acknowledgement | Our position |
|---|---|
| Directory guidelines (Software Directory Terms + Policy) | Agree. |
| First-party API usage | The connector calls only Convocore's own API. |
| Financial transactions | **Read carefully.** `buy_twilio_number` buys a phone number, `sms_numbers_write assign_rental` rents one, `workspace_write set_auto_billing` turns on auto top-up, and calls / SMS / campaigns spend credits. All are annotated destructive. If the policy forbids connectors that move money, consider hiding these from the hosted catalog (like `HOST_LOCAL_TOOLS`) before submitting. |
| AI media generation | No image/video generation. Voice tools only list TTS voices and preview URLs. |
| Prompt injection | Tool results contain customer-written text (conversations, leads, scraped pages). Tool descriptions do not instruct Claude to act on content from results. |
| Conversation data collection | The server does not collect or store Claude conversations; telemetry excludes arguments and results. |
| Public documentation | https://convocore.ai/blog/convocore-mcp-setup-guide and https://github.com/Moe03/convocore-mcp |

## 10. Review and submit

Check the portal's quality warnings (short answers get flagged and shared with reviewers), then submit. Status and
reviewer feedback show up in the portal.
