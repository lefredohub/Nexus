# Architecture de NEXUS

Ce document explique comment NEXUS est construit et **pourquoi**. Il est écrit pour quelqu'un qui débute : chaque choix est justifié, et la fin du document décrit comment étendre l'application.

## Vue d'ensemble

```
┌──────────────────────── Navigateur (http://localhost:5317) ────────────────────────┐
│  React + TypeScript (src/)                                                          │
│  pages/ (un fichier par module) · components/ (vocabulaire visuel) · lib/ (API…)    │
└──────────────────────────────┬──────────────────────────────────────────────────────┘
                               │  JSON (REST)  +  flux SSE pour le chat
┌──────────────────────────────▼──────────────── Serveur local (127.0.0.1:4317) ─────┐
│  Hono (server/app.ts) ── security.ts : n'accepte que localhost                     │
│     │                                                                               │
│     ├── repos/        accès aux données, règles métier, validation (Zod)            │
│     ├── ai/           client Claude, boucle d'agent, outils, sorties structurées    │
│     ├── automations/  moteur de workflows, planificateur, gabarits                  │
│     └── integrations/ registre des sources de données externes                      │
│                               │                                                     │
│                      SQLite (data/nexus.db)        API Anthropic (seulement à la    │
│                                                    demande de l'utilisateur)        │
└─────────────────────────────────────────────────────────────────────────────────────┘
shared/schemas.ts : schémas de validation communs au serveur et à l'interface.
```

## Décisions techniques

### Une app web locale plutôt qu'une app « native »
Une interface web servie en local donne le meilleur rendu visuel (animations, typographie, graphiques) avec les outils les plus documentés. Elle est utilisable depuis n'importe quel navigateur du Mac. Une coque de type Electron/Tauri pourra être ajoutée plus tard sans toucher au reste.

### Vite + React plutôt que Next.js
Next.js mélange code serveur et code navigateur avec beaucoup de conventions implicites (rendu serveur, cache) — déroutant pour déboguer quand on débute. Ici, la séparation est nette : `src/` tourne dans le navigateur, `server/` sur la machine. Une commande (`npm run dev`) lance les deux.

### Hono pour l'API
Petit, rapide, typé, avec un excellent support du streaming (indispensable pour le chat). `createApp()` reçoit ses dépendances (base, secrets, client IA) : les tests utilisent une base en mémoire et un faux client IA.

### SQLite intégré à Node (`node:sqlite`)
- Une base relationnelle complète dans **un seul fichier** : sauvegarde = copie du fichier.
- Intégrée à Node ≥ 22.13 : **rien à compiler**, contrairement à `better-sqlite3` dont l'installation casse parfois sur Mac lors des changements de version de Node.
- Contrepartie : Node marque encore ce module « expérimental ». L'API utilisée est minimale (prepare/run/get/all/exec) et isolée dans `server/db/client.ts` : si elle change, un seul fichier est à adapter.
- La recherche plein texte utilise **FTS5** (inclus dans SQLite), alimenté automatiquement par des triggers SQL : impossible d'oublier de réindexer.

### SQL écrit à la main plutôt qu'un ORM
Un ORM ajoute une couche d'abstraction et sa propre documentation. Les requêtes sont ici lisibles directement, regroupées par domaine dans `server/repos/`. Les **migrations** sont versionnées dans `server/db/migrations.ts` (numéro stocké dans `PRAGMA user_version`).

### Zod comme source de vérité des données
Chaque entrée (formulaire, API, outil IA) est validée par un schéma de `shared/schemas.ts`. Les mêmes schémas génèrent le JSON Schema des outils donnés à Claude et le format des sorties structurées.

### Graphiques et graphe faits maison
Les graphiques sont des composants SVG (`src/components/charts.tsx`) : légers, cohérents avec le design, interactifs (réticule et infobulle au survol). Leur palette catégorielle a été **validée** (séparation pour les daltoniens, contraste sur fond sombre). Le Memory Graph utilise uniquement `d3-force` pour la physique ; le rendu est en SVG/React.

### Dépendances : volontairement peu nombreuses
Côté interface : React, TanStack Query (cache et rafraîchissement des données), Motion (animations), Lucide (icônes), d3-force, polices Geist (embarquées, fonctionnent hors ligne). Pas de routeur externe (`src/lib/router.tsx`, 60 lignes), pas de bibliothèque Markdown (`src/components/Markdown.tsx`, rendu sûr sans HTML injecté).

## L'intelligence artificielle

### Où tourne l'agent ?
NEXUS héberge **sa propre boucle d'agent** (API Messages d'Anthropic + outils locaux). Raison : les outils lisent et écrivent ta base SQLite locale, ils doivent donc s'exécuter sur ta machine. Une solution hébergée (Managed Agents) aurait demandé d'exposer ta base à l'extérieur.

### Le tour de conversation (`server/ai/agent.ts`)
1. Le message de l'utilisateur est enregistré avec un **contexte** : au premier message, une photo complète de la situation et la mémoire long terme ; ensuite, la date et le mode d'accès.
2. L'historique est envoyé à Claude **en streaming** ; le texte et le raisonnement résumé s'affichent au fil de l'eau.
3. Si Claude demande des outils, ils sont exécutés localement, leurs résultats enregistrés et renvoyés — jusqu'à une réponse finale (12 tours d'outils maximum par message).

### Historique en ajout seul
Les blocs renvoyés par l'API (texte, appels d'outils, **réflexion**) sont stockés tels quels et rejoués à l'identique. On ne modifie, ne raccourcit ni ne supprime jamais un message passé ; les instructions système et la liste d'outils restent identiques d'un tour à l'autre. C'est une exigence des modèles récents (sinon l'API refuse de réutiliser le raisonnement passé) et cela maximise le cache de prompt (coûts réduits). Conséquences concrètes :
- le contexte variable (date, mémoire) est placé **dans les messages utilisateur**, pas dans les instructions système ;
- un tour interrompu entre un appel d'outil et son résultat est réparé en **ajoutant** un résultat d'erreur ;
- un test vérifie que le 2ᵉ tour envoie exactement, octet pour octet, le préfixe du 1ᵉʳ.

### Accès contrôlé aux données
- Chaque outil est classé **lecture** ou **écriture** (`server/ai/tools.ts`).
- Réglage « Autoriser NEXUS AI à agir » désactivé : les outils d'écriture **refusent de s'exécuter** et l'IA reçoit une explication. (La liste d'outils déclarée ne change pas, pour respecter l'historique en ajout seul.)
- Toute entrée d'outil est revalidée par Zod avant exécution ; une entrée tronquée n'est jamais exécutée.
- Toute écriture est tracée dans le flux d'activité avec l'acteur « ai », et affichée dans la conversation sous forme de carte d'action.

### Mémoire persistante
- Table `memories` : faits, préférences, décisions, observations. L'IA les crée avec l'outil `remember` ; tu les vois, modifies et supprimes dans le panneau **Mémoire** de Nexus AI.
- Les souvenirs les plus importants sont injectés au début de chaque conversation ; les autres restent accessibles par recherche (`search_knowledge`).
- Les conversations elles-mêmes sont conservées en base.

### Sorties structurées
Briefing, analyse d'idée et audit de projet utilisent les **sorties structurées** : Claude doit renvoyer un JSON conforme à un schéma Zod. Les valeurs sont ensuite bornées (score 0-10, 0-100, priorité 1-3) par sécurité.

### Paramètres de requête
- Modèle par défaut : `claude-opus-5-5` (réglable).
- Réflexion adaptative avec résumé visible ; niveau d'effort réglable (`medium` par défaut).
- Repli automatique côté serveur (`fallbacks: "default"`) : si un filtre de sécurité refuse une requête à tort, l'API la relance sur un modèle de repli adapté.
- Erreurs traduites en messages clairs (clé invalide, limite de débit avec délai, surcharge, réseau) ; le SDK réessaie automatiquement les erreurs temporaires (3 fois).

## Sécurité

- Le serveur écoute **uniquement sur 127.0.0.1** : invisible depuis le réseau.
- Pas d'authentification : sur une app strictement locale, un mot de passe ajouterait de la friction sans protection réelle (quiconque a accès à ta session a accès au fichier de données). Le vrai risque — un site web malveillant ouvert dans ton navigateur qui appellerait `localhost` — est bloqué par `server/security.ts` : vérification de l'en-tête `Host` (anti « DNS rebinding »), de l'`Origin` et du type JSON pour toute modification (anti-CSRF).
- Clé API : variable d'environnement ou `data/secrets.json` en permissions `600`, jamais renvoyée à l'interface (seule une version masquée l'est).
- Gabarits d'automatisation : simple lecture de chemins (`{{trigger.task.title}}`), aucune évaluation de code, aucun accès aux propriétés héritées.
- Le rendu Markdown des réponses IA ne génère que des éléments React (pas d'injection HTML).

## Automatisations

- **Déclencheurs** : manuel ; planifié (toutes les N minutes/heures/jours, à heure fixe) ; événement (`task.created`, `task.completed`, `project.created`, `idea.created`, `workout.logged`, `transaction.logged`).
- **Étapes** (`server/automations/steps.ts`) : créer une tâche, une note, notifier, mémoriser, enregistrer une métrique, demander à Claude, requête HTTP, condition.
- **Données** : chaque étape lit le déclencheur et les sorties des étapes précédentes via des gabarits.
- **Simulation** : résout les gabarits et valide chaque configuration sans exécuter les étapes à effet.
- **Anti-boucle** : un événement émis pendant une automatisation ne déclenche pas d'autre automatisation (`AsyncLocalStorage` dans `server/events.ts`).
- Les automatisations planifiées tournent tant que NEXUS est lancé.

## Étendre NEXUS

### Ajouter un champ ou une table
1. Ajoute une **nouvelle** entrée à la fin de `MIGRATIONS` dans `server/db/migrations.ts` (ne modifie jamais une migration existante).
2. Mets à jour le schéma Zod dans `shared/schemas.ts`.
3. Mets à jour le dépôt dans `server/repos/`, puis la route dans `server/app.ts`.

### Ajouter un outil à l'IA
Dans `server/ai/tools.ts`, ajoute un `def({...})` : nom, description (c'est ce que lit Claude pour décider de l'utiliser), `access: 'read' | 'write'`, schéma Zod et fonction `run`. Ajoute un libellé dans `TOOL_LABELS` (`src/pages/Assistant.tsx`).
⚠️ Ajouter un outil modifie la liste d'outils : les conversations existantes continuent de fonctionner, mais leur raisonnement passé ne sera pas réutilisé par l'API (comportement prévu, sans erreur).

### Ajouter une étape d'automatisation (ex. Slack, Notion, un autre agent)
Dans `server/automations/steps.ts`, crée un `define({...})` avec un schéma de configuration, une liste de champs (le formulaire de l'interface est généré automatiquement) et une fonction `run`, puis ajoute-le à `STEP_TYPES`. Les secrets nécessaires iront dans `SecretStore`.

### Ajouter une intégration de données (ex. Strava)
Les tables `transactions`, `workouts` et `metric_entries` ont une colonne `source` et un `external_id` avec contrainte d'unicité : une synchronisation peut être relancée sans créer de doublons. Implémente la synchronisation dans `server/integrations/`, enregistre-la dans `INTEGRATIONS`, et appelle les fonctions `createWorkout(db, …, 'strava', idStrava)` existantes.

## Tests

`npm test` lance 50 tests (Vitest) sur les parties critiques :
- **données** : migrations, progression et santé des projets, objectifs, conversion idée → projet, liens, graphe, recherche plein texte, séries d'habitudes, import CSV sans doublons ;
- **IA** (avec un client Claude simulé, sans réseau ni coût) : boucle d'outils, persistance, historique en ajout seul, mode lecture seule, réparation des tours interrompus, entrées tronquées, refus, traduction des erreurs ;
- **automatisations** : gabarits, simulation sans effet, conditions, erreurs, appels HTTP, planification, événements sans boucle ;
- **API** : protections de sécurité, validation, parcours complet, gestion de la clé, réinitialisation avec sauvegarde.

### Ce qui a été vérifié pendant la construction, et ce qui ne l'a pas été
- ✅ Tests automatisés ci-dessus, vérification TypeScript, build de production.
- ✅ Parcours réels dans un navigateur (Chromium) : onboarding, capture rapide, tâches, projet complet (étapes, risques, dépenses), idée → projet, graphe et notes, habitudes, import CSV, workflow (simulation puis exécution), refus de clé invalide ; affichage mobile sans débordement ; aucune erreur dans la console.
- ✅ Chaîne IA complète avec le **vrai SDK Anthropic** branché sur un **serveur API simulé** local : vérification de clé, briefing, analyse d'idée, audit de projet, chat en streaming avec appel d'outil, à travers le proxy de développement, deux messages dans la même conversation.
- ⚠️ **Non testé : appels réels à l'API Anthropic** (aucune clé disponible pendant la construction, et pour ne rien dépenser sans ton accord). Le format des requêtes suit la documentation officielle du SDK, mais le premier vrai test se fera avec ta clé : commence par « Tester » dans Réglages (gratuit), puis un premier message court.
- ⚠️ Développé et testé sous Linux. Le code n'utilise rien de spécifique à un système, mais le premier lancement sur ton Mac reste à faire.
