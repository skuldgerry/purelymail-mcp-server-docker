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
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Handle preflight requests
  app.options('*', (_req: Request, res: Response) => {
    res.sendStatus(200);
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'purelymail-mcp-server' });
  });

  // List available tools (GET for REST API, POST for MCP protocol)
  app.get('/tools', (_req: Request, res: Response) => {
    res.json({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
  });

  // POST /tools for MCP protocol clients
  app.post('/tools', (_req: Request, res: Response) => {
    res.json({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
  });

  // Call a tool endpoint (for n8n and other integrations)
  // Support multiple formats: /tools/:toolName, /tools/:toolName/call, /tools/call/:toolName
  app.post('/tools/:toolName', async (req: Request, res: Response) => {
    const toolName = req.params.toolName;
    // Support multiple request formats
    const args = req.body.arguments || req.body.params || req.body || {};

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

  app.post('/tools/:toolName/call', async (req: Request, res: Response) => {
    const toolName = req.params.toolName;
    const args = req.body.arguments || req.body.params || req.body || {};

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
  // Support multiple formats: /call, /tools/call, /invoke
  app.post('/call', async (req: Request, res: Response) => {
    // Support multiple request formats: {name, arguments}, {method, params}, {tool, args}
    const name = req.body.name || req.body.method || req.body.tool;
    const args = req.body.arguments || req.body.params || req.body.args || {};

    if (!name) {
      return res.status(400).json({
        error: 'Tool name is required (use "name", "method", or "tool" field)',
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

  app.post('/tools/call', async (req: Request, res: Response) => {
    const name = req.body.name || req.body.method || req.body.tool;
    const args = req.body.arguments || req.body.params || req.body.args || {};

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

  app.post('/invoke', async (req: Request, res: Response) => {
    const name = req.body.name || req.body.method || req.body.tool;
    const args = req.body.arguments || req.body.params || req.body.args || {};

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

  // Main MCP endpoint - handles MCP protocol messages
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const { method, params } = req.body;

      // Handle tools/list request
      if (method === 'tools/list' || method === 'list_tools') {
        return res.json({
          tools: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        });
      }

      // Handle tools/call request
      if (method === 'tools/call' || method === 'call_tool') {
        const toolName = params?.name || params?.toolName;
        const args = params?.arguments || params?.args || {};

        if (!toolName) {
          return res.status(400).json({
            error: 'Tool name is required',
            availableTools: tools.map(t => t.name)
          });
        }

        const tool = tools.find(t => t.name === toolName);
        if (!tool) {
          return res.status(404).json({
            error: `Unknown tool: ${toolName}`,
            availableTools: tools.map(t => t.name)
          });
        }

        try {
          const result = await tool.execute(args);
          return res.json({
            success: true,
            result: result
          });
        } catch (error: any) {
          return res.status(500).json({
            success: false,
            error: error.message,
            details: error.stack
          });
        }
      }

      // Unknown method
      return res.status(400).json({
        error: `Unknown method: ${method}`,
        supportedMethods: ['tools/list', 'tools/call', 'list_tools', 'call_tool']
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error.message,
        details: error.stack
      });
    }
  });

  // MCP prefix endpoints (for MCP protocol clients)
  app.get('/mcp/tools', (_req: Request, res: Response) => {
    res.json({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
  });

  app.post('/mcp/tools', (_req: Request, res: Response) => {
    res.json({
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
  });


  app.post('/mcp/call', async (req: Request, res: Response) => {
    const name = req.body.name || req.body.method || req.body.tool;
    const args = req.body.arguments || req.body.params || req.body.args || {};

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

  app.post('/mcp/tools/:toolName', async (req: Request, res: Response) => {
    const toolName = req.params.toolName;
    const args = req.body.arguments || req.body.params || req.body || {};

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

  app.post('/mcp/tools/:toolName/call', async (req: Request, res: Response) => {
    const toolName = req.params.toolName;
    const args = req.body.arguments || req.body.params || req.body || {};

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

  app.post('/mcp/invoke', async (req: Request, res: Response) => {
    const name = req.body.name || req.body.method || req.body.tool;
    const args = req.body.arguments || req.body.params || req.body.args || {};

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

  // Start HTTP server
  app.listen(port, host, () => {
    console.error(`HTTP server listening on http://${host}:${port}`);
    console.error(`Available endpoints:`);
    console.error(`  GET  /health - Health check`);
    console.error(`  GET  /tools - List all available tools (REST)`);
    console.error(`  POST /tools - List all available tools (MCP protocol)`);
    console.error(`  POST /tools/:toolName - Call a specific tool`);
    console.error(`  POST /tools/:toolName/call - Call tool (alternative format)`);
    console.error(`  POST /tools/call - Call tool (generic)`);
    console.error(`  POST /call - Call a tool (with name in body)`);
    console.error(`  POST /invoke - Call tool (alternative format)`);
    console.error(`  POST /mcp - Main MCP protocol endpoint (handles tools/list and tools/call)`);
    console.error(`  GET  /mcp/tools - List tools (MCP prefix)`);
    console.error(`  POST /mcp/tools - List tools (MCP prefix)`);
    console.error(`  POST /mcp/tools/:toolName - Call tool (MCP prefix)`);
    console.error(`  POST /mcp/tools/:toolName/call - Call tool (MCP prefix)`);
    console.error(`  POST /mcp/call - Call tool (MCP prefix)`);
    console.error(`  POST /mcp/invoke - Call tool (MCP prefix)`);
    console.error(`\nRequest formats supported:`);
    console.error(`  - {name: "tool_name", arguments: {...}}`);
    console.error(`  - {method: "tool_name", params: {...}}`);
    console.error(`  - {tool: "tool_name", args: {...}}`);
    console.error(`  - {arguments: {...}} (when using path parameter)`);
    console.error(`  - POST /mcp with {method: "tools/list"} or {method: "tools/call", params: {...}}`);
  });
}

initializeServer().catch(console.error);