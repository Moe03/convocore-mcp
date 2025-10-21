# Docker Quick Reference

## Pull and Run

```bash
docker pull moe003/convocore-mcp:latest

docker run -i \
  -e CONVOCORE_API_KEY=your_api_key \
  -e WORKSPACE_SECRET=your_workspace_secret \
  -e CONVOCORE_API_REGION=eu-gcp \
  moe003/convocore-mcp:latest
```

## Use with Claude Desktop

```json
{
  "mcpServers": {
    "convocore": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "CONVOCORE_API_KEY=your_api_key",
        "-e", "WORKSPACE_SECRET=your_workspace_secret",
        "-e", "CONVOCORE_API_REGION=eu-gcp",
        "moe003/convocore-mcp:latest"
      ]
    }
  }
}
```

## Build Locally

```bash
docker build -t moe003/convocore-mcp:latest .
```

## More Info

See DOCKER.md for complete documentation.

