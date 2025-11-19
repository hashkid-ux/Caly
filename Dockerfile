FROM node:18-alpine

WORKDIR /app

# Copy backend files
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/

# Install dependencies
WORKDIR /app/backend
RUN npm install

# Copy source code
COPY backend/src ./src

# Build TypeScript
RUN npm run build

WORKDIR /app

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "backend/dist/index.js"]
