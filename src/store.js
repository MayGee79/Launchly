import Database from 'better-sqlite3';

export function openStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      window_start TEXT,
      window_end TEXT,
      scanned_posts INTEGER NOT NULL,
      matched_posts INTEGER NOT NULL,
      category_counts_json TEXT NOT NULL,
      matches_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      scope TEXT PRIMARY KEY,
      approved_for_utc_day TEXT NOT NULL,
      approved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      connector TEXT NOT NULL,
      action_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS action_logs (
      id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT,
      data_json TEXT,
      FOREIGN KEY(action_id) REFERENCES actions(id)
    );
  `);

  return db;
}

export function getState(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setState(db, key, value) {
  db.prepare(
    'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
  ).run(key, String(value), new Date().toISOString());
}

export function insertReport(db, report) {
  const id = report.id;
  db.prepare(
    'INSERT INTO reports (id, created_at, window_start, window_end, scanned_posts, matched_posts, category_counts_json, matches_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    report.created_at,
    report.window_start || null,
    report.window_end || null,
    report.scanned_posts,
    report.matched_posts,
    JSON.stringify(report.category_counts),
    JSON.stringify(report.matches)
  );
  return id;
}

export function getLatestReport(db) {
  const row = db
    .prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 1')
    .get();
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at,
    window_start: row.window_start,
    window_end: row.window_end,
    scanned_posts: row.scanned_posts,
    matched_posts: row.matched_posts,
    category_counts: JSON.parse(row.category_counts_json),
    matches: JSON.parse(row.matches_json),
  };
}

export function getApproval(db, scope = 'writes') {
  const row = db.prepare('SELECT * FROM approvals WHERE scope = ?').get(scope);
  return row
    ? {
        scope: row.scope,
        approved_for_utc_day: row.approved_for_utc_day,
        approved_at: row.approved_at,
      }
    : null;
}

export function setApproval(db, scope, approvedForUtcDay) {
  db.prepare(
    'INSERT INTO approvals (scope, approved_for_utc_day, approved_at) VALUES (?, ?, ?) ON CONFLICT(scope) DO UPDATE SET approved_for_utc_day=excluded.approved_for_utc_day, approved_at=excluded.approved_at'
  ).run(scope, approvedForUtcDay, new Date().toISOString());
}

export function enqueueAction(db, action) {
  db.prepare(
    'INSERT INTO actions (id, created_at, connector, action_type, payload_json, status, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    action.id,
    action.created_at,
    action.connector,
    action.action_type,
    JSON.stringify(action.payload || {}),
    action.status || 'queued',
    action.last_error || null
  );
  return action.id;
}

export function listActions(db, { status = null, limit = 50 } = {}) {
  const base = 'SELECT * FROM actions';
  const where = status ? ' WHERE status = ?' : '';
  const order = ' ORDER BY created_at DESC';
  const lim = ' LIMIT ?';
  const rows = status
    ? db.prepare(base + where + order + lim).all(status, limit)
    : db.prepare(base + order + lim).all(limit);
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    connector: r.connector,
    action_type: r.action_type,
    payload: JSON.parse(r.payload_json),
    status: r.status,
    last_error: r.last_error,
  }));
}

export function updateActionStatus(db, id, status, { last_error = null } = {}) {
  db.prepare('UPDATE actions SET status = ?, last_error = ? WHERE id = ?').run(status, last_error, id);
}

export function insertActionLog(db, log) {
  db.prepare(
    'INSERT INTO action_logs (id, action_id, created_at, event, message, data_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    log.id,
    log.action_id,
    log.created_at,
    log.event,
    log.message || null,
    log.data ? JSON.stringify(log.data) : null
  );
}
