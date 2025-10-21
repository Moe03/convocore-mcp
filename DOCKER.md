# Docker Deployment Guide

## Docker Hub Repository

**Image**: `docker.io/moe003/convocore-mcp`

## Quick Start with Docker

### Pull and Run

```bash
docker pull moe003/convocore-mcp:latest

docker run -i \
  -e CONVOCORE_API_KEY=your_api_key \
  -e WORKSPACE_SECRET=your_workspace_secret \
  -e CONVOCORE_API_REGION=eu-gcp \
  moe003/convocore-mcp:latest
```

### Using Docker Compose

1. Create a `.env` file:
```env
CONVOCORE_API_KEY=your_api_key_here
WORKSPACE_SECRET=your_workspace_secret_here
CONVOCORE_API_REGION=eu-gcp
```

2. Run with docker-compose:
```bash
docker-compose up -d
```

## Building the Image Locally

### Build

```bash
docker build -t moe003/convocore-mcp:latest .
```

### Test Locally

```bash
docker run -i \
  -e CONVOCORE_API_KEY=your_api_key \
  -e WORKSPACE_SECRET=your_workspace_secret \
  moe003/convocore-mcp:latest
```

## Pushing to Docker Hub

### Login

```bash
docker login
```

### Tag (if needed)

```bash
docker tag convocore-mcp:latest moe003/convocore-mcp:latest
docker tag convocore-mcp:latest moe003/convocore-mcp:1.0.0
```

### Push

```bash
docker push moe003/convocore-mcp:latest
docker push moe003/convocore-mcp:1.0.0
```

## Using with Claude Desktop

Update your Claude Desktop config to use the Docker container:

```json
{
  "mcpServers": {
    "convocore": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "CONVOCORE_API_KEY=your_api_key",
        "-e", "WORKSPACE_SECRET=your_workspace_secret",
        "-e", "CONVOCORE_API_REGION=eu-gcp",
        "moe003/convocore-mcp:latest"
      ]
    }
  }
}
```

## Image Details

### Base Image
- **Node.js**: 20-alpine (minimal size)
- **Package Manager**: pnpm
- **Size**: ~100-150MB

### Multi-stage Build
1. **Builder Stage**: Compiles TypeScript
2. **Production Stage**: Only includes runtime dependencies

### Environment Variables

Required:
- `CONVOCORE_API_KEY` - Your ConvoCore API key
- `WORKSPACE_SECRET` - Your workspace secret

Optional:
- `CONVOCORE_API_REGION` - API region (default: eu-gcp)

## Available Tags

- `latest` - Latest stable version
- `1.0.0` - Specific version
- `1.0` - Minor version
- `1` - Major version

## Health Check

Test the container is working:

```bash
# Run in interactive mode and send test input
docker run -i \
  -e CONVOCORE_API_KEY=your_key \
  -e WORKSPACE_SECRET=your_secret \
  moe003/convocore-mcp:latest
```

## Troubleshooting

### Container exits immediately
- Ensure you use `-i` (interactive) flag
- The MCP server communicates via stdin/stdout

### Environment variables not working
- Check that variables are properly set
- Use `-e` flag for each variable
- Or use `--env-file` with a file

### Permission denied when pushing
```bash
docker login
# Enter your Docker Hub credentials
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Push Docker Image

on:
  push:
    tags:
      - 'v*'

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      
      - name: Login to Docker Hub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      
      - name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: |
            moe003/convocore-mcp:latest
            moe003/convocore-mcp:${{ github.ref_name }}
```

## Advanced Usage

### Custom Network

```bash
docker network create mcp-network

docker run -i \
  --network mcp-network \
  --name convocore-mcp \
  -e CONVOCORE_API_KEY=your_key \
  -e WORKSPACE_SECRET=your_secret \
  moe003/convocore-mcp:latest
```

### Volume Mounting (for logs)

```bash
docker run -i \
  -v $(pwd)/logs:/app/logs \
  -e CONVOCORE_API_KEY=your_key \
  -e WORKSPACE_SECRET=your_secret \
  moe003/convocore-mcp:latest
```

## Security Best Practices

1. **Never commit .env files**
2. **Use Docker secrets** for production
3. **Scan images** for vulnerabilities:
   ```bash
   docker scan moe003/convocore-mcp:latest
   ```
4. **Keep base image updated**
5. **Use specific version tags** in production

## Updating the Image

### Pull latest version

```bash
docker pull moe003/convocore-mcp:latest
```

### Restart container

```bash
docker-compose down
docker-compose pull
docker-compose up -d
```

## Support

- **Docker Hub**: https://hub.docker.com/r/moe003/convocore-mcp
- **GitHub Issues**: Report issues in the repository
- **Documentation**: See README.md for full documentation

