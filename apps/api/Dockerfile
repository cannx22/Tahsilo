# Tahsilo API — depo kökünden derlenir: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Derleme: tüm bağımlılıklar
FROM base AS build
RUN npm ci
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && npm run build

# Çalışma zamanı bağımlılıkları (prisma CLI migration için dependencies içinde)
FROM base AS prod-deps
RUN npm ci --omit=dev
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && npx prisma generate

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production STORAGE_DIR=/data/storage PORT=4000
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
# Bekleyen migration'lar her başlangıçta uygulanır (veri silmez)
CMD ["sh", "-c", "node /app/node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
