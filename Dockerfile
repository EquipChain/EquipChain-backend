# Stage 1
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit-dev --no-audit --no-fund || npm install --omit-dev --no-audit --no-fund

# Stage 2
FROM node:20-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*
RUN groupadd -r appuser && useradd -r -g appuser appuser
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "require(http).get(http://localhost:3000/health,r=>process.exit(r.statusCode===200?0:1))"
USER appuser
EXPOSE 3000
ENTRYPOINT ["dumb-init","--"]
CMD ["node","index.js"]