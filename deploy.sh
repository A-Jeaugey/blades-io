#!/bin/bash
set -e

REPO="https://github.com/A-Jeaugey/blades-io.git"
BRANCH="main"
DIR="$HOME/bladeio"

echo "=== [1/5] Node 22 ==="
# Colyseus 0.18 exige Node 22 ou plus.
if ! node --version 2>/dev/null | grep -qE "v(2[2-9]|[3-9][0-9])"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
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

echo "=== [4/5] Build, tests, release et démarrage ==="
# Même chemin que les mises à jour : release construite à part, bascule du
# lien ~/bladeio-current, pm2 avec arrêt en douceur (ecosystem.config.js).
# Sous-chemin du client : BLADEIO_BASE_PATH (par défaut la racine).
chmod +x "$DIR/auto-deploy.sh"
if ! BLADEIO_REPO_DIR="$DIR" BLADEIO_BRANCH="$BRANCH" "$DIR/auto-deploy.sh" --force; then
  echo "Échec : voir ~/bladeio-releases/deploy.log"
  exit 1
fi
tail -n 3 "$HOME/bladeio-releases/deploy.log"

echo "=== [5/5] PM2 au démarrage de la machine ==="
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
echo "Déployer main  : ~/bladeio/auto-deploy.sh (journal : ~/bladeio-releases/deploy.log)"
echo ""
echo "Le serveur sert aussi le client en statique sur le même port."
echo "Prochaine étape : Caddy pour le HTTPS (voir Caddyfile à la racine)."
