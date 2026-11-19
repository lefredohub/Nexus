/**
 * Migrations de la base de données.
 *
 * Règle d'or : ne JAMAIS modifier une migration déjà livrée. Pour changer le
 * schéma, ajoute une nouvelle entrée à la fin de `MIGRATIONS`. La version
 * courante est stockée dans `PRAGMA user_version`.
 */
import type { DatabaseSync } from 'node:sqlite';

/** Tables indexées par la recherche plein texte (FTS5). */
const SEARCHABLE: { table: string; kind: string; title: string; body: string }[] = [
  { table: 'projects', kind: 'project', title: 'new.title', body: "new.description || ' ' || new.objective || ' ' || new.notes" },
  { table: 'tasks', kind: 'task', title: 'new.title', body: 'new.notes' },
  { table: 'goals', kind: 'goal', title: 'new.title', body: 'new.description' },
  { table: 'ideas', kind: 'idea', title: "coalesce(new.title, '')", body: 'new.content' },
  { table: 'notes', kind: 'note', title: 'new.title', body: 'new.content' },
  { table: 'memories', kind: 'memory', title: "''", body: 'new.content' },
];

function searchTriggers(): string {
  return SEARCHABLE.map(
    ({ table, kind, title, body }) => `
    CREATE TRIGGER ${table}_fts_insert AFTER INSERT ON ${table} BEGIN
      INSERT INTO search_index (kind, ref_id, title, body) VALUES ('${kind}', new.id, ${title}, ${body});
    END;
    CREATE TRIGGER ${table}_fts_update AFTER UPDATE ON ${table} BEGIN
      DELETE FROM search_index WHERE kind = '${kind}' AND ref_id = old.id;
      INSERT INTO search_index (kind, ref_id, title, body) VALUES ('${kind}', new.id, ${title}, ${body});
    END;
    CREATE TRIGGER ${table}_fts_delete AFTER DELETE ON ${table} BEGIN
      DELETE FROM search_index WHERE kind = '${kind}' AND ref_id = old.id;
    END;`,
  ).join('\n');
}

const MIGRATIONS: string[] = [
  // ── v1 : schéma initial ──────────────────────────────────────────────────
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT 'personal',
    metric_unit TEXT,
    start_value REAL NOT NULL DEFAULT 0,
    target_value REAL,
    current_value REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    objective TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planning',
    priority INTEGER NOT NULL DEFAULT 2,
    color TEXT NOT NULL DEFAULT '#ff6b2c',
    budget_planned REAL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    start_date TEXT,
    due_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX milestones_project ON milestones(project_id, position);

  CREATE TABLE risks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    mitigation TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX risks_project ON risks(project_id);

  CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX expenses_project ON expenses(project_id);

  CREATE TABLE project_analyses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    analysis TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority INTEGER NOT NULL DEFAULT 2,
    due_date TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX tasks_status ON tasks(status, priority, due_date);
  CREATE INDEX tasks_project ON tasks(project_id);

  CREATE TABLE ideas (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'inbox',
    analysis TEXT,
    analyzed_at TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'fact',
    importance INTEGER NOT NULL DEFAULT 3,
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE links (
    id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (source_kind, source_id, target_kind, target_id)
  );
  CREATE INDEX links_target ON links(target_kind, target_id);

  CREATE TABLE activity (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    entity_kind TEXT,
    entity_id TEXT,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );
  CREATE INDEX activity_created ON activity(created_at DESC);

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL DEFAULT 'Divers',
    label TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (source, external_id)
  );
  CREATE INDEX transactions_date ON transactions(date);

  CREATE TABLE workouts (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    duration_min REAL NOT NULL,
    distance_km REAL,
    intensity INTEGER NOT NULL DEFAULT 3,
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (source, external_id)
  );
  CREATE INDEX workouts_date ON workouts(date);

  CREATE TABLE habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target_per_week INTEGER NOT NULL DEFAULT 7,
    color TEXT NOT NULL DEFAULT '#7ee0b5',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE habit_checks (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    PRIMARY KEY (habit_id, date)
  );

  CREATE TABLE metrics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'custom',
    target REAL,
    direction TEXT NOT NULL DEFAULT 'up',
    color TEXT NOT NULL DEFAULT '#8fb8ff',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE metric_entries (
    id TEXT PRIMARY KEY,
    metric_id TEXT NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    value REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  );
  CREATE INDEX metric_entries_metric ON metric_entries(metric_id, date);

  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- content = blocs exacts envoyés/reçus de l'API (rejoués tels quels : historique en ajout seul)
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX messages_conversation ON messages(conversation_id, created_at);

  CREATE TABLE briefings (
    date TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    trigger TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    dry_run INTEGER NOT NULL DEFAULT 0,
    trigger_payload TEXT NOT NULL DEFAULT '{}',
    log TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX automation_runs_automation ON automation_runs(automation_id, started_at DESC);

  CREATE VIRTUAL TABLE search_index USING fts5(
    kind UNINDEXED, ref_id UNINDEXED, title, body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  ${searchTriggers()}
  `,

  // ── v2 : appareils autorisés à accéder à NEXUS à distance (iPhone…) ──────
  // On ne stocke qu'une empreinte (SHA-256) du jeton de session, jamais le jeton lui-même.
  `
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  );
  `,
];

export function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration v${v + 1} échouée : ${(err as Error).message}`);
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
