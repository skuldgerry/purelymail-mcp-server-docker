#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import createClient from "openapi-fetch";
import type { paths } from "./types/purelymail-api.js";
import { createToolsFromSpec } from "./tools/openapi-fetch-generator.js";
import { HttpServerTransport } from "./transport/http.js";

// Create MCP Server instance
const server = new Server(
  {
    name: "purelymail-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

async function initializeServer() {
  const apiKey = process.env.PURELYMAIL_API_KEY;
  const transportType = process.env.TRANSPORT || 'stdio'; // 'stdio' or 'http'

  // Validate API key
  if (!apiKey) {
    console.error("❌ PurelyMail API key required. Set PURELYMAIL_API_KEY environment variable.");
    process.exit(1);
  }

  console.error(`✅ API connection to PurelyMail initialized`);

  // Create openapi-fetch client
  const client = createClient<paths>({
    baseUrl: 'https://purelymail.com',
    headers: {
      'Content-Type': 'application/json',
      'Purelymail-Api-Token': apiKey!
    }
  });

  // Generate tools from swagger spec
  const tools = await createToolsFromSpec(client);

  // Set up tool list handler
  // SDK will call this when client requests tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }));

  // Set up tool call handler
  // SDK will call this when client requests tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    try {
      const result = await tool.execute(args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  });

  console.error(`✅ Registered ${tools.length} tools from swagger spec`);

  // Connect to transport based on TRANSPORT environment variable
  // The SDK will handle all protocol logic (JSON-RPC 2.0, initialize, etc.)
  if (transportType === 'http') {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';
    const transport = new HttpServerTransport(port, host);
    await server.connect(transport);
    console.error(`✅ MCP Server connected via HTTP transport`);
  } else {
    // Default: stdio transport for MCP clients (Claude Desktop, etc.)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`✅ MCP Server connected via stdio transport`);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

// Start the server
initializeServer().catch((error) => {
  console.error('❌ Fatal error during initialization:', error);
  process.exit(1);
});
