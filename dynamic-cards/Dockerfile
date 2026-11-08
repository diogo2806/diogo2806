FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --chown=node:node portfolio.json ./portfolio.json
COPY --chown=node:node dynamic-cards ./dynamic-cards
RUN node --test dynamic-cards/server.test.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dynamic-cards/server.mjs"]
