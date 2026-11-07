# Image unique : frontend (React/Vite, buildé en statique) + backend (Fastify),
# servis depuis le même process/port — l'architecture "/api" de l'app suppose une
# seule origine (pas de CORS, cookie de session SameSite=Strict).

FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS backend-build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=backend-build /app/dist ./dist
COPY --from=web-build /app/web/dist ./web/dist

# /app/data est monté en volume (voir docker-compose.yml) : la base SQLite doit
# survivre aux mises à jour de l'image, donc jamais dans une couche de l'image.
RUN mkdir -p /app/data

EXPOSE 3001

# "prisma migrate deploy" est idempotent : sans danger de le relancer à chaque démarrage.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
