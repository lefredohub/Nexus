#!/bin/bash
# Lanceur NEXUS pour Mac : double-clique sur ce fichier dans le Finder.
# Il installe ce qui manque, compile l'interface, démarre NEXUS et ouvre le navigateur.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Télécharge la version LTS sur https://nodejs.org puis relance."
  read -r -p "Appuie sur Entrée pour fermer."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Première utilisation : installation des dépendances (une minute)…"
  npm install || { read -r -p "Échec de l'installation. Entrée pour fermer."; exit 1; }
fi

# Ouvre NEXUS dans le navigateur dès que le serveur répond.
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null http://127.0.0.1:4317/api/health; then open "http://localhost:4317"; exit 0; fi
    sleep 1
  done
) &

echo "Démarrage de NEXUS… (ferme cette fenêtre ou fais Ctrl+C pour l'arrêter)"
npm start
