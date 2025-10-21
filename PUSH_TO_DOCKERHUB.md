# Push to Docker Hub Instructions

## ✅ Docker Image Built Successfully!

Your Docker image has been built with the following tags:
- `moe003/convocore-mcp:latest`
- `moe003/convocore-mcp:1.0.0`

## Step-by-Step: Push to Docker Hub

### 1. Log in to Docker Hub

Open a terminal and run:

```bash
docker login
```

Enter your Docker Hub credentials when prompted:
- **Username**: moe003
- **Password**: [your Docker Hub password or access token]

### 2. Push the Images

Once logged in, run:

```bash
# Push the latest tag
docker push moe003/convocore-mcp:latest

# Push the version tag
docker push moe003/convocore-mcp:1.0.0
```

### 3. Verify on Docker Hub

Go to: https://hub.docker.com/r/moe003/convocore-mcp

You should see your image listed!

## Quick Commands

```bash
# Login, build, and push all in one go
docker login
docker push moe003/convocore-mcp:latest
docker push moe003/convocore-mcp:1.0.0
```

## Alternative: Use Access Token

For better security, use a Docker Hub access token instead of your password:

1. Go to: https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Give it a name (e.g., "convocore-mcp")
4. Copy the token
5. Use it as password when running `docker login`

## Verify Local Images

Check that images are built:

```bash
docker images | grep convocore-mcp
```

You should see:
```
moe003/convocore-mcp   latest    <image-id>   <time>   <size>
moe003/convocore-mcp   1.0.0     <image-id>   <time>   <size>
```

## Test the Image Locally

Before pushing, test it:

```bash
docker run -i \
  -e CONVOCORE_API_KEY=your_test_key \
  -e WORKSPACE_SECRET=your_test_secret \
  moe003/convocore-mcp:latest
```

## Troubleshooting

### "denied: requested access to the resource is denied"
- Make sure you're logged in: `docker login`
- Verify you're using the correct username (moe003)
- Check that the repository exists or you have permission to create it

### "unauthorized: authentication required"
- You need to log in first: `docker login`
- Use correct credentials or access token

### "name unknown: repository not found"
- The repository will be created automatically on first push
- Ensure you have Docker Hub account: moe003

## After Push Complete

Once pushed, anyone can pull and use your image:

```bash
docker pull moe003/convocore-mcp:latest
```

## CI/CD Integration

For automated builds, consider setting up GitHub Actions (see DOCKER.md for example workflow).

## Image Details

- **Repository**: docker.io/moe003/convocore-mcp
- **Tags**: latest, 1.0.0
- **Base**: node:20-alpine
- **Size**: ~100-150MB
- **Architecture**: Multi-platform compatible

## Next Steps After Push

1. ✅ Verify image on Docker Hub
2. ✅ Test pulling the image
3. ✅ Update README with Docker Hub link
4. ✅ Share with users!

---

**Ready to push when you are!** 🚀

