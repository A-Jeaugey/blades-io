// Configuration pm2 du serveur (tâche T.3).
//
// À l'arrêt (pm2 delete / restart, SIGINT), le serveur prévient les joueurs
// et attend jusqu'à RESTART_NOTICE_MS avant de fermer les parties
// (server/src/shutdown.ts), puis attend les enregistrements de fin de
// partie. pm2 ne doit pas le tuer avant : par défaut, il envoie SIGKILL au
// bout de 1,6 s.
module.exports = {
  apps: [
    {
      name: "bladeio",
      script: "server/dist/index.js",
      // Dossier de la release (auto-deploy.sh) : .env et client/dist y sont.
      cwd: __dirname,
      env: { RESTART_NOTICE_MS: "60000" },
      kill_timeout: 75000,
    },
  ],
};
