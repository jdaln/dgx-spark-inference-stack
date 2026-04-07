FROM node:20-alpine

WORKDIR /app

COPY request-validator/package.json ./
RUN npm install --omit=dev

RUN mkdir -p /shared
COPY shared/models-config.mjs /shared/models-config.mjs
COPY request-validator/index.js request-validator/healthcheck.js ./

CMD ["node", "index.js"]

