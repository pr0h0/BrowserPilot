FROM oven/bun:1.4.0-slim
WORKDIR /app
# Workspace manifests first so the install layer caches across source edits.
COPY package.json bun.lock ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/backend/package.json apps/backend/
COPY apps/extension/package.json apps/extension/
COPY apps/cli/package.json apps/cli/
RUN bun install --frozen-lockfile --production --filter @browserpilot/backend
COPY packages/protocol packages/protocol
COPY apps/backend/src apps/backend/src
USER bun
ENV NODE_ENV=production HOST=0.0.0.0 PORT=9876
EXPOSE 9876
CMD ["bun", "apps/backend/src/index.ts"]
