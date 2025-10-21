# ConvoCore MCP Server - Quick Start

Get up and running in 5 minutes! 🚀

## What You Need

1. **ConvoCore Credentials**:
   - `CONVOCORE_API_KEY` - Your API authentication key
   - `WORKSPACE_SECRET` - Your workspace identifier

2. **Tools**:
   - Node.js 18+
   - pnpm (or npm)
   - Claude Desktop

## 3-Step Setup

### Step 1: Install & Build (2 minutes)

```bash
# Navigate to project directory
cd /Users/Apple/Documents/GitHub/convocore-mcp

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Verify setup
node verify.js
```

You should see all green checkmarks! ✅

### Step 2: Configure Claude Desktop (2 minutes)

1. Get the full path to your project:
```bash
pwd
# Example output: /Users/Apple/Documents/GitHub/convocore-mcp
```

2. Open Claude Desktop config:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add this configuration (replace with your actual values):

```json
{
  "mcpServers": {
    "convocore": {
      "command": "node",
      "args": ["/Users/Apple/Documents/GitHub/convocore-mcp/dist/index.js"],
      "env": {
        "CONVOCORE_API_KEY": "your_actual_api_key_here",
        "WORKSPACE_SECRET": "your_actual_workspace_secret_here",
        "CONVOCORE_API_REGION": "eu-gcp"
      }
    }
  }
}
```

**Important**: 
- Use the FULL absolute path from Step 1
- Replace the placeholder credentials with your actual ConvoCore credentials
- Choose `eu-gcp` or `na-gcp` based on your region

### Step 3: Test It (1 minute)

1. **Restart Claude Desktop** completely (Quit and reopen)

2. In Claude, type:
   > "What ConvoCore tools are available?"

3. You should see 6 tools:
   - `create_agent`
   - `get_agent`
   - `update_agent`
   - `delete_agent`
   - `list_agents`
   - `search_agents`

## Your First Agent

Now try creating your first agent:

```
Create a new ConvoCore agent called "My First Bot" with description "Testing the MCP server"
```

Claude will use the `create_agent` tool and return the new agent's details including its ID!

## What's Next?

- **See Examples**: Check out `EXAMPLES.md` for detailed usage examples
- **Full Documentation**: Read `README.md` for complete documentation
- **Troubleshooting**: Check `SETUP.md` if you run into issues

## Common Issues

### Tools not appearing in Claude?
- Make sure you **completely quit** and reopened Claude Desktop (not just closed the window)
- Check that the path in your config is absolute and correct
- Verify the config file is valid JSON (no trailing commas)

### "CONVOCORE_API_KEY environment variable is required"?
- Double-check your credentials in the Claude Desktop config
- Make sure there are no extra spaces in the values
- Verify you're using the correct key names (case-sensitive)

### Build errors?
- Make sure you have Node.js 18 or higher: `node --version`
- Try removing node_modules and reinstalling: `rm -rf node_modules && pnpm install`

## Project Structure

```
convocore-mcp/
├── src/                  # TypeScript source code
│   ├── index.ts         # Main MCP server
│   ├── convocore-client.ts  # API client
│   ├── config.ts        # Configuration
│   └── types.ts         # Type definitions
├── dist/                # Compiled JavaScript (generated)
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── README.md            # Full documentation
├── SETUP.md             # Detailed setup guide
├── EXAMPLES.md          # Usage examples
└── QUICKSTART.md        # This file
```

## Get Your Credentials

### Where to find CONVOCORE_API_KEY:
1. Log into ConvoCore Dashboard
2. Go to Settings → API Keys
3. Copy your API key

### Where to find WORKSPACE_SECRET:
1. Log into ConvoCore Dashboard
2. Go to Workspace Settings
3. Find your Workspace ID/Secret

## Need Help?

1. Run the verification: `node verify.js`
2. Check the logs in Claude Desktop (Help → View Logs)
3. Review the detailed `SETUP.md` guide
4. Check the `EXAMPLES.md` for usage patterns

---

**That's it!** You're now ready to manage ConvoCore agents through Claude! 🎉

