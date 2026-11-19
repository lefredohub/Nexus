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

### Deux cerveaux au choix : local (Ollama) ou Claude
`server/ai/providers.ts` aiguille chaque appel vers le fournisseur choisi dans les Réglages :
- **Ollama** (`server/ai/ollama.ts`, par défaut) : IA locale gratuite. NEXUS parle à l'API native d'Ollama (`/api/chat` en streaming NDJSON, `/api/tags`, `/api/show`, `/api/pull`) avec `fetch`, sans dépendance. Contexte élargi à 16 384 tokens (nos instructions et 26 outils dépassent les 4 096 par défaut), modèle gardé en mémoire 30 min (`keep_alive`) pour que Jarvis réponde vite. Les capacités du modèle (`tools`, `thinking`) sont lues via `/api/show` : on n'envoie ni outils ni réflexion à un modèle qui ne les gère pas. Sorties structurées via `format` (schéma JSON) avec un second essai si le petit modèle se trompe.
- **Claude** : API Messages d'Anthropic, comme décrit ci-dessous.

**Un seul format d'historique.** Les réponses d'Ollama sont converties dans le format de blocs de Claude (texte, `tool_use`, `tool_result`), avec des identifiants générés. On peut donc changer d'IA au milieu d'une conversation. La réflexion d'un modèle local est stockée sous un type propre à NEXUS (`local_thinking`), affichée dans l'interface mais jamais envoyée à Claude.

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
- **Deux portes.** La porte locale (`127.0.0.1:4317`) sert le Mac lui-même, sans mot de passe : quiconque utilise ta session Mac a de toute façon accès au fichier de données. Le vrai risque — un site web malveillant ouvert dans ton navigateur qui appellerait `localhost` — est bloqué par `server/security.ts` : vérification de l'en-tête `Host` (anti « DNS rebinding »), de l'`Origin` et du type de contenu pour toute modification (anti-CSRF).
- La **porte distante** (port 4318, `server/remote.ts`) n'existe que si tu l'actives. Toute requête API y exige un **appareil appairé** (`server/auth.ts`) : code à 6 chiffres, usage unique, 10 minutes, 5 essais par code et 20 échecs/heure au maximum ; en échange, un jeton de 256 bits en cookie `HttpOnly` (`Secure` en HTTPS), dont seule l'empreinte SHA-256 est stockée. Les modifications doivent venir de la même origine que la page. Les actions sensibles (clé API, export, sauvegarde, réinitialisation, gestion des appareils) sont **réservées au Mac** ; la clé n'est jamais renvoyée à un appareil distant, même masquée.
- Mode Tailscale : la porte distante n'écoute que sur le Mac ; `tailscale serve` la rend accessible en HTTPS aux seuls appareils de ton compte Tailscale. Mode Wi-Fi : elle écoute sur le réseau local, en HTTP.
- Clé API : variable d'environnement ou `data/secrets.json` en permissions `600`, jamais renvoyée à l'interface (seule une version masquée l'est).
- Gabarits d'automatisation : simple lecture de chemins (`{{trigger.task.title}}`), aucune évaluation de code, aucun accès aux propriétés héritées.
- Le rendu Markdown des réponses IA ne génère que des éléments React (pas d'injection HTML).

## Jarvis (voix) et iPhone

- **Reconnaissance et synthèse vocales** : API Web Speech du navigateur (`src/lib/speech.ts`). Aucun son n'est envoyé à NEXUS ni à Anthropic : seul le texte reconnu l'est. Sur iPhone, Safari s'appuie sur la dictée d'Apple ; le micro exige le HTTPS.
- **Réponse parlée au fil de l'eau** : le texte reçu en streaming est découpé en phrases (`SentenceChunker`), nettoyé du Markdown (`stripForSpeech`) et lu dès qu'une phrase est complète.
- **Réponses adaptées à l'oral** : un message envoyé depuis Jarvis porte `voice: true` ; la consigne « réponds en quelques phrases, sans mise en forme » est ajoutée dans le contexte **du message** (pas dans le prompt système, qui reste statique — historique en ajout seul).
- **Application iPhone** : manifeste web + icônes (`public/`), mode plein écran, zones sûres (encoche), champs à 16 px (pas de zoom automatique de Safari). Pas de service worker : sans connexion au Mac, NEXUS n'a de toute façon pas de données à afficher, et l'absence de cache évite les versions périmées.

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

### Intégrations existantes (`server/integrations/`)
- **`common.ts`** : `importWorkout` (anti-doublons : même source + identifiant externe, ou séance d'une autre source le même jour avec type, durée ±12 % et distance ±5 % proches), `setDailyValue` (une valeur par jour et par source pour les métriques : renvoyer remplace), état des synchros (`integration_state`).
- **`strava.ts`** : OAuth 2 (état anti-falsification à usage unique, retour forcé sur `localhost`), jetons renouvelés automatiquement, import paginé des activités (180 jours au premier passage).
- **`menhir.ts`** : connexion Supabase avec le compte Menhir (mot de passe utilisé une fois, jeton de renouvellement tourné à chaque synchro), lecture seule de la ligne `fitlog_data` ; conversion des sorties (`runs`) et séances de muscu (`h`, tonnage = charge × répétitions hors cardio).
- **`health.ts`** + jetons `api_tokens` : le Raccourci iPhone envoie `POST /api/ingest/health` avec `Authorization: Bearer nxs_…`. Ces jetons ont un périmètre unique (`health:write`), seule leur empreinte est stockée, et la route est la seule de la porte distante à ne pas exiger d'appairage.
- **`scheduler.ts`** : synchro Strava et Menhir 30 s après le démarrage puis toutes les heures. Les secrets (jetons Strava, session Menhir) sont dans `data/secrets.json` (permissions 600).

Pour en ajouter une : un module dans ce dossier qui s'appuie sur `importWorkout` / `setDailyValue`, des routes dans `server/app.ts` (configuration en `macOnly`), une entrée dans `registry.ts`, une carte dans `src/pages/Sources.tsx`.

## Tests

`npm test` lance 83 tests (Vitest) sur les parties critiques :
- **données** : migrations, progression et santé des projets, objectifs, conversion idée → projet, liens, graphe, recherche plein texte, séries d'habitudes, import CSV sans doublons ;
- **IA** (avec un client Claude simulé, sans réseau ni coût) : boucle d'outils, persistance, historique en ajout seul, mode lecture seule, réparation des tours interrompus, entrées tronquées, refus, traduction des erreurs ;
- **automatisations** : gabarits, simulation sans effet, conditions, erreurs, appels HTTP, planification, événements sans boucle ;
- **API** : protections de sécurité, validation, parcours complet, gestion de la clé, réinitialisation avec sauvegarde ;
- **accès distant** : appairage, code à usage unique et expiration, anti force brute, révocation, actions réservées au Mac, anti-CSRF ;
- **voix** : nettoyage du Markdown pour l'oral, découpage en phrases, consigne vocale ;
- **intégrations** (faux serveurs Strava et Supabase) : anti-doublons entre sources, OAuth et état à usage unique, renouvellement des jetons, pagination, conversion course/muscu/tonnage, jetons Santé limités et révocables, valeurs tolérantes (« 72,4 kg ») ;
- **IA locale** (faux serveur Ollama) : détection, modèle manquant, boucle d'outils, format des messages, modèles sans outils, passage à Claude en cours de conversation, sorties structurées avec second essai, téléchargement.

### Ce qui a été vérifié pendant la construction, et ce qui ne l'a pas été
- ✅ Tests automatisés ci-dessus, vérification TypeScript, build de production.
- ✅ Parcours réels dans un navigateur (Chromium) : onboarding, capture rapide, tâches, projet complet (étapes, risques, dépenses), idée → projet, graphe et notes, habitudes, import CSV, workflow (simulation puis exécution), refus de clé invalide ; affichage mobile sans débordement ; aucune erreur dans la console.
- ✅ Chaîne IA complète avec le **vrai SDK Anthropic** branché sur un **serveur API simulé** local : vérification de clé, briefing, analyse d'idée, audit de projet, chat en streaming avec appel d'outil, à travers le proxy de développement, deux messages dans la même conversation.
- ⚠️ **Non testé : appels réels à l'API Anthropic** (aucune clé disponible pendant la construction, et pour ne rien dépenser sans ton accord). Le format des requêtes suit la documentation officielle du SDK, mais le premier vrai test se fera avec ta clé : commence par « Tester » dans Réglages (gratuit), puis un premier message court.
- ✅ Accès iPhone simulé (Chromium en profil « iPhone 15 Pro ») sur le serveur de production : appairage par code et par QR, refus d'un code faux, confirmation en direct côté Mac, Command Center et Jarvis sur iPhone, actions sensibles masquées, révocation. Boucle vocale complète avec micro et voix **simulés** : écoute, transcription en direct, réponse lue phrase par phrase sans Markdown, réécoute automatique, retour au repos.
- ✅ IA locale de bout en bout avec un **faux serveur Ollama** : détection automatique au lancement, téléchargement du modèle avec progression, test, chat avec appel d'outil, briefing, Jarvis.
- ✅ Sur le serveur réel : enregistrement de l'application Strava depuis l'interface et redirection vers la page d'autorisation Strava ; jeton Santé créé dans l'interface puis requête « façon Raccourci » sur la porte iPhone, mesures enregistrées, refus sans jeton.
- ⚠️ **Non testés avec les vrais services** : Strava (OAuth et API), Menhir/Supabase et le Raccourci iPhone n'ont pas pu être appelés depuis l'environnement de construction. Les formats suivent la documentation de Strava, le code de Menhir et l'API Supabase.
- ⚠️ **Non testé avec un vrai Ollama ni un vrai modèle** (les serveurs d'Ollama sont inaccessibles depuis l'environnement de construction) : le format suit la documentation de l'API Ollama ; la qualité réelle des réponses (français, choix des outils) dépend du modèle.
- ⚠️ **Non testé sur un vrai iPhone** ni avec un vrai micro : la qualité de la reconnaissance et des voix dépend d'iOS. **Non testés** : Tailscale réel (l'activation HTTPS lance `tailscale serve --bg 4318`), le démarrage automatique `launchd` et `NEXUS.command` (scripts vérifiés syntaxiquement, plist validé, mais jamais exécutés sur un Mac).
- ⚠️ Développé et testé sous Linux. Le code n'utilise rien de spécifique à un système, mais le premier lancement sur ton Mac reste à faire.
