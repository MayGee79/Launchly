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

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      created_at TEXT,
      fetched_at TEXT NOT NULL,
      sort TEXT,
      raw_json TEXT NOT NULL
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

export function upsertPost(db, post, { sort }) {
  const stmt = db.prepare(
    'INSERT INTO posts (id, created_at, fetched_at, sort, raw_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET raw_json=excluded.raw_json, fetched_at=excluded.fetched_at, sort=excluded.sort'
  );
  stmt.run(
    post.id,
    post.created_at || null,
    new Date().toISOString(),
    sort || null,
    JSON.stringify(post)
  );
}

export function listPostsSince(db, sinceIso, limit = 500) {
  return db
    .prepare(
      'SELECT raw_json FROM posts WHERE created_at IS NULL OR created_at >= ? ORDER BY COALESCE(created_at, fetched_at) DESC LIMIT ?'
    )
    .all(sinceIso || '1970-01-01T00:00:00.000Z', limit)
    .map((r) => JSON.parse(r.raw_json));
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
