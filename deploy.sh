#!/bin/bash
set -e

REPO="https://github.com/A-Jeaugey/blades-io.git"
BRANCH="main"
DIR="$HOME/bladeio"

echo "=== [1/5] Node 20 ==="
if ! node --version 2>/dev/null | grep -qE "v(2[0-9]|[3-9][0-9])"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs git
fi
node --version

echo "=== [2/5] pm2 ==="
sudo npm install -g pm2 2>/dev/null || true

echo "=== [3/5] Clone / update ==="
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" pull origin "$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$DIR"
fi

echo "=== [4/5] Build serveur + client ==="
cd "$DIR"
npm install --no-fund --no-audit
npm run build:shared
npm run build --workspace=@bladeio/server
# Sous-chemin configurable (par défaut : racine du domaine).
# Ex : BLADEIO_BASE_PATH=/spinning-blades/ pour servir sous un sous-chemin.
BASE_PATH="${BLADEIO_BASE_PATH:-/}"
echo "building client with base path: $BASE_PATH"
VITE_BASE_PATH="$BASE_PATH" npm run build --workspace=@bladeio/client
echo "client/dist prêt → servi directement par le serveur"

echo "=== [5/5] PM2 ==="
pm2 delete bladeio 2>/dev/null || true
pm2 start server/dist/index.js --name bladeio --cwd "$DIR"
pm2 save --force
pm2 startup systemd | grep "sudo env" | bash || true

echo ""
echo "=== DONE ==="
sleep 1
curl -s http://localhost:2567/healthz && echo " — serveur OK"
echo ""
echo "Port           : 2567"
echo "Test local     : curl http://localhost:2567/healthz"
echo "Logs           : pm2 logs bladeio"
echo "Redémarrer     : pm2 restart bladeio"
echo ""
echo "Le serveur sert aussi le client en statique sur le même port."
echo "Prochaine étape : Caddy pour le HTTPS (voir Caddyfile à la racine)."
