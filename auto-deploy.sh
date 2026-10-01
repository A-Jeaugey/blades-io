#!/bin/bash
# Déploiement (tâche T.3). Avant : chaque push sur main était déployé dans
# les 30 s, en reconstruisant sur place puis en redémarrant sans préavis ;
# un build cassé arrêtait le serveur en plein `git reset`.
#
# Maintenant :
#  1. la dernière version de la branche est construite dans un dossier de
#     release à part (npm ci, build complet, tests) : la version en ligne
#     n'est pas touchée tant que tout n'a pas réussi ;
#  2. bascule atomique du lien « current » vers la nouvelle release ;
#  3. redémarrage en douceur : le serveur en place prévient les joueurs et
#     ferme au plus tard 60 s après (cf. server/src/shutdown.ts et
#     ecosystem.config.js) ;
#  4. vérification de santé (/healthz) ; en cas d'échec, retour à la
#     release précédente.
#
# Déclenchement : à heure creuse par le timer systemd
# (systemd/bladeio-autodeploy.timer), ou à la main :
#   ./auto-deploy.sh           déploie si la branche a bougé (une version
#                              déjà en échec n'est pas retentée)
#   ./auto-deploy.sh --force   reconstruit et redéploie quand même
#
# Variables (valeurs par défaut) :
#   BLADEIO_BRANCH=main
#   BLADEIO_REPO_DIR=$HOME/bladeio             clone git (fetch uniquement)
#   BLADEIO_RELEASES_DIR=$HOME/bladeio-releases
#   BLADEIO_CURRENT=$HOME/bladeio-current      lien vers la release en ligne
#   BLADEIO_ENV_FILE=$BLADEIO_REPO_DIR/.env    lié dans chaque release
#   BLADEIO_HEALTH_URL=http://localhost:2567/healthz
#   BLADEIO_HEALTH_WAIT=30                     secondes d'attente maximum
#   BLADEIO_KEEP=3                             releases gardées sur disque
#   BLADEIO_BASE_PATH=$VITE_BASE_PATH ou /     sous-chemin du client (Vite)
#   BLADEIO_LOG=$BLADEIO_RELEASES_DIR/deploy.log

set -euo pipefail

BRANCH="${BLADEIO_BRANCH:-main}"
REPO="${BLADEIO_REPO_DIR:-$HOME/bladeio}"
RELEASES="${BLADEIO_RELEASES_DIR:-$HOME/bladeio-releases}"
CURRENT="${BLADEIO_CURRENT:-$HOME/bladeio-current}"
ENV_FILE="${BLADEIO_ENV_FILE:-$REPO/.env}"
HEALTH_URL="${BLADEIO_HEALTH_URL:-http://localhost:2567/healthz}"
HEALTH_WAIT="${BLADEIO_HEALTH_WAIT:-30}"
KEEP="${BLADEIO_KEEP:-3}"
BASE_PATH="${BLADEIO_BASE_PATH:-${VITE_BASE_PATH:-/}}"
LOG="${BLADEIO_LOG:-$RELEASES/deploy.log}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$RELEASES"
exec >> "$LOG" 2>&1

# Un seul déploiement à la fois (le timer peut tomber pendant un déploiement
# manuel).
exec 9> "$RELEASES/.lock"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] déploiement déjà en cours, abandon"
  exit 0
fi

log() { echo "[$(date '+%F %T')] $*"; }

git -C "$REPO" fetch --quiet origin "$BRANCH"
SHA=$(git -C "$REPO" rev-parse "origin/$BRANCH")
# Le clone ne sert plus qu'à récupérer le code ; on le garde à jour pour que
# le prochain lancement utilise la dernière version de ce script (les
# fichiers ignorés, .env compris, ne sont pas touchés).
git -C "$REPO" reset --hard --quiet "$SHA"
# -e : vide si le lien n'existe pas encore (premier déploiement).
LIVE=$(readlink -e "$CURRENT" 2>/dev/null || true)
if [ "$FORCE" = 0 ] && [ -n "$LIVE" ] && [ "$(basename "$LIVE")" = "$SHA" ]; then
  exit 0
fi
# Version déjà en échec (build, tests ou santé) : on ne la retente pas à
# chaque passage du timer, un échec au démarrage coupant les parties pour
# rien. Un nouveau commit ou --force relance.
FAILED="$RELEASES/$SHA.failed"
if [ "$FORCE" = 0 ] && [ -f "$FAILED" ]; then
  exit 0
fi

log "=== déploiement de $BRANCH @ $SHA (en ligne : ${LIVE:-aucune}) ==="

# 1. Construction à part.
REL="$RELEASES/$SHA"
BUILD="$REL.building"
rm -rf "$BUILD"
mkdir -p "$BUILD"
git -C "$REPO" archive "$SHA" | tar -x -C "$BUILD"
[ -f "$ENV_FILE" ] && ln -sf "$ENV_FILE" "$BUILD/.env"
# Étapes enchaînées par && : dans la condition d'un if, bash ignore set -e,
# et un build client cassé suivi de tests verts passerait pour un succès.
if ! (
  cd "$BUILD" &&
    npm ci --no-fund --no-audit --prefer-offline &&
    npm run build:shared &&
    npm run build --workspace=@bladeio/server &&
    VITE_BASE_PATH="$BASE_PATH" npm run build --workspace=@bladeio/client &&
    npm test
); then
  log "ÉCHEC du build ou des tests : la version en ligne reste ${LIVE:-aucune}"
  rm -rf "$BUILD"
  touch "$FAILED"
  exit 1
fi
rm -rf "$REL"
mv "$BUILD" "$REL"
rm -f "$FAILED"
log "build et tests OK"

# 2. et 3. Bascule atomique, puis redémarrage. `pm2 delete` attend l'arrêt
# en douceur de l'ancien serveur (jusqu'au kill_timeout d'ecosystem.config.js).
# `9>&-` : le démon pm2, s'il démarre ici, ne doit pas hériter du verrou,
# sinon il le garderait et bloquerait tous les déploiements suivants.
switch_to() {
  ln -sfn "$1" "$CURRENT.next"
  mv -Tf "$CURRENT.next" "$CURRENT"
  pm2 delete bladeio > /dev/null 2>&1 9>&- || true
  pm2 start "$CURRENT/ecosystem.config.js" 9>&-
  pm2 save --force > /dev/null 9>&-
}

healthy() {
  local i
  for ((i = 0; i < HEALTH_WAIT; i += 2)); do
    if curl -fsS --max-time 2 "$HEALTH_URL" > /dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

switch_to "$REL"

# 4. Santé, sinon retour arrière.
if healthy; then
  log "en ligne : $SHA"
else
  log "ÉCHEC de la vérification de santé ($HEALTH_URL)"
  touch "$FAILED"
  if [ -n "$LIVE" ] && [ -d "$LIVE" ] && [ "$LIVE" != "$REL" ]; then
    log "retour à $(basename "$LIVE")"
    switch_to "$LIVE"
    if healthy; then log "retour arrière OK"; else log "le retour arrière ne répond pas non plus"; fi
    rm -rf "$REL"
  fi
  exit 1
fi

# Ménage : on garde les KEEP releases les plus récentes (la version en
# ligne et la précédente comprises).
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  old="${old%/}"
  if [ "$old" != "$REL" ] && [ "$old" != "$LIVE" ]; then
    rm -rf "$old"
    log "release supprimée : $(basename "$old")"
  fi
done
