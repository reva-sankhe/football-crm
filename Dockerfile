# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Enable corepack to use the pnpm version from package.json/corepack
RUN corepack enable

# Copy workspace config files first (for better layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json ./

# Copy all package.json files for every workspace package
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/football-crm/package.json ./artifacts/football-crm/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY scripts/package.json ./scripts/

# Install all dependencies (frozen lockfile = fast, reproducible)
RUN pnpm install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Declare build-time env vars for Vite (Railway passes service vars as Docker build args)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Build only the two artifacts we need for production
RUN pnpm --filter @workspace/football-crm run build
RUN pnpm --filter @workspace/api-server run build

# ─── Stage 2: Run ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

# The api-server bundle is self-contained (esbuild bundles all deps).
# We only need the compiled output files.
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/football-crm/dist/public ./artifacts/football-crm/dist/public

EXPOSE 3000

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
