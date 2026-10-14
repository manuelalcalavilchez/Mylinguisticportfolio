# Imagen única: la API (Express) sirve también el frontend compilado.
# Pensada para servidores pequeños (1 vCPU / 1-2 GB RAM).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build -w apps/api && npm run build -w apps/web
# Solo dependencias de producción de la API para la imagen final
RUN npm ci --omit=dev -w apps/api --include-workspace-root=false

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/web \
    STORAGE_DIR=/data/uploads \
    NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
RUN mkdir -p /data/uploads && chown -R node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./api/dist
COPY --from=build --chown=node:node /app/apps/api/migrations ./api/migrations
COPY --from=build --chown=node:node /app/apps/web/dist ./web
USER node
WORKDIR /app/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
