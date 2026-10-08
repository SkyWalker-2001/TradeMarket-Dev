FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
EXPOSE 4000
WORKDIR /app/apps/api
USER node
CMD ["node", "dist/index.js"]
