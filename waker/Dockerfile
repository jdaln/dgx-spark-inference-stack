FROM node:20-alpine@sha256:d63c387675b0ec5d7ef0c15b03691ac9f82803a8b30c87de3ce8a16960831cbc
RUN apk add --no-cache procps
WORKDIR /app
COPY waker/package.json waker/package-lock.json* ./
RUN npm ci --omit=dev
RUN mkdir -p /shared
COPY shared/models-config.mjs /shared/models-config.mjs
COPY waker/index.js waker/gpu-monitor.js ./
CMD ["node","index.js"]
