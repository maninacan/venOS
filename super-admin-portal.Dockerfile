# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# VITE_ values are compiled into the static bundle at build time. CI passes these
# via --build-arg (sourced from Doppler); changing them rebuilds the app.
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_MEMBER

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

# Expose VITE_ vars to the Vite build (deferred so value changes don't bust the
# npm ci layer above). `nx build` runs `vite build` (production mode by default).
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_MEMBER=$VITE_MEMBER

RUN npx nx build super-admin-portal

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /app/apps/super-admin-portal/dist /usr/share/nginx/html
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
