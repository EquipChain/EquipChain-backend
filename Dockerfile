FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm test

FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/index.js ./index.js
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

# Persistent state (job queue snapshots). Owned by the unprivileged runtime
# user so QUEUE_PERSIST_PATH can write inside the mounted volume.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node

EXPOSE 3000

# Container-level liveness: if the event loop wedges (or the process deadlocks
# outside Node's own crash paths), the orchestrator replaces the container.
# wget is present in alpine images; the node user can run it without root.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live > /dev/null 2>&1 || exit 1

CMD ["node", "index.js"]
