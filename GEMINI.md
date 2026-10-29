# Convocore

The `convocore` MCP server manages the user's own Convocore workspace (AI agents for web chat, WhatsApp,
Instagram, Messenger, SMS, email and phone). The first tool call opens a browser to sign in with a Convocore
account and pick a workspace; Gemini CLI stores the token afterwards.

- Start with `list_agents` to find the user's agents.
- New agent for a business: `create_agent_from_template` with the business website.
- Ask before anything that deletes data, sends a message or places a call.
- Plans, phone numbers and payments are managed on the Convocore dashboard (https://convocore.ai).

Docs: https://convocore.ai/blog/convocore-mcp-setup-guide · Support: support@convocore.ai
