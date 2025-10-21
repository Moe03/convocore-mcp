# ✅ Corrected Configuration - Only 2 Variables!

## Environment Variables (Corrected)

You only need **2 environment variables**:

1. **WORKSPACE_SECRET** (required) - Your ConvoCore workspace secret
2. **CONVOCORE_API_REGION** (optional, defaults to `eu-gcp`)

~~CONVOCORE_API_KEY~~ ❌ NOT NEEDED!

---

## .env File (Corrected)

```env
# ConvoCore Configuration
WORKSPACE_SECRET=your_workspace_secret_here

# Optional: Choose API region (eu-gcp or na-gcp)
CONVOCORE_API_REGION=eu-gcp
```

---

## Claude Desktop Config (Corrected)

### Option 1: Using Local Node

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

### Option 2: Using Docker

```json
{
  "mcpServers": {
    "convocore": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "WORKSPACE_SECRET=your_secret",
        "-e", "CONVOCORE_API_REGION=eu-gcp",
        "moe003/convocore-mcp:latest"
      ]
    }
  }
}
```

---

## Docker Commands (Corrected)

### Docker Run

```bash
docker run -i \
  -e WORKSPACE_SECRET=your_workspace_secret \
  -e CONVOCORE_API_REGION=eu-gcp \
  moe003/convocore-mcp:latest
```

### Docker Compose

Update `docker-compose.yml`:

```yaml
version: '3.8'

services:
  convocore-mcp:
    image: moe003/convocore-mcp:latest
    container_name: convocore-mcp-server
    environment:
      - WORKSPACE_SECRET=${WORKSPACE_SECRET}
      - CONVOCORE_API_REGION=${CONVOCORE_API_REGION:-eu-gcp}
    stdin_open: true
    tty: true
    restart: unless-stopped
```

Then create `.env`:

```env
WORKSPACE_SECRET=your_workspace_secret_here
CONVOCORE_API_REGION=eu-gcp
```

---

## What Changed

**Before (wrong):**
- CONVOCORE_API_KEY ❌
- WORKSPACE_SECRET ✅
- CONVOCORE_API_REGION ✅

**After (correct):**
- WORKSPACE_SECRET ✅ (this IS the Bearer token!)
- CONVOCORE_API_REGION ✅ (optional)

The WORKSPACE_SECRET itself is used as the Bearer token in API requests!

---

## Quick Test

```bash
# Set your workspace secret
export WORKSPACE_SECRET=your_actual_secret
export CONVOCORE_API_REGION=eu-gcp

# Run locally
node dist/index.js

# Or with Docker
docker run -i \
  -e WORKSPACE_SECRET=$WORKSPACE_SECRET \
  -e CONVOCORE_API_REGION=$CONVOCORE_API_REGION \
  moe003/convocore-mcp:latest
```

---

**That's it! Just WORKSPACE_SECRET and optionally the region.** 🎯

