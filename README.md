# NEXUS

**Ton système d'exploitation personnel, augmenté par l'IA.**

NEXUS centralise tes projets, tâches, objectifs, idées, notes et données personnelles (finances, sport, habitudes), et y branche une IA — Claude — qui les connaît, raisonne dessus, agit pour toi et te contredit quand ton raisonnement ne tient pas.

Tout tourne **sur ta machine**. Les données restent dans un fichier local. Rien n'est envoyé ailleurs, sauf à l'API Anthropic, et uniquement quand tu sollicites l'IA.

---

## Les modules

| Module | Ce qu'il fait |
|---|---|
| **Command Center** | Vue d'ensemble : indicateurs, briefing IA du jour, focus (tâches vraiment prioritaires), projets, objectifs, habitudes, flux d'activité. |
| **Jarvis** | L'IA à la voix : tu touches le noyau, tu parles, NEXUS consulte tes données, agit et te répond à voix haute. Mode conversation (il se remet à l'écoute après chaque réponse). Pensé pour l'iPhone. |
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

**Le plus simple :** double-clique sur **`NEXUS.command`** dans le Finder. Il installe ce qui manque, démarre NEXUS et ouvre **http://localhost:4317**.

En ligne de commande : `npm start` (même résultat), ou `npm run dev` pour développer (interface sur http://localhost:5317, rechargement automatique).

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

## Sur ton iPhone : NEXUS dans la poche, Jarvis à la voix

Tes données restent sur le Mac ; l'iPhone s'y connecte. Le Mac doit donc être allumé avec NEXUS lancé.

### Étape 1 — Choisir comment l'iPhone joint le Mac

Sur le Mac : **Réglages → Accès depuis l'iPhone**.

| Mode | Où ça marche | Micro (Jarvis) | Mise en place |
|---|---|---|---|
| **Tailscale** (recommandé) | Partout : 4G, n'importe quel Wi-Fi | ✅ (HTTPS) | Installer Tailscale, gratuit, 5 min |
| **Wi-Fi de la maison** | Uniquement sur le même Wi-Fi | ❌ Safari bloque le micro sans HTTPS (Jarvis parle quand même, et la dictée du clavier fonctionne) | Rien |

**Tailscale**, pas à pas :
1. Installe Tailscale sur le Mac et sur l'iPhone depuis [tailscale.com/download](https://tailscale.com/download), connecte-toi avec **le même compte** sur les deux.
2. Dans NEXUS (Mac) : choisis **Tailscale**, puis clique sur **Activer le HTTPS Tailscale**. Si Tailscale demande d'activer les certificats HTTPS, suis le lien affiché puis recommence.
3. NEXUS affiche ton adresse privée, du type `https://ton-mac.tailXXXX.ts.net`. Elle n'est accessible qu'à **tes** appareils connectés à Tailscale : rien n'est publié sur Internet.

### Étape 2 — Relier l'iPhone

1. Sur le Mac : **Appairer un appareil** → un QR code et un code à 6 chiffres s'affichent (valables 10 minutes, usage unique).
2. Scanne le QR code avec l'appareil photo de l'iPhone : Safari s'ouvre, l'iPhone est relié.
3. Pour une vraie icône d'app : dans Safari, **Partager → Sur l'écran d'accueil**. Ouvre NEXUS depuis l'icône ; iOS sépare cette app de Safari, il faudra donc saisir **un nouveau code** une fois.

Chaque appareil relié apparaît dans les Réglages du Mac, où tu peux le retirer à tout moment.

### Étape 3 — Parler à Jarvis

Touche le bouton central (le noyau), parle, relâche : Jarvis répond à voix haute. Avec le **mode conversation**, il se remet à l'écoute après chaque réponse : tu enchaînes comme avec une personne. Touche le noyau pour l'interrompre.

Conseil voix : sur iPhone, installe une voix française **« Améliorée »** (Réglages → Accessibilité → Contenu énoncé → Voix → Français), puis choisis-la dans Jarvis (icône réglages en haut à droite).

### Garder NEXUS toujours disponible

Pour que Jarvis réponde même quand tu n'as pas pensé à lancer NEXUS, active le démarrage automatique sur le Mac :

```bash
./scripts/mac/autostart.sh install     # démarre maintenant et à chaque ouverture de session
./scripts/mac/autostart.sh uninstall   # pour retirer
```

(N'utilise pas `NEXUS.command` en même temps : le port serait déjà pris.) Le Mac ne doit pas être en veille pour répondre : Réglages Système → Écran verrouillé / Batterie → empêcher la mise en veille automatique sur secteur.

### Ce qui reste réservé au Mac

Par sécurité, depuis l'iPhone tu ne peux pas : voir ou changer la clé API, exporter/sauvegarder/réinitialiser les données, ni relier d'autres appareils.

---

## Utilisation au quotidien

| Raccourci | Action |
|---|---|
| `⌘ K` | Palette : rechercher dans toute ta mémoire, naviguer, agir, poser une question à NEXUS |
| `N` | Capture rapide (tâche, idée ou note) |
| `G` puis `J` | Jarvis |
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
| `npm start` | Compile l'interface et lance NEXUS (http://localhost:4317) — usage quotidien et iPhone |
| `npm run dev` | Lance NEXUS en développement (rechargement automatique) |
| `npm test` | Lance les tests automatisés |
| `npm run typecheck` | Vérifie les types TypeScript |
| `npm run check` | Les deux à la suite |
| `npm run seed` | Charge les données de démo (uniquement dans une base vide) |

---

## Dépannage

- **« Port déjà utilisé »** : une autre instance tourne (peut-être le démarrage automatique). Ferme-la, ou change les ports dans `.env` (`NEXUS_PORT`, `NEXUS_WEB_PORT`, `NEXUS_REMOTE_PORT`).
- **L'iPhone affiche « NEXUS est injoignable »** : le Mac est éteint ou en veille, NEXUS n'est pas lancé, ou Tailscale est déconnecté sur l'un des deux appareils.
- **Jarvis n'entend rien** : vérifie que tu utilises l'adresse Tailscale (HTTPS) et que Safari a l'autorisation du micro (Réglages → Safari → Micro). Dans l'app ajoutée à l'écran d'accueil, selon la version d'iOS, la reconnaissance vocale peut être indisponible : utilise alors le bouton clavier et la dictée (micro du clavier iOS), ou ouvre Jarvis dans Safari.
- **`node:sqlite` introuvable** : ta version de Node est trop ancienne (voir prérequis).
- **« Clé API refusée »** : vérifie la clé dans Réglages, et que ton compte Anthropic a du crédit.
- **« Modèle introuvable »** : ton compte n'a pas accès à ce modèle ; choisis-en un autre dans Réglages.

---

## Pour aller plus loin

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — comment c'est construit, les décisions importantes et leurs raisons, comment ajouter un outil IA, une étape d'automatisation, une intégration ou une table.
- [`CLAUDE.md`](CLAUDE.md) — consignes pour faire évoluer le projet avec Claude Code.
