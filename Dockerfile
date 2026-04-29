# Serveur Colyseus de blade.io, déployable sur Railway / Fly.io / n'importe quel Node host.
FROM node:20-alpine AS build
WORKDIR /app

# Installe les dépendances des workspaces nécessaires au serveur
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

# Copie des sources
COPY shared ./shared
COPY server ./server

# Build shared puis serveur
RUN npm run build:shared
RUN npm run build --workspace=@bladeio/server

# --- Runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json* ./
COPY --from=build /app/shared/package.json ./shared/
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist

RUN npm install --workspaces --include-workspace-root --omit=dev --no-audit --no-fund

EXPOSE 2567
CMD ["node", "server/dist/index.js"]
