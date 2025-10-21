# Quick Setup Guide

## Step 1: Install Dependencies

```bash
pnpm install
```

## Step 2: Build the Project

```bash
pnpm run build
```

## Step 3: Configure Environment Variables

You have two options:

### Option A: Using .env file (for testing)

Copy the example file:
```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
```env
CONVOCORE_API_KEY=your_actual_api_key
WORKSPACE_SECRET=your_actual_workspace_secret
CONVOCORE_API_REGION=eu-gcp
```

### Option B: Using Claude Desktop config (recommended)

1. Get the absolute path to this project:
```bash
pwd
```

2. Open Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the MCP server configuration (replace paths and credentials):

```json
{
  "mcpServers": {
    "convocore": {
      "command": "node",
      "args": ["/absolute/path/to/convocore-mcp/dist/index.js"],
      "env": {
        "CONVOCORE_API_KEY": "your_actual_api_key",
        "WORKSPACE_SECRET": "your_actual_workspace_secret",
        "CONVOCORE_API_REGION": "eu-gcp"
      }
    }
  }
}
```

4. Restart Claude Desktop

## Step 4: Verify Installation

After restarting Claude Desktop, you should see the ConvoCore tools available. Try asking Claude:

> "List all the available ConvoCore tools"

or

> "Create a new ConvoCore agent called 'Test Agent'"

## Getting Your Credentials

### CONVOCORE_API_KEY
This is your ConvoCore API authentication key. You can get it from:
- ConvoCore Dashboard → Settings → API Keys

### WORKSPACE_SECRET
This is your workspace identifier. You can find it:
- ConvoCore Dashboard → Workspace Settings → Secret/ID

### CONVOCORE_API_REGION
Choose based on your location:
- `eu-gcp` - European region (default)
- `na-gcp` - North American region

## Testing the Server Manually

You can test the server directly via command line:

```bash
# Set environment variables
export CONVOCORE_API_KEY=your_api_key
export WORKSPACE_SECRET=your_workspace_secret
export CONVOCORE_API_REGION=eu-gcp

# Run the server
node dist/index.js
```

The server communicates via stdio, so you won't see much output unless you send it MCP protocol messages.

## Troubleshooting

### "Module not found" errors
Make sure you've run `pnpm run build` after installation.

### "CONVOCORE_API_KEY environment variable is required"
Check that your environment variables are properly set in the Claude Desktop config.

### API connection errors
- Verify your API key is valid
- Check that you're using the correct region
- Ensure your network allows connections to the ConvoCore API

### Tools not showing up in Claude
- Restart Claude Desktop completely
- Check the Claude Desktop logs for errors
- Verify the path to `dist/index.js` is correct and absolute

## Development

### Watch mode for development
```bash
pnpm run dev
```

This will recompile TypeScript files automatically when you make changes.

### Adding new tools
1. Add the tool definition in `src/index.ts` (tools array)
2. Add the handler in the switch statement
3. Create any necessary schemas with Zod
4. Add API methods to `src/convocore-client.ts` if needed
5. Rebuild: `pnpm run build`
6. Restart Claude Desktop

## Support

- For MCP server issues: Check this repository
- For ConvoCore API issues: Contact ConvoCore support
- For Claude Desktop issues: Check Anthropic's documentation

