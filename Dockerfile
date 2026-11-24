FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public build-time config for the static RPS page. Empty addresses still build;
# that page then shows the setup steps. Practice blackjack does not read these.
ARG VITE_RPS_CHAIN_ID=31337
ARG VITE_RPS_RPC_URL=http://127.0.0.1:8545
ARG VITE_RPS_ADDRESS=
ARG VITE_USDC_ADDRESS=
ENV VITE_RPS_CHAIN_ID=$VITE_RPS_CHAIN_ID
ENV VITE_RPS_RPC_URL=$VITE_RPS_RPC_URL
ENV VITE_RPS_ADDRESS=$VITE_RPS_ADDRESS
ENV VITE_USDC_ADDRESS=$VITE_USDC_ADDRESS
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/dist/web
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
