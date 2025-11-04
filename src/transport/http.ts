import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { JSONRPCMessage, JSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";
import { Server as HttpServer } from "http";

/**
 * HTTP Server Transport for MCP
 * 
 * This transport implements the MCP protocol over HTTP, allowing
 * the SDK to handle all protocol logic (JSON-RPC 2.0, initialize, etc.)
 * while we just handle the HTTP request/response mechanics.
 */
export class HttpServerTransport implements Transport {
  private app: Express;
  private httpServer?: HttpServer;
  private port: number;
  private host: string;
  private pendingResponses: Map<string | number, (response: JSONRPCMessage) => void>;

  // Transport interface properties - SDK will set these
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(port: number = 3000, host: string = '0.0.0.0') {
    this.port = port;
    this.host = host;
    this.pendingResponses = new Map();
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // CORS middleware
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
      credentials: true
    }));

    // Body parsers
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Handle preflight requests
    this.app.options('*', (_req: Request, res: Response) => {
      res.sendStatus(200);
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ 
        status: 'ok', 
        service: 'purelymail-mcp-server',
        transport: 'http'
      });
    });

    // Main MCP endpoint - SDK handles the protocol
    this.app.post('/mcp', async (req: Request, res: Response) => {
      try {
        const message = req.body;

        // Validate JSON-RPC 2.0 message format
        if (!message.jsonrpc || message.jsonrpc !== '2.0') {
          return res.status(400).json({
            jsonrpc: '2.0',
            id: message.id || null,
            error: {
              code: -32600,
              message: 'Invalid Request: missing or invalid jsonrpc field (must be "2.0")'
            }
          });
        }

        if (!message.method) {
          return res.status(400).json({
            jsonrpc: '2.0',
            id: message.id || null,
            error: {
              code: -32600,
              message: 'Invalid Request: missing method field'
            }
          });
        }

        // Get the request ID for response tracking
        const requestId = message.id;

        if (requestId === undefined || requestId === null) {
          // Notification (no response expected)
          if (this.onmessage) {
            this.onmessage(message);
          }
          res.status(204).send(); // No content for notifications
          return;
        }

        // Request (response expected)
        // Create a promise that will resolve when SDK sends the response
        const responsePromise = new Promise<JSONRPCMessage>((resolve, reject) => {
          // Store the resolver
          this.pendingResponses.set(requestId, resolve);

          // Timeout after 30 seconds
          setTimeout(() => {
            this.pendingResponses.delete(requestId);
            reject(new Error('Request timeout'));
          }, 30000);
        });

        // Pass the message to the SDK for processing
        if (this.onmessage) {
          this.onmessage(message);
        } else {
          return res.status(500).json({
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: -32603,
              message: 'Internal error: message handler not initialized'
            }
          });
        }

        // Wait for SDK to process and send response
        const response = await responsePromise;
        res.json(response);

      } catch (error: any) {
        console.error('Error handling MCP request:', error);
        
        // Send error response
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id || null,
          error: {
            code: -32603,
            message: error.message || 'Internal server error',
            data: error.stack
          }
        });
      }
    });

    // Backwards compatibility endpoint (non-standard, for testing)
    this.app.get('/tools', (_req: Request, res: Response) => {
      res.json({
        message: 'Please use POST /mcp with JSON-RPC 2.0 format',
        example: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        }
      });
    });
  }

  /**
   * Start the HTTP server
   * Called by the SDK when connecting
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = this.app.listen(this.port, this.host, () => {
          console.error(`╔════════════════════════════════════════════════════════════╗`);
          console.error(`║  PurelyMail MCP Server - HTTP Transport                   ║`);
          console.error(`╠════════════════════════════════════════════════════════════╣`);
          console.error(`║  Listening: http://${this.host}:${this.port.toString().padEnd(39)} ║`);
          console.error(`║  Endpoint:  POST /mcp                                      ║`);
          console.error(`║  Health:    GET  /health                                   ║`);
          console.error(`║  Protocol:  MCP via JSON-RPC 2.0                           ║`);
          console.error(`╚════════════════════════════════════════════════════════════╝`);
          resolve();
        });

        this.httpServer.on('error', (error: Error) => {
          console.error('HTTP server error:', error);
          if (this.onerror) {
            this.onerror(error);
          }
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Close the HTTP server
   * Called by the SDK when disconnecting
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }

      this.httpServer.close((error) => {
        if (error) {
          reject(error);
        } else {
          console.error('HTTP server closed');
          if (this.onclose) {
            this.onclose();
          }
          resolve();
        }
      });
    });
  }

  /**
   * Send a message to the client
   * Called by the SDK when it needs to send a response
   */
  async send(message: JSONRPCMessage): Promise<void> {
    // For HTTP request-response, we resolve the pending promise
    // instead of sending directly (responses go via HTTP response)
    const messageWithId = message as JSONRPCResponse;
    
    if (messageWithId.id !== undefined && messageWithId.id !== null) {
      const resolver = this.pendingResponses.get(messageWithId.id);
      if (resolver) {
        this.pendingResponses.delete(messageWithId.id);
        resolver(message);
      } else {
        console.warn(`No pending response found for ID: ${messageWithId.id}`);
      }
    }
  }
}
