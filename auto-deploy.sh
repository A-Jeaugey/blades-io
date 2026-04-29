#!/bin/bash
# Auto-deploy : pull la branche, rebuild, restart pm2 si y'a du nouveau.
# Destiné à être lancé périodiquement (systemd timer ou cron).

set -e
BRANCH="main"
DIR="$HOME/bladeio"
LOG="$DIR/auto-deploy.log"

mkdir -p "$DIR"
exec >> "$LOG" 2>&1

cd "$DIR"

LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "none")
git fetch --quiet origin "$BRANCH"
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo ""
echo "=== [$(date '+%F %T')] new commits: $LOCAL → $REMOTE ==="

git reset --hard "origin/$BRANCH"

npm install --no-fund --no-audit
npm run build:shared
npm run build --workspace=@bladeio/server
npm run build --workspace=@bladeio/client
pm2 restart bladeio

echo "=== [$(date '+%F %T')] deployed $REMOTE ==="
