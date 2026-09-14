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

CMD ["node", "index.js"]
