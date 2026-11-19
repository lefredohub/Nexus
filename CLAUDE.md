# NEXUS — consignes pour Claude Code

Application personnelle locale : React + Vite (`src/`), API Hono (`server/`), SQLite via `node:sqlite` (`data/nexus.db`), IA via `@anthropic-ai/sdk`. Détails et décisions : `docs/ARCHITECTURE.md`.

## Commandes
- `npm run dev` — API (4317) + interface (5317)
- `npm start` — build + serveur de production (4317) ; porte iPhone sur 4318 si activée
- `npm run check` — typecheck + tests (à lancer avant chaque commit)

## Règles du projet
- L'utilisateur est débutant : code lisible, commentaires en français sur le *pourquoi*, pas de magie.
- Toute donnée entrante passe par un schéma Zod de `shared/schemas.ts`.
- Schéma de base : **ajouter** une migration à la fin de `server/db/migrations.ts`, ne jamais modifier une migration existante.
- Historique des conversations IA en **ajout seul** : ne jamais modifier/supprimer un message stocké, garder `SYSTEM_PROMPT` statique et la liste d'outils stable (voir `server/ai/agent.ts`).
- Ne jamais appeler l'API Anthropic réelle dans les tests : utiliser le client simulé (`tests/ai.test.ts`).
- Ne jamais logguer ni renvoyer la clé API à l'interface.
- Accès distant (iPhone) : toute nouvelle route sensible doit utiliser `macOnly` dans `server/app.ts` ; la porte distante exige un appareil appairé (`server/auth.ts`).
- Interface en français, design sombre existant (tokens dans `src/styles.css`, composants dans `src/components/ui.tsx`).
