# Multi-stage Dockerfile for Personal File Intelligence Server
FROM node:20-alpine AS base
WORKDIR /app

# Dependencies stage
FROM base AS dependencies
COPY package*.json ./
RUN npm ci --only=production

# Builder/test stage
FROM base AS test
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm test

# Production runtime stage
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=5000

# Run as non-root user for security
USER node

COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node src ./src

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/healthz || exit 1

CMD ["node", "src/index.js"]
