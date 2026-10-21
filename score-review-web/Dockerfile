FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    SCORE_REVIEW_API_BASE=same-origin

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server.js cloud-store.js event-id.js index.html auto-refresh.js prize-table-layout.js ./
COPY event-template-cover.jpg ./event-template-cover.jpg
COPY event-assets ./event-assets

EXPOSE 8080
CMD ["node", "server.js"]
