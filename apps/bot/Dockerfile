# Сборка из корня монорепозитория: docker build -f apps/bot/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build -w @nomer/bot \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /repo/apps/bot/dist ./apps/bot/dist
WORKDIR /repo/apps/bot
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
