FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
USER node
ENV NODE_ENV=production PORT=3000 COMMUNITY_DB=/data/community.sqlite
EXPOSE 3000
CMD ["node", "server/start.mjs"]
