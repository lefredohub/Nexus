# NEXUS

**Ton système d'exploitation personnel, augmenté par l'IA.**

NEXUS centralise tes projets, tâches, objectifs, idées, notes et données personnelles (finances, sport, habitudes), et y branche une IA — Claude — qui les connaît, raisonne dessus, agit pour toi et te contredit quand ton raisonnement ne tient pas.

Tout tourne **sur ta machine**. Les données restent dans un fichier local. Rien n'est envoyé ailleurs, sauf à l'API Anthropic, et uniquement quand tu sollicites l'IA.

---

## Les modules

| Module | Ce qu'il fait |
|---|---|
| **Command Center** | Vue d'ensemble : indicateurs, briefing IA du jour, focus (tâches vraiment prioritaires), projets, objectifs, habitudes, flux d'activité. |
| **Nexus AI** | Assistant conversationnel connecté à tes données via 26 outils (lecture et écriture). Mémoire long terme consultable et modifiable. Raisonnement visible, actions tracées. |
| **Memory Graph** | Réseau de connaissances interactif : objectifs, projets, idées, notes, souvenirs, et leurs liens. Glisser, zoomer, relier. |
| **Project Lab** | Projets avec objectif, étapes, tâches, budget et dépenses, risques, notes. **Audit IA** qui révèle les faiblesses et propose des actions à intégrer en un clic. |
| **Tâches** | Toutes les tâches, classées par urgence réelle (retard, aujourd'hui, semaine…). |
| **Analytics** | Finances (avec import de relevés bancaires CSV), sport, habitudes (calendriers), objectifs chiffrés, métriques libres (sommeil, poids…). |
| **Idea Engine** | Dépose une idée brute ; l'IA la reformule, la catégorise, note faisabilité et potentiel, propose un plan, un verdict — puis la transforme en projet structuré. |
| **Automation Lab** | Workflows visuels : déclencheur (manuel, planifié, événement) → étapes (créer une tâche, demander à Claude, appeler une API…). Simulation avant exécution, historique détaillé. |

---

## Démarrer (sur Mac)

### 1. Prérequis : Node.js 22.13 ou plus récent

Vérifie dans le Terminal :

```bash
node --version
```

S'il manque ou s'il est trop ancien, installe la version **LTS** depuis [nodejs.org](https://nodejs.org) (ou `brew install node` si tu utilises Homebrew).

> Pourquoi cette version ? NEXUS utilise la base SQLite intégrée à Node (`node:sqlite`) : aucune compilation, aucun logiciel de base de données à installer.

### 2. Installer

Dans le dossier du projet :

```bash
npm install
```

### 3. Lancer

```bash
npm run dev
```

Puis ouvre **http://localhost:5317**.

Au premier lancement, NEXUS te demande ton prénom et te propose :
- **Partir de zéro** — un espace vierge pour tes vraies données ;
- **Explorer avec une démo** — des données fictives pour tout découvrir (effaçables ensuite dans Réglages).

Pour arrêter : `Ctrl + C` dans le Terminal.

### 4. Activer l'IA

1. Crée une clé API sur [console.anthropic.com](https://console.anthropic.com) (rubrique *API Keys*).
2. Dans NEXUS : **Réglages → Intelligence artificielle → Ajouter ta clé**.
3. Clique sur **Tester** (vérification gratuite, aucun token consommé).

Alternative : copie `.env.example` en `.env` et renseigne `ANTHROPIC_API_KEY=...`.

**Coûts.** Chaque message, briefing ou analyse consomme des tokens facturés sur ton compte Anthropic. NEXUS ne fait **aucun appel sans action de ta part** (pas de briefing automatique, pas d'analyse en arrière-plan). Seules les automatisations que tu crées avec une étape « Demander à Claude » peuvent appeler l'IA seules, selon le déclencheur que tu choisis. Le modèle (Opus 5.5 par défaut) et le niveau d'effort se règlent dans Réglages ; Sonnet ou Haiku coûtent moins cher.

---

## Utilisation au quotidien

| Raccourci | Action |
|---|---|
| `⌘ K` | Palette : rechercher dans toute ta mémoire, naviguer, agir, poser une question à NEXUS |
| `N` | Capture rapide (tâche, idée ou note) |
| `G` puis `C` / `A` / `M` / `P` / `T` / `S` / `I` / `L` | Aller au Command Center / IA / Graphe / Projets / Tâches / Stats / Idées / Automations |

Quelques usages qui exploitent bien NEXUS :
- Demande à l'IA « Fais le point sur ma semaine » ou « Quel projet est le plus à risque ? ».
- Avant de lancer un projet, dis-le à NEXUS : il a pour consigne de te challenger.
- Dépose tes idées dans l'Idea Engine sans les trier ; fais-les analyser quand tu as un moment.
- Lance l'**Audit IA** d'un projet quand il patine.
- Exporte ton relevé bancaire en CSV et importe-le dans Analytics → Finances (les doublons sont ignorés si tu réimportes).

---

## Tes données

- Tout est dans **`data/nexus.db`** (un seul fichier SQLite). Sauvegarde le dossier `data/` pour tout conserver.
- **Réglages → Données** : export JSON lisible, sauvegarde instantanée (`data/backups/`), réinitialisation (précédée automatiquement d'une sauvegarde).
- La clé API est dans `data/secrets.json` (lisible par ton seul compte utilisateur) ou dans `.env`. **Elle n'est jamais renvoyée à l'interface** et ces fichiers sont exclus de Git.

---

## Commandes utiles

| Commande | Rôle |
|---|---|
| `npm run dev` | Lance NEXUS en développement (rechargement automatique) |
| `npm test` | Lance les tests automatisés |
| `npm run typecheck` | Vérifie les types TypeScript |
| `npm run check` | Les deux à la suite |
| `npm run build` puis `npm start` | Version optimisée, servie sur http://localhost:4317 |
| `npm run seed` | Charge les données de démo (uniquement dans une base vide) |

---

## Dépannage

- **« Port déjà utilisé »** : une autre instance tourne. Ferme-la, ou change les ports dans `.env` (`NEXUS_PORT`, `NEXUS_WEB_PORT`).
- **`node:sqlite` introuvable** : ta version de Node est trop ancienne (voir prérequis).
- **« Clé API refusée »** : vérifie la clé dans Réglages, et que ton compte Anthropic a du crédit.
- **« Modèle introuvable »** : ton compte n'a pas accès à ce modèle ; choisis-en un autre dans Réglages.

---

## Pour aller plus loin

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — comment c'est construit, les décisions importantes et leurs raisons, comment ajouter un outil IA, une étape d'automatisation, une intégration ou une table.
- [`CLAUDE.md`](CLAUDE.md) — consignes pour faire évoluer le projet avec Claude Code.
