# ConvoCore MCP Server 🚀

A comprehensive Model Context Protocol (MCP) server for ConvoCore AI agents, providing complete CRUD operations for agents, conversations, and knowledge base.

[![Docker Hub](https://img.shields.io/badge/docker-moe003%2Fconvocore--mcp-blue)](https://hub.docker.com/r/moe003/convocore-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🎯 Features

### Complete Agent Management (9 Tools)
- ✅ Create, Read, Update, Delete agents
- ✅ List all agents (no parameters needed!)
- ✅ Search agents with filters
- ✅ Export/Import agent templates
- ✅ Get agent usage statistics

### Complete Conversation Management (8 Tools)
- ✅ List, Create, Update, Delete conversations
- ✅ Get conversation details
- ✅ Export conversations (JSON/CSV)
- ✅ Assign conversations to users
- ✅ Pagination support

### Complete Knowledge Base Management (6 Tools)
- ✅ Create, Read, Update, Delete KB documents
- ✅ List all KB docs with pagination
- ✅ Get KB statistics
- ✅ Support for docs, URLs, and sitemaps
- ✅ Auto-refresh capabilities
- ✅ Tag organization

## 📋 Prerequisites

- **WORKSPACE_SECRET**: Your ConvoCore workspace secret (Bearer token)
- **CONVOCORE_API_REGION**: Either `eu-gcp` (default) or `na-gcp`
- **Docker**: Required for Docker deployment (must be installed and running)

## 🚀 Quick Start

### Option 1: Docker (Recommended)

> **⚠️ Prerequisites:** Make sure [Docker Desktop](https://www.docker.com/products/docker-desktop/) is installed and running before proceeding.

```bash
docker run -d \
  --name convocore-mcp \
  -e WORKSPACE_SECRET="your_workspace_secret_here" \
  -e CONVOCORE_API_REGION="eu-gcp" \
  moe003/convocore-mcp:latest
```

### Option 2: Local Node.js

1. **Clone and install:**
```bash
git clone https://github.com/moe003/convocore-mcp.git
cd convocore-mcp
pnpm install
pnpm run build
```

2. **Set environment variables:**
```bash
export WORKSPACE_SECRET="your_workspace_secret_here"
export CONVOCORE_API_REGION="eu-gcp"
```

3. **Run:**
```bash
node dist/index.js
```

## 🔧 Claude Desktop Configuration

> **⚠️ Docker Users:** Ensure Docker Desktop is installed and running before configuring Claude Desktop.
> 
> **💡 Tip:** Pull the Docker image first to avoid timeouts:
> ```bash
> docker pull moe003/convocore-mcp:latest
> ```
> This prevents Claude Desktop from timing out while downloading the image on first use.

Add to your `claude_desktop_config.json`:

### Using Docker:
```json
{
  "mcpServers": {
    "convocore": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "WORKSPACE_SECRET=your_workspace_secret_here",
        "-e", "CONVOCORE_API_REGION=eu-gcp",
        "moe003/convocore-mcp:latest"
      ]
    }
  }
}
```

### Using Local Node.js:
```json
{
  "mcpServers": {
    "convocore": {
      "command": "node",
      "args": ["/absolute/path/to/convocore-mcp/dist/index.js"],
      "env": {
        "WORKSPACE_SECRET": "your_workspace_secret_here",
        "CONVOCORE_API_REGION": "eu-gcp"
      }
    }
  }
}
```

**Config file location:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

## 📚 Available Tools (23 Total)

### Agent Tools (9)

#### 1. `create_agent`
Create a new ConvoCore AI agent.

**Important:** ConvoCore uses "nodes" for advanced AI. The **FIRST node** (`nodes[0]`) contains the **main prompt/instructions**.

```javascript
// Example
{
  "title": "Customer Support Bot",
  "description": "Handles customer inquiries",
  "nodes": [
    {
      "name": "Main",
      "instructions": "You are a helpful customer support agent..."
    }
  ]
}
```

#### 2. `get_agent`
Get details of a specific agent.

**Note:** The agent's main prompt is in `nodes[0].instructions`.

```javascript
{
  "agentId": "agent_123"
}
```

#### 3. `update_agent`
Update an existing agent.

**Critical:** To change the agent's main prompt, update `nodes[0].instructions`.

```javascript
{
  "agentId": "agent_123",
  "title": "New Title",
  "nodes": [
    {
      "instructions": "Updated prompt here..."
    }
  ]
}
```

#### 4. `delete_agent`
Delete an agent permanently.

```javascript
{
  "agentId": "agent_123"
}
```

#### 5. `list_agents`
List all agents (no parameters needed!).

```javascript
{}
```

#### 6. `search_agents`
Search agents with filters.

```javascript
{
  "workspaceId": "workspace_123",
  "search": "support",
  "page": 1,
  "limit": 50,
  "sortBy": "newest",
  "starredOnly": false
}
```

#### 7. `export_agent`
Export an agent template.

```javascript
{
  "agentId": "agent_123"
}
```

#### 8. `import_agent`
Import an agent from a template.

```javascript
{
  "agentTemplate": { /* template object */ },
  "agentName": "Imported Agent",
  "fromAgentId": "agent_123"
}
```

#### 9. `get_agent_usage`
Get agent usage statistics and credits.

```javascript
{
  "agentId": "agent_123",
  "range": {
    "from": "2024-01-01",
    "to": "2024-01-31"
  }
}
```

### Conversation Tools (8)

#### 10. `list_conversations`
List all conversations for an agent.

```javascript
{
  "agentId": "agent_123",
  "page": 1,
  "limit": 20
}
```

#### 11. `create_conversation`
Create a new conversation.

```javascript
{
  "agentId": "agent_123",
  "conversation": {
    "ts": 1234567890,
    "userName": "John Doe",
    "userEmail": "john@example.com"
  }
}
```

#### 12. `get_conversation`
Get details of a specific conversation.

```javascript
{
  "agentId": "agent_123",
  "convoId": "convo_456"
}
```

#### 13. `update_conversation`
Update an existing conversation.

```javascript
{
  "agentId": "agent_123",
  "convoId": "convo_456",
  "conversation": {
    "tags": ["resolved", "important"],
    "note": "Customer issue resolved"
  }
}
```

#### 14. `delete_conversation`
Delete a conversation.

```javascript
{
  "agentId": "agent_123",
  "convoId": "convo_456"
}
```

#### 15. `export_all_conversations`
Export all conversations for an agent.

```javascript
{
  "agentId": "agent_123",
  "format": "json"  // or "csv"
}
```

#### 16. `export_conversation`
Export a single conversation.

```javascript
{
  "agentId": "agent_123",
  "convoId": "convo_456",
  "format": "json"  // or "csv"
}
```

#### 17. `assign_conversation`
Assign a conversation to a user.

```javascript
{
  "agentId": "agent_123",
  "convoId": "convo_456",
  "assignToUserId": "user_789",
  "delegatedBy": "admin_001"
}
```

### Knowledge Base Tools (6)

#### 18. `create_kb_doc`
Add a document to an agent's knowledge base.

**Supports 3 source types:**
- `doc` - Direct text content
- `url` - Scrape from URLs
- `sitemap` - Process entire sitemap

```javascript
{
  "agentId": "agent_123",
  "name": "Product Documentation",
  "sourceType": "doc",
  "content": "Full product documentation here...",
  "tags": ["docs", "product"],
  "refreshRate": "24h"
}

// URL example
{
  "agentId": "agent_123",
  "name": "Website Content",
  "sourceType": "url",
  "urls": ["https://example.com/page1", "https://example.com/page2"],
  "scrapeContent": true
}

// Sitemap example
{
  "agentId": "agent_123",
  "name": "Full Website",
  "sourceType": "sitemap",
  "sitemapUrl": "https://example.com/sitemap.xml",
  "maxPages": 100
}
```

#### 19. `list_kb_docs`
List all KB documents for an agent.

```javascript
{
  "agentId": "agent_123",
  "page": 1,
  "pageSize": 20
}
```

#### 20. `get_kb_doc`
Get a single KB document.

```javascript
{
  "agentId": "agent_123",
  "docId": "doc_456"
}
```

#### 21. `update_kb_doc`
Update a KB document.

```javascript
{
  "agentId": "agent_123",
  "docId": "doc_456",
  "name": "Updated Name",
  "content": "Updated content...",
  "tags": ["updated", "v2"],
  "refreshRate": "12h"
}
```

#### 22. `delete_kb_doc`
Delete a KB document.

```javascript
{
  "agentId": "agent_123",
  "docId": "doc_456"
}
```

#### 23. `get_kb_stats`
Get KB statistics for an agent.

```javascript
{
  "agentId": "agent_123"
}
```

## 🎓 Usage Examples in Claude Desktop

Once configured, you can use natural language in Claude Desktop:

### Agent Management
- "List all my ConvoCore agents"
- "Create a new agent called 'Sales Bot' with the prompt 'You are a sales assistant'"
- "Get details for agent abc123"
- "Update agent abc123's main prompt to 'You are a helpful customer service agent'"
- "Delete agent abc123"
- "Export agent abc123"
- "Show me usage stats for agent abc123"

### Conversation Management
- "List all conversations for agent abc123"
- "Show me conversation xyz456 from agent abc123"
- "Export all conversations from agent abc123 as CSV"
- "Assign conversation xyz456 to user john123"
- "Update conversation xyz456 to add tag 'resolved'"

### Knowledge Base Management
- "Add a document called 'FAQ' to agent abc123's knowledge base"
- "List all KB documents for agent abc123"
- "Show me KB doc doc456 from agent abc123"
- "Update KB doc doc456 to refresh every 24 hours"
- "Delete KB doc doc456 from agent abc123"
- "Show me KB stats for agent abc123"
- "Add website content from https://example.com to agent's KB"

## 🏗️ Architecture

```
convocore-mcp/
├── src/
│   ├── index.ts              # MCP server & tool definitions
│   ├── convocore-client.ts   # ConvoCore API client
│   ├── config.ts             # Environment configuration
│   └── types.ts              # TypeScript types
├── dist/                     # Compiled JavaScript
├── Dockerfile                # Multi-stage Docker build
├── docker-compose.yml        # Docker Compose config
└── package.json              # Dependencies & scripts
```

## 🔐 Authentication

The server uses **Bearer token authentication** with your `WORKSPACE_SECRET`:

```
Authorization: Bearer <WORKSPACE_SECRET>
```

## 🌍 API Regions

Choose your API region based on your location:

- **EU**: `https://eu-gcp-api.vg-stuff.com/v3` (default)
- **NA**: `https://na-gcp-api.vg-stuff.com/v3`

Set via `CONVOCORE_API_REGION` environment variable.

## 🐳 Docker Hub

Pull the latest image:

```bash
docker pull moe003/convocore-mcp:latest
```

Available tags:
- `latest` - Latest stable release
- `2.0.0` - Version 2.0.0 (Agents + Conversations)
- `1.0.x` - Version 1.0.x (Agents only)

## 🛠️ Development

### Build

```bash
pnpm run build
```

### Build Docker Image

```bash
docker build -t moe003/convocore-mcp:latest .
```

### Push to Docker Hub

```bash
docker push moe003/convocore-mcp:latest
```

## 📖 Understanding ConvoCore Nodes

ConvoCore uses **nodes** for advanced AI agent workflows:

- **Each node** = A separate agent step
- **First node** (`nodes[0]`) = Main agent prompt
- **Other nodes** = Advanced multi-step workflows

When updating an agent's prompt, always modify `nodes[0].instructions`:

```javascript
{
  "agentId": "agent_123",
  "nodes": [
    {
      "instructions": "Your new main prompt here..."
    }
  ]
}
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - See LICENSE file for details.

## 🔗 Links

- [ConvoCore API Documentation](https://convocore.ai/docs)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Docker Hub Repository](https://hub.docker.com/r/moe003/convocore-mcp)

## 💬 Support

For issues and questions:
- GitHub Issues: [convocore-mcp/issues](https://github.com/moe003/convocore-mcp/issues)
- ConvoCore Support: https://convocore.ai/support

---

Built with ❤️ for the ConvoCore community
