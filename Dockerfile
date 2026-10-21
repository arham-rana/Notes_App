# syntax=docker/dockerfile:1

# ---- Install dependencies and bundle the editor ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY build.mjs ./
COPY client-src ./client-src
COPY shared ./shared
COPY public ./public
# Bundles the collaborative editor and KaTeX (maths) into public/js/vendor and public/vendor.
RUN npm run build && npm prune --omit=dev

# ---- Runtime image ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./
COPY src ./src
COPY shared ./shared
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
