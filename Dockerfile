# Build stage: the output is plain JS, so it runs on the native build platform even for multi-arch images.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json tsconfig.client.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# Runtime stage: production dependencies only.
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY data ./data
USER node
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
