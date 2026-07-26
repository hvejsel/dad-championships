# The app and the shared championships, in one small container.
# The app is static files; the server is Node built-ins plus web-push, which
# does the signing and encryption a push message needs.
FROM node:22-alpine

WORKDIR /app

# dependencies first, so a change to the app does not rebuild them
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000

# the championships live on a mounted disk, not in the container
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
