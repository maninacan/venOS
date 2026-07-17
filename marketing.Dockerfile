# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# PUBLIC_ values are compiled into the static Astro bundle at build time. CI passes
# these via --build-arg (sourced from Doppler); changing them rebuilds the site.
ARG PUBLIC_POSTHOG_PROJECT_TOKEN
ARG PUBLIC_POSTHOG_HOST

# Copy workspace manifests first so the npm ci layer is cached unless deps change.
COPY package*.json .npmrc ./
COPY apps/venview-api/package.json ./apps/venview-api/
COPY apps/client/package.json ./apps/client/
COPY apps/marketing/package.json ./apps/marketing/
COPY apps/super-admin-portal/package.json ./apps/super-admin-portal/
COPY libs/common-components/package.json ./libs/common-components/
COPY libs/data/package.json ./libs/data/

RUN npm ci --legacy-peer-deps

COPY . .

# Expose PUBLIC_ vars to the Astro build (deferred so value changes don't bust the
# npm ci layer above).
ENV PUBLIC_POSTHOG_PROJECT_TOKEN=$PUBLIC_POSTHOG_PROJECT_TOKEN
ENV PUBLIC_POSTHOG_HOST=$PUBLIC_POSTHOG_HOST

# Astro static build → dist/apps/marketing (per apps/marketing/astro.config.mjs outDir).
RUN npx nx build marketing

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /app/dist/apps/marketing /usr/share/nginx/html
COPY deploy/nginx-static.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
