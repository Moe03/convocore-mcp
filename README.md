# ConvoCore MCP Server

A Model Context Protocol (MCP) server for managing ConvoCore AI agents. This server provides full CRUD operations for ConvoCore agents through the MCP protocol.

## Features

- ✨ **Create Agents**: Create new AI agents with custom configurations
- 📖 **Get Agent**: Retrieve detailed information about specific agents
- ✏️ **Update Agents**: Modify existing agent configurations
- 🗑️ **Delete Agents**: Remove agents permanently
- 📋 **List Agents**: Get paginated lists of all agents in an organization
- 🔍 **Search Agents**: Search for agents using queries

## Prerequisites

- Node.js 18+ 
- pnpm (or npm)
- ConvoCore API Key
- Workspace Secret

## Installation

1. Clone the repository:
```bash
cd convocore-mcp
```

2. Install dependencies:
```bash
pnpm install
```

3. Create your `.env` file:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```env
CONVOCORE_API_KEY=your_api_key_here
WORKSPACE_SECRET=your_workspace_secret_here
CONVOCORE_API_REGION=eu-gcp  # or na-gcp
```

5. Build the project:
```bash
pnpm run build
```

## Usage

### Running the Server

The server uses stdio transport for MCP communication:

```bash
node dist/index.js
```

### Configuration with Claude Desktop

Add this to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "convocore": {
      "command": "node",
      "args": ["/absolute/path/to/convocore-mcp/dist/index.js"],
      "env": {
        "CONVOCORE_API_KEY": "your_api_key_here",
        "WORKSPACE_SECRET": "your_workspace_secret_here",
        "CONVOCORE_API_REGION": "eu-gcp"
      }
    }
  }
}
```

## Available Tools

### 1. create_agent

Create a new ConvoCore AI agent.

**Parameters:**
- `title` (required): The title of the agent
- `description` (optional): A brief description
- `theme` (optional): Visual theme (e.g., 'blue-light')
- `disabled` (optional): Whether the agent is disabled
- `light` (optional): Enable light mode (no chat history)
- `enableVertex` (optional): Enable Vertex AI
- `autoOpenWidget` (optional): Auto-open widget on load
- `voiceConfig` (optional): Voice configuration object
- `additionalConfig` (optional): Additional configuration fields

**Example:**
```json
{
  "title": "Customer Support Agent",
  "description": "Handles customer inquiries",
  "theme": "blue-light",
  "disabled": false
}
```

### 2. get_agent

Retrieve details of a specific agent.

**Parameters:**
- `agentId` (required): The unique identifier of the agent

**Example:**
```json
{
  "agentId": "agent_123456"
}
```

### 3. update_agent

Update an existing agent's configuration.

**Parameters:**
- `agentId` (required): The agent ID to update
- All other parameters from `create_agent` are optional

**Example:**
```json
{
  "agentId": "agent_123456",
  "title": "Updated Customer Support Agent",
  "disabled": true
}
```

### 4. delete_agent

Delete an agent permanently.

**Parameters:**
- `agentId` (required): The unique identifier of the agent to delete

**Example:**
```json
{
  "agentId": "agent_123456"
}
```

### 5. list_agents

List all agents for an organization with pagination.

**Parameters:**
- `orgId` (required): The organization ID
- `page` (optional): Page number (default: 1)
- `pageSize` (optional): Agents per page (default: 20)

**Example:**
```json
{
  "orgId": "org_789",
  "page": 1,
  "pageSize": 20
}
```

### 6. search_agents

Search for agents using a query.

**Parameters:**
- `query` (required): Search query string

**Example:**
```json
{
  "query": "customer support"
}
```

## Development

### Build

```bash
pnpm run build
```

### Watch Mode

```bash
pnpm run dev
```

## API Regions

ConvoCore has two API regions:
- `eu-gcp`: European region (default) - `https://eu-gcp-api.vg-stuff.com/v3`
- `na-gcp`: North American region - `https://na-gcp-api.vg-stuff.com/v3`

Set the `CONVOCORE_API_REGION` environment variable to choose your region.

## Project Structure

```
convocore-mcp/
├── src/
│   ├── index.ts              # Main MCP server
│   ├── convocore-client.ts   # API client
│   ├── config.ts             # Configuration management
│   └── types.ts              # TypeScript type definitions
├── dist/                     # Compiled JavaScript output
├── package.json              # Project dependencies
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Technologies Used

- **TypeScript**: Modern type-safe development
- **MCP SDK**: Model Context Protocol implementation
- **Zod**: Runtime type validation
- **Node.js**: JavaScript runtime

## Error Handling

The server includes comprehensive error handling:
- Invalid arguments are caught and reported with detailed error messages
- API errors are properly propagated with meaningful messages
- Configuration errors are caught at startup

## License

MIT

## Support

For issues or questions about:
- **This MCP server**: Create an issue in this repository
- **ConvoCore API**: Contact ConvoCore support

