FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY assets ./assets
RUN npm ci --no-audit --no-fund
COPY . .

# Vite inlines these at build time — pass via --build-arg / compose.
ARG VITE_KIMI_AUTH_URL
ARG VITE_APP_ID
ENV VITE_KIMI_AUTH_URL=$VITE_KIMI_AUTH_URL
ENV VITE_APP_ID=$VITE_APP_ID

RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/boot.js"]
