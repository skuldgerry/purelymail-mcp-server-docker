# Multi-stage build for PurelyMail MCP Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY tsconfig.json ./

# Install dependencies and update lock file
RUN npm install

# Copy source files (only what's needed for build)
COPY src ./src
COPY purelymail-api-spec.json ./
COPY scripts ./scripts
# Note: .dockerignore ensures we don't copy unnecessary files like node_modules, .git, etc.

# Build the TypeScript project
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
# Copy lock file from builder stage (if generated)
COPY --from=builder /app/package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/purelymail-api-spec.json ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Expose port for HTTP transport
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV TRANSPORT=stdio

# Health check is configured in docker-compose.yml
# Note: Healthcheck only works when TRANSPORT=http

# Start the server
CMD ["node", "dist/index.js"]
