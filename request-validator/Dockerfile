FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js healthcheck.js ./

EXPOSE 18081

CMD ["node", "index.js"]

