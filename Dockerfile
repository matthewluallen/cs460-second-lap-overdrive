FROM node:22.23.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node bench ./bench
COPY --chown=node:node platform ./platform
COPY --chown=node:node instructor-drive ./instructor-drive
COPY --chown=node:node slipstream ./slipstream
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "platform/server.mjs", "--slipstream", "--container"]
