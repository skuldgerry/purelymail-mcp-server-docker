#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import createClient from "openapi-fetch";
import type { paths } from "./types/purelymail-api.js";
import { createToolsFromSpec } from "./tools/openapi-fetch-generator.js";
import express, { type Express, Request, Response } from "express";
import cors from "cors";

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

  if (!apiKey) {
    console.error("PurelyMail API key required. Set PURELYMAIL_API_KEY environment variable.");
    process.exit(1);
  }

  console.error(`API connection to PurelyMail initialized`);

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
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }));

  // Set up tool call handler
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

  console.error(`Registered ${tools.length} tools from swagger spec`);

  // Connect to transport based on TRANSPORT environment variable
  if (transportType === 'http') {
    await startHttpServer(server, tools);
  } else {
    // Default: stdio transport for MCP clients
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

async function startHttpServer(server: Server, tools: any[]) {
  const app: Express = express();
  const port = 3000;
  const host = '0.0.0.0';

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'purelymail-mcp-server' });
  });

  // List available tools
  app.get('/tools', (_req: Request, res: Response) => {
    res.json({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
  });

  // Call a tool endpoint (for n8n and other integrations)
  app.post('/tools/:toolName', async (req: Request, res: Response) => {
    const toolName = req.params.toolName;
    const args = req.body.arguments || req.body || {};

    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
      return res.status(404).json({
        error: `Unknown tool: ${toolName}`,
        availableTools: tools.map(t => t.name)
      });
    }

    try {
      const result = await tool.execute(args);
      res.json({
        success: true,
        result: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
        details: error.stack
      });
    }
  });

  // Generic tool call endpoint (alternative to /tools/:toolName)
  app.post('/call', async (req: Request, res: Response) => {
    const { name, arguments: args } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'Tool name is required',
        availableTools: tools.map(t => t.name)
      });
    }

    const tool = tools.find(t => t.name === name);
    if (!tool) {
      return res.status(404).json({
        error: `Unknown tool: ${name}`,
        availableTools: tools.map(t => t.name)
      });
    }

    try {
      const result = await tool.execute(args || {});
      res.json({
        success: true,
        result: result
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
        details: error.stack
      });
    }
  });

  // Start HTTP server
  app.listen(port, host, () => {
    console.error(`HTTP server listening on http://${host}:${port}`);
    console.error(`Available endpoints:`);
    console.error(`  GET  /health - Health check`);
    console.error(`  GET  /tools - List all available tools`);
    console.error(`  POST /tools/:toolName - Call a specific tool`);
    console.error(`  POST /call - Call a tool (with name in body)`);
  });
}

initializeServer().catch(console.error);