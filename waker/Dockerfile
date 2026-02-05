FROM node:20-alpine
RUN apk add --no-cache procps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY index.js gpu-monitor.js ./
EXPOSE 18080
CMD ["node","index.js"]
