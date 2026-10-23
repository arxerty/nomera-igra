# Сборка из корня монорепозитория: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /repo
COPY . .
RUN npm ci --no-audit --no-fund \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @nomer/api \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
# Миграции применяются при каждом старте (идемпотентно), затем запускается сервер.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
