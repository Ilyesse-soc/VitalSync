# --- Stage 1: install + lint + tests (qualité et sécurité en amont)
# Important : ce stage doit s'exécuter à CHAQUE build (exigence du sujet).
FROM node:20-alpine AS test
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run lint && npm test

# On retire les devDependencies pour préparer un runtime propre
RUN npm prune --omit=dev

# --- Stage 2: runtime (prod)
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

COPY --from=test /app/package.json ./package.json
COPY --from=test /app/package-lock.json ./package-lock.json
COPY --from=test /app/node_modules ./node_modules
COPY --from=test /app/server.js ./server.js

USER node
EXPOSE 3000
CMD ["node", "server.js"]
