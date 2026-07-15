# DCS Assessment Command Center — Docker image
# Zero-dependency Node server: static app + shared-workspace API.
# Workspace data persists in /data — mount a volume there.

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
COPY index.html server.js ./
COPY css/ ./css/
COPY js/ ./js/

RUN mkdir -p /data && \
    addgroup -S dcs && adduser -S dcs -G dcs && \
    chown -R dcs:dcs /app /data
USER dcs

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
