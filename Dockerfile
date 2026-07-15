# DCS Assessment Command Center v2 — authenticated Node application
FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
RUN apk add --no-cache wget && addgroup -S dcs && adduser -S dcs -G dcs
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=dcs:dcs package.json server.js index.html ./
COPY --chown=dcs:dcs src/ ./src/
COPY --chown=dcs:dcs css/ ./css/
COPY --chown=dcs:dcs js/ ./js/
USER dcs
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server.js"]
