# Сборка из корня монорепозитория: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci --no-audit --no-fund && npm run build -w @nomer/web

# Статика + прокси /api и /cards на API: Mini App и API на одном origin, без CORS.
FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
