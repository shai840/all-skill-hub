FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# templates/hub seeds an empty volume on first boot; after that the volume (with its own git history) is the source of truth.
ENV NODE_ENV=production ALL_SKILL_HUB=/data/hub ALL_SKILL_HOST=0.0.0.0
CMD ["node", "server/http.mjs"]
