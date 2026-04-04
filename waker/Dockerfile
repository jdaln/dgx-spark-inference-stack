FROM node:20-alpine
RUN apk add --no-cache procps
WORKDIR /app
COPY waker/package.json waker/package-lock.json* ./
RUN npm ci --omit=dev
RUN mkdir -p /shared
COPY shared/models-config.mjs /shared/models-config.mjs
COPY waker/index.js waker/gpu-monitor.js ./
EXPOSE 18080
CMD ["node","index.js"]
