FROM node:20-alpine@sha256:d63c387675b0ec5d7ef0c15b03691ac9f82803a8b30c87de3ce8a16960831cbc

WORKDIR /app

COPY request-validator/package.json ./
RUN npm install --omit=dev

RUN mkdir -p /shared
COPY models.json /models.json
COPY shared/models-config.mjs /shared/models-config.mjs
COPY request-validator/index.js request-validator/index.test.js request-validator/healthcheck.js ./

CMD ["node", "index.js"]

