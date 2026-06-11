#!/usr/bin/env bash
# MaxDoo LibreChat deploy — run ON the deployment host (178.105.34.35).
#
# Builds the app, RAG (PaddleOCR) and codeapi images from a clean git
# checkout of the fork branch, pins the tag (maxdoo-<short sha>) into the
# compose .env, deploys, and idempotently seeds predefined agents.
#
# Usage:  bash deploy.sh [git-ref]      (default: origin/codex/upload-file-search)

set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/beneditomonteiro/LibreChat.git}
BRANCH=${BRANCH:-codex/upload-file-search}
REF=${1:-origin/$BRANCH}
SRC_DIR=${SRC_DIR:-/home/odoo/librechat-maxai/src}
COMPOSE_DIR=${COMPOSE_DIR:-/home/odoo/librechat-maxai}

echo "==> Syncing source ($REPO_URL @ $REF)"
if [ ! -d "$SRC_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
fi
git -C "$SRC_DIR" fetch origin "$BRANCH"
git -C "$SRC_DIR" checkout -q "$BRANCH"
git -C "$SRC_DIR" reset --hard "$REF"
SHA=$(git -C "$SRC_DIR" rev-parse --short=12 HEAD)
TAG="maxdoo-$SHA"
echo "==> Building images at revision $SHA (tag: $TAG)"

docker build -t "librechat-maxdoo:$TAG" "$SRC_DIR"
docker build -t "librechat-rag-paddleocr:$TAG" "$SRC_DIR/deploy-maxdoo/rag-custom"
docker build -t "librechat-codeapi:$TAG" "$SRC_DIR/deploy-maxdoo/codeapi"

echo "==> Pinning MAXDOO_TAG=$TAG in $COMPOSE_DIR/.env"
sed -i '/^MAXDOO_TAG=/d' "$COMPOSE_DIR/.env"
echo "MAXDOO_TAG=$TAG" >> "$COMPOSE_DIR/.env"

echo "==> Installing compose file from repo"
cp "$SRC_DIR/deploy-maxdoo/docker-compose.yml" "$COMPOSE_DIR/docker-compose.yml"

echo "==> Deploying"
docker compose --project-directory "$COMPOSE_DIR" up -d --remove-orphans

echo "==> Waiting for app health"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:3080/health; then
    echo "app healthy"
    break
  fi
  [ "$i" = 60 ] && { echo "ERROR: app did not become healthy"; exit 1; }
  sleep 2
done

echo "==> Seeding predefined agents (idempotent)"
docker compose --project-directory "$COMPOSE_DIR" exec -T librechat \
  node /app/scripts/seed-doc-agent.js

echo "==> Deployed image IDs"
docker images --format '{{.Repository}}:{{.Tag}}  {{.ID}}' | grep "$TAG"
echo "==> Done. Revision $SHA is live."
