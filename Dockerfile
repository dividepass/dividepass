# syntax=docker/dockerfile:1

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build

WORKDIR /app

# Dependências primeiro (cache layer)
COPY package.json package-lock.json ./
RUN npm ci

# Código-fonte
COPY . .

# Variáveis injetadas em BUILD time (Vite embute no bundle).
# No Dokploy: Build Args -> VITE_SUPABASE_URL, etc.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SITE_URL
ARG VITE_MERCADO_PAGO_BACK_URL

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_SITE_URL=$VITE_SITE_URL \
    VITE_MERCADO_PAGO_BACK_URL=$VITE_MERCADO_PAGO_BACK_URL

RUN npm run build

# ---------- Stage 2: runtime ----------
FROM nginx:1.27-alpine AS runtime

RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
