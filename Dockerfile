# The app and the shared championships, in one small container.
# No build step and no dependencies — the app is static files and the server is
# one file of Node built-ins.
FROM node:22-alpine

WORKDIR /app
COPY . .

ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000

# the championships live on a mounted disk, not in the container
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
