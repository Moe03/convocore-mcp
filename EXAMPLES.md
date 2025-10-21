# ConvoCore MCP Server - Usage Examples

This document provides detailed examples of using each tool available in the ConvoCore MCP server through Claude.

## Prerequisites

Make sure you have:
1. Installed and built the project (`pnpm install && pnpm run build`)
2. Configured Claude Desktop with your ConvoCore credentials
3. Restarted Claude Desktop

## Tool Examples

### 1. Create Agent

Create a new AI agent with basic configuration:

```
Create a new ConvoCore agent with:
- title: "Customer Support Bot"
- description: "Handles customer inquiries and support tickets"
- theme: "blue-light"
- disabled: false
```

With voice configuration:

```
Create a ConvoCore agent called "Voice Assistant" with voice configuration:
- transcriber provider: deepgram
- speech generator provider: elevenlabs
- voice ID: "21m00Tcm4TlvDq8ikWAM"
```

### 2. Get Agent

Retrieve details of a specific agent:

```
Get the ConvoCore agent with ID "agent_abc123"
```

Or more naturally:

```
Show me details about agent agent_abc123
```

### 3. Update Agent

Update an existing agent:

```
Update ConvoCore agent agent_abc123:
- Set title to "Updated Support Bot"
- Set disabled to true
```

Update with complex configuration:

```
Update agent agent_abc123 with new voice settings:
- Change voice provider to cartesia
- Set voice ID to "new_voice_id"
- Enable high audio quality
```

### 4. Delete Agent

Delete an agent permanently:

```
Delete ConvoCore agent agent_abc123
```

**Warning**: This is permanent and cannot be undone!

### 5. List Agents

List all agents in an organization:

```
List all ConvoCore agents for organization org_xyz789
```

With pagination:

```
Show me page 2 of ConvoCore agents for organization org_xyz789, with 10 agents per page
```

### 6. Search Agents

Search for agents by query:

```
Search ConvoCore agents for "support"
```

## Complete Workflow Example

Here's a complete workflow showing how to create, update, and manage an agent:

### Step 1: Create an Agent

```
Create a new ConvoCore agent:
- title: "Sales Assistant"
- description: "Helps with sales inquiries and product information"
- theme: "blue-light"
- light: false
- disabled: false
```

Response will include the new agent ID, e.g., `agent_new123`

### Step 2: Verify the Agent

```
Get ConvoCore agent agent_new123
```

Review the agent details to confirm everything is correct.

### Step 3: Update the Agent

```
Update ConvoCore agent agent_new123:
- description: "Updated: Comprehensive sales assistant with product catalog access"
- autoOpenWidget: true
```

### Step 4: List Your Agents

```
List all agents in organization org_xyz789
```

You should see your new agent in the list.

### Step 5: Test and Deploy

Once satisfied, enable the agent if it was created as disabled:

```
Update agent agent_new123 to set disabled: false
```

### Step 6: Clean Up (Optional)

If you need to remove the test agent:

```
Delete agent agent_new123
```

## Advanced Examples

### Creating an Agent with Full Voice Configuration

```
Create a ConvoCore agent called "Advanced Voice Bot" with the following configuration:

Title: "Advanced Voice Bot"
Description: "Full-featured voice assistant"
Theme: "custom-blue-dark"

Voice Configuration:
- Transcriber:
  - Provider: deepgram
  - Language: en-US
  - Keywords: ["support", "help", "assistance"]
  
- Speech Generator:
  - Provider: elevenlabs
  - Voice ID: "21m00Tcm4TlvDq8ikWAM"
  - High audio quality: true
  - Background noise: office
  
- Call Config:
  - Record audio: true
  - Enable web calling: true
```

### Bulk Operations

List all agents and then update multiple:

```
1. List all agents in org_xyz789
2. For each disabled agent, update it to set disabled: false
```

(Note: Claude will help you iterate through the agents)

### Searching and Filtering

```
1. Search for agents containing "customer"
2. Show me details for each found agent
3. Create a summary of all customer-facing agents
```

## Common Patterns

### Pattern 1: Clone an Agent Configuration

```
1. Get agent agent_source123
2. Create a new agent with the same configuration but different title
```

### Pattern 2: Audit Agents

```
1. List all agents in organization
2. For each agent, check if it's disabled
3. Create a report of active vs disabled agents
```

### Pattern 3: Update Multiple Agents

```
1. List all agents
2. Filter agents with theme "blue-light"
3. Update each to use theme "blue-dark"
```

## Error Handling Examples

### Handle Missing Agent

```
Try to get agent agent_doesnotexist
```

The server will return an error message indicating the agent was not found.

### Handle Invalid Parameters

```
Create an agent without a title
```

The server will return a validation error indicating that title is required.

## Tips for Working with Claude

1. **Be Specific**: Include the exact agent ID when referencing agents
2. **Use Natural Language**: Claude understands context, so you can say "update the agent we just created"
3. **Chain Operations**: You can ask Claude to perform multiple operations in sequence
4. **Ask for Summaries**: After listing agents, ask Claude to summarize or filter the results
5. **Verify Before Delete**: Always verify agent details before deleting

## Response Format

All tools return JSON responses with this structure:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    // Agent data or operation result
  }
}
```

For list operations:

```json
{
  "success": true,
  "message": "Agents retrieved successfully",
  "data": [...],
  "total": 100,
  "totalPages": 5,
  "currentPage": 1
}
```

## Need Help?

If you encounter issues:
1. Check that your credentials are correct in Claude Desktop config
2. Verify the agent IDs are correct
3. Ensure the ConvoCore API is accessible from your network
4. Check the SETUP.md for troubleshooting steps

