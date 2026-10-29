# Proposal: Convocore sign-in on the hosted OAuth authorize page

Status: **proposal, not built.** Needs a go-ahead because it touches three places: this repo (hosted server), the
dashboard (custom-vf-nextjs) and the backend (vg-docker).

## The problem

A user who adds the bare `https://mcp.convocore.ai/mcp` from the Claude Connectors Directory has no secret in the
URL. `handleAuthorize` in `src/hosted-oauth.ts` then shows `authorizeFormHtml`: "Paste your workspace secret".
That is the path every directory user takes, and it is a weak review story:

- The user has to leave Claude, find **Account → API Secrets**, copy a root credential and paste it into a page.
- The token Claude stores is that secret itself (`issueTokens` returns `access_token: workspaceSecret`, 10-year
  expiry). Nothing ties a connection to a person, and revoking means rotating a secret other things use.
- Anthropic's guide expects OAuth to sign the user in to the service, not to collect an API key.

## Other things found while reviewing `hosted-oauth.ts`

1. **Unknown `client_id` skips the redirect check.** `if (client && !client.redirectUris.includes(redirectUri))`
   only runs for registered clients. Registrations live in an in-memory `Map`, so after any restart (or with a
   made-up `client_id`) any `redirect_uri` is accepted. Combined with the paste form, a link on
   `mcp.convocore.ai` can send the pasted secret's auth code to an attacker's URL; the attacker holds the PKCE
   verifier, so they can redeem it for the secret. Fix independently of the proposal: when the client is unknown,
   allow only the Claude / loopback callbacks that the `allowed` branch already lists.
2. **Codes, clients and refresh tokens are in memory.** A redeploy drops them. Access tokens last 10 years so
   users rarely notice, but a refresh after a restart fails with `invalid_grant`. Fine for one container; breaks
   with more than one replica.
3. `connectOnlyHtml` auto-submits when the secret is already in the connector path (`/t/<secret>/mcp`). That is
   the current dashboard install flow and stays as it is.

## Proposed flow

```
Claude ──▶ mcp.convocore.ai/oauth/authorize (no secret)
             │ store pending request {clientId, redirectUri, PKCE, state} → requestId (10 min)
             ▼ 302
        convocore.ai/mcp/authorize?request=<requestId>          (new Next.js page, dashboard)
             │ not signed in → normal Convocore login, then back here
             │ workspace picker: the workspaces this account can admin (same list as the dashboard switcher)
             │ "Allow Claude to access <workspace>" → Allow
             ▼ POST mcpOAuthApprove {requestId, workspaceId}     (new backend procedure, Firebase-signed)
        backend: check admin of workspaceId, create/reuse an extra API secret named
                 "Claude connector" (same store as createApiSecret), save one-time grant
                 {grant → secretId, region, requestId} for 2 min, return grant
             ▼ 302
        mcp.convocore.ai/oauth/callback?request=<requestId>&grant=<grant>
             │ POST mcpOAuthRedeem {grant, requestId} with MCP_OAUTH_SERVER_KEY (server to server)
             │ → {secret, region}; issue the auth code exactly as today
             ▼ 302
        Claude redirect_uri?code=…&state=…
```

What this gives us:

- Directory users sign in with their Convocore account; no secret is ever shown or pasted.
- Each connection is a **named, revocable** API secret, listed in Account → API Secrets. Revoking it disconnects
  Claude only. The MCP server and the API keep working unchanged, because the access token is still a workspace
  secret (just a dedicated one).
- Admin-only, using the existing `isWorkspaceAdmin` check, so whitelabel clients cannot mint agency secrets.

### Backend (vg-docker, `workspace-routers.ts` next to `createApiSecret`)

| Procedure | Auth | Input | Output |
|---|---|---|---|
| `mcpOAuthWorkspaces` | Firebase ID token | none | `[{ workspaceId, name, region, plan, mcpAllowed }]` (plan gate: Business+) |
| `mcpOAuthApprove` | Firebase ID token + `isWorkspaceAdmin` | `{ requestId, workspaceId, clientName? }` | `{ grant }` |
| `mcpOAuthRedeem` | `MCP_OAUTH_SERVER_KEY` header (new env on the hosted MCP + backend) | `{ grant, requestId }` | `{ secret, region }`, single use |

Notes:
- `MAX_EXTRA_WORKSPACE_SECRETS = 10`. Reuse the existing "Claude connector" secret when there is one (or replace
  the oldest connector secret) so reconnecting doesn't fill the slots.
- Grants in Firestore with a TTL (2 min) so both NA and EU backends can redeem; region comes from the workspace.
- Log approvals in the workspace Logs (who, which client, when).

### Hosted MCP (this repo)

- `handleAuthorize`: with no secret and not gray-label, store the pending request and 302 to the dashboard page
  instead of rendering `authorizeFormHtml`. Keep the paste form as a "Use a workspace secret instead" link for
  self-hosters.
- New `GET /oauth/callback`: redeem the grant, then `issueAuthCode` + `redirectWithCode` as today.
- Fix item 1 above at the same time.

### Dashboard (custom-vf-nextjs)

- New page `src/app/mcp/authorize/page.tsx`: login gate, workspace picker, Allow / Cancel. Cancel sends the user
  back to Claude's `redirect_uri` with `error=access_denied` (through the MCP server, which holds the URI).

Rough size: 1–2 days including headless tests of the full redirect chain.
