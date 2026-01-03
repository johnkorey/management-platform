# =====================================================
# Evilginx Management Platform - Single Container
# Backend serves frontend static files directly
# =====================================================

FROM node:20-alpine

WORKDIR /app

# Copy package files first for better caching
COPY backend/package*.json ./backend/

# Install dependencies
WORKDIR /app/backend
RUN npm ci --only=production

# Copy backend source
COPY backend/ ./

# Copy frontend files
WORKDIR /app
COPY frontend/ ./frontend/

# Set working directory back to backend
WORKDIR /app/backend

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "server.js"]

