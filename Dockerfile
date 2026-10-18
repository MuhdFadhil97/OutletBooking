# Staging / production API image (Railway, Render, ...). Build context = repo root.
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

# Only the API and the two packages it imports. Mobile and web contribute just their package.json so the lockfile still matches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
RUN pnpm install --filter "api..." --frozen-lockfile

EXPOSE 3000
CMD ["pnpm", "--filter", "api", "start"]
