# Runs the Controlled Egress Proxy (src/browser/controlled-egress-proxy.ts)
# as its own container — see docker-compose.yml in this directory for how
# its network is restricted to the browser-worker container only, and its
# own egress path (to real targets) kept on a separate network.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
EXPOSE 8080
CMD ["node", "dist/browser/run-controlled-egress-proxy.js"]
