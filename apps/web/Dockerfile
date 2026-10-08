FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
WORKDIR /app/apps/web
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
