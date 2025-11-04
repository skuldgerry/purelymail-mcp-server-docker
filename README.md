# PurelyMail MCP Server

A Model Context Protocol (MCP) server that provides AI assistants and automation tools (like n8n) with access to PurelyMail's email management API. Supports both stdio transport (for MCP clients) and HTTP/HTTPS transport (for REST API integrations).

## Features

- **Type-Safe API Integration**: Generated TypeScript client from PurelyMail's swagger specification
- **Comprehensive Tool Coverage**: Manage users, domains, routing rules, billing, and password reset methods
- **Multiple Transport Protocols**: 
  - **stdio** transport for MCP clients (Claude Desktop, Claude Code)
  - **HTTP/HTTPS** transport for REST API integrations (n8n, Zapier, custom apps)
- **Docker Support**: Containerized deployment with Docker and docker-compose
- **Resource-Grouped Tools**: Intelligent organization of API endpoints into logical tools
- **Error Handling**: Robust error reporting and validation

## Quick Start

### Option 1: Docker (Recommended for HTTP Transport)

**Quick Start - Copy and run:**

Create a `docker-compose.yml` file:

```yaml
services:
  purelymail-mcp-server:
    image: skuldgerry/purelymail-mcp:1.0.0
    container_name: purelymail-mcp-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PURELYMAIL_API_KEY=your-api-key-here
      - TRANSPORT=http
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
```

Then run:
```bash
docker-compose up -d
```

**Or run directly with Docker (one-liner):**
```bash
docker run -d -p 3000:3000 -e PURELYMAIL_API_KEY=your-api-key-here --name purelymail-mcp-server skuldgerry/purelymail-mcp:1.0.0
```

**Or with multi-line formatting:**
```bash
docker run -d \
  -p 3000:3000 \
  -e PURELYMAIL_API_KEY=your-api-key-here \
  --name purelymail-mcp-server \
  skuldgerry/purelymail-mcp:1.0.0
```

> **Note:** For advanced users, you can use a `.env` file with `PURELYMAIL_API_KEY=${PURELYMAIL_API_KEY}` in docker-compose.yml. The docker-compose.yml in the repository supports this.

### Option 2: npx (No Installation - Stdio Transport Only)

```bash
npx -y purelymail-mcp-server
```

**Configure in your MCP client:**

```json
{
  "mcpServers": {
    "purelymail": {
      "command": "npx",
      "args": ["-y", "purelymail-mcp-server"],
      "env": {
        "PURELYMAIL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Option 3: Nix (via GitHub Flake)

```bash
nix run github:gui-wf/purelymail-mcp-server --quiet --refresh
```

## Transport Modes

The server supports two transport modes:

### 1. Stdio Transport (Default)
For MCP clients like Claude Desktop and Claude Code. Uses standard input/output for communication.

### 2. HTTP Transport
For REST API integrations like n8n, Zapier, or custom applications. Exposes HTTP endpoints on port 3000.

**Note:** Docker deployments use HTTP transport automatically.

**HTTP Endpoints:**

- `GET /health` - Health check endpoint
- `POST /mcp` - Main MCP protocol endpoint (handles `tools/list` and `tools/call` methods)

**Request Formats for `/mcp` endpoint:**
- `POST /mcp` with `{method: "tools/list"}` - List all available tools
- `POST /mcp` with `{method: "tools/call", params: {name: "tool_name", arguments: {...}}}` - Call a tool

**Example HTTP Requests:**

```bash
# List all tools via MCP endpoint
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'

# Call a tool via MCP endpoint
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "list_users",
      "arguments": {}
    }
  }'

# Call a tool with arguments
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "create_user",
      "arguments": {
        "userName": "john",
        "domainName": "example.com",
        "password": "secure-password"
      }
    }
  }'
```

## Docker Deployment

### Using Docker Compose

Simply create a `docker-compose.yml` with your API key and run:

```bash
docker-compose up -d
```

Check logs:
```bash
docker-compose logs -f
```

**Example docker-compose.yml:**
```yaml
services:
  purelymail-mcp-server:
    image: skuldgerry/purelymail-mcp:1.0.0
    container_name: purelymail-mcp-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PURELYMAIL_API_KEY=your-api-key-here
      - TRANSPORT=http
```

### Using Docker Run

**One-liner:**
```bash
docker run -d -p 3000:3000 -e PURELYMAIL_API_KEY=your-api-key-here --name purelymail-mcp-server skuldgerry/purelymail-mcp:1.0.0
```

**Multi-line:**
```bash
docker run -d \
  --name purelymail-mcp-server \
  -p 3000:3000 \
  -e PURELYMAIL_API_KEY=your-api-key-here \
  skuldgerry/purelymail-mcp:1.0.0
```

### Docker Environment Variables

| Variable | Description |
|----------|-------------|
| `PURELYMAIL_API_KEY` | *required* - Your PurelyMail API key |

## n8n Integration

### Using HTTP Request Node

**List Available Tools:**
- Method: `POST`
- URL: `http://your-server:3000/mcp`
- Body Type: `JSON`
- Body: `{"method": "tools/list"}`

**Call a Tool:**
- Method: `POST`
- URL: `http://your-server:3000/mcp`
- Body Type: `JSON`
- Body: `{"method": "tools/call", "params": {"name": "tool_name", "arguments": {...}}}`

### Example n8n Workflow

Create a workflow that:
1. Triggers on a schedule
2. Calls `POST /mcp` with `{"method": "tools/list"}` to list available tools
3. Calls `POST /mcp` with `{"method": "tools/call", "params": {"name": "list_users", "arguments": {}}}` to get all users
4. Processes each user
5. Calls `POST /mcp` with `{"method": "tools/call", "params": {"name": "get_user", "arguments": {"userName": "user@example.com"}}}` for detailed information

**Example n8n HTTP Request Node Configuration:**

**Node 1 - List Tools:**
- Method: `POST`
- URL: `http://localhost:3000/mcp`
- Body: `{"method": "tools/list"}`

**Node 2 - Call Tool:**
- Method: `POST`
- URL: `http://localhost:3000/mcp`
- Body: `{"method": "tools/call", "params": {"name": "list_users", "arguments": {}}}`

**Node 3 - Call Tool with Arguments:**
- Method: `POST`
- URL: `http://localhost:3000/mcp`
- Body: `{"method": "tools/call", "params": {"name": "get_user", "arguments": {"userName": "user@example.com"}}}`

## Quick Start (Local Development)

### 1. Prerequisites

- Node.js 20+ (if installing from source)
- PurelyMail API key (for production use)
- Nix (for reproducible development environment - source only)

### 2. Production Setup

#### Stdio Transport (MCP Clients)
```bash
# Set your PurelyMail API key
export PURELYMAIL_API_KEY="your-api-key-here"

# Run the server (stdio mode)
npm run dev

# Or build and run
npm run build
node dist/index.js
```

#### HTTP Transport (REST API)
```bash
# Set your PurelyMail API key
export PURELYMAIL_API_KEY="your-api-key-here"
export TRANSPORT="http"

# Run the server
npm run dev

# Server will be available at http://localhost:3000
```

## MCP Integration

### Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

#### Using npx (recommended - no installation):

```json
{
  "mcpServers": {
    "purelymail": {
      "command": "npx",
      "args": ["-y", "purelymail-mcp-server"],
      "env": {
        "PURELYMAIL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### Using Nix from GitHub:

```json
{
  "mcpServers": {
    "purelymail": {
      "command": "nix",
      "args": ["run", "github:gui-wf/purelymail-mcp-server", "--quiet", "--refresh"],
      "env": {
        "PURELYMAIL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### When using from source with Nix:

```json
{
  "mcpServers": {
    "purelymail": {
      "command": "nix",
      "args": ["run", "/path/to/purelymail-mcp-server#default"],
      "env": {
        "PURELYMAIL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### When using from source with Node.js:

```json
{
  "mcpServers": {
    "purelymail": {
      "command": "node",
      "args": ["/path/to/purelymail-mcp-server/dist/index.js"],
      "env": {
        "PURELYMAIL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Claude Code

For Claude Code, create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "purelymail": {
      "command": "npx",
      "args": ["-y", "purelymail-mcp-server"],
      "env": {
        "PURELYMAIL_API_KEY": "${PURELYMAIL_API_KEY}"
      }
    }
  }
}
```

### Other MCP Clients

The server supports stdio transport for MCP-compliant clients and HTTP transport for REST API integrations. By default, it uses stdio transport. Docker deployments automatically use HTTP transport.

## Available Tools

The server provides 19 individual tools, each corresponding to a specific PurelyMail API operation:

### User Management
- `create_user` - Create a new email user
- `delete_user` - Delete an email user
- `list_users` - List all users under your account
- `modify_user` - Modify user settings
- `get_user` - Retrieve user details
- `create_app_password` - Create an app-specific password
- `delete_app_password` - Delete an app password

### Password Reset Management
- `create_or_update_password_reset_method` - Create or update password reset method
- `delete_password_reset_method` - Delete a password reset method
- `list_password_reset_methods` - List all password reset methods for a user

### Domain Management
- `add_domain` - Add a new domain
- `list_domains` - List all domains
- `update_domain_settings` - Update domain settings
- `delete_domain` - Delete a domain
- `get_ownership_code` - Get DNS ownership verification code

### Routing Management
- `create_routing_rule` - Create a new routing rule
- `delete_routing_rule` - Delete a routing rule
- `list_routing_rules` - List all routing rules

### Billing
- `check_account_credit` - Check current account credit balance


## Installation

### Via Docker (Recommended)

```bash
# Pull from Docker Hub (when published)
docker pull purelymail-mcp-server:latest

# Or build from source
git clone https://github.com/gui-wf/purelymail-mcp-server.git
cd purelymail-mcp-server
docker build -t purelymail-mcp-server .
```

### Via npx (Stdio Transport Only)
```bash
npx -y purelymail-mcp-server
```

### Via Nix (GitHub Flake)
```bash
nix run github:gui-wf/purelymail-mcp-server --quiet --refresh
```

### From Source
```bash
# Clone and setup
git clone https://github.com/gui-wf/purelymail-mcp-server.git
cd purelymail-mcp-server

# Using Nix (recommended)
nix develop

# Or use npm directly
npm install

# Build the TypeScript project
npm run build
```



## Tool Usage Patterns

### Example: Creating a User

```json
{
  "tool": "create_user",
  "arguments": {
    "userName": "john",
    "domainName": "example.com",
    "password": "secure-password",
    "enableSearchIndexing": true,
    "sendWelcomeEmail": true
  }
}
```

### Example: Listing Domains

```json
{
  "tool": "list_domains",
  "arguments": {
    "includeShared": false
  }
}
```

### Example: Getting User Details

**Via MCP (stdio):**
```json
{
  "tool": "get_user",
  "arguments": {
    "userName": "john@example.com"
  }
}
```

**Via HTTP API:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "get_user",
      "arguments": {
        "userName": "john@example.com"
      }
    }
  }'
```

**Via n8n HTTP Request Node:**
- URL: `http://localhost:3000/mcp`
- Method: `POST`
- Body: `{"method": "tools/call", "params": {"name": "get_user", "arguments": {"userName": "john@example.com"}}}`

## Architecture Notes

### Type Safety
- All API interactions use generated TypeScript types
- Zero manual type definitions - everything derives from swagger spec
- Automatic validation and error handling

### Error Handling
- Structured error responses with context
- API errors are wrapped and formatted for AI consumption
- Network and validation errors are handled gracefully


## Documentation

See `docs/` for project documentation:
- [Development Guide](docs/DEVELOPMENT.md) - Development workflow and contributing guidelines
- [API Updates](docs/API-UPDATES.md) - Keeping the server synchronized with PurelyMail API changes
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

## License

This project is licensed under a custom non-commercial license - see the [LICENSE](LICENSE) file for details.

### Commercial Use
This software is available for non-commercial use only. For commercial licensing, please contact fairuse@gui.wf.

### Dependencies
This project uses MIT and Apache-2.0 licensed dependencies. See docs/package-licenses.md for full dependency licensing information.
