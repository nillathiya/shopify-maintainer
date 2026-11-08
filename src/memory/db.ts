// Local memory: one SQLite file for the one store this install maintains.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
  store_url TEXT NOT NULL, summary TEXT, snapshot TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS theme_files (
  theme_id TEXT NOT NULL, filename TEXT NOT NULL, checksum TEXT, content TEXT, fetched_at TEXT NOT NULL,
  PRIMARY KEY (theme_id, filename));
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
`;

let _db: DatabaseSync | null = null;

export function openDb(file = path.join(config.dataDir, "memory.sqlite")): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

export function db(): DatabaseSync {
  if (!_db) _db = openDb();
  return _db;
}

/** Tests can swap in an in-memory database. */
export function useDb(instance: DatabaseSync): void {
  _db = instance;
}

export const now = () => new Date().toISOString();

export function kvGet<T>(key: string, fallback: T): T {
  const row = db().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function kvSet(key: string, value: unknown): void {
  db()
    .prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), now());
}

export function logActivity(action: string, detail: unknown = null): void {
  db().prepare("INSERT INTO activity (at, action, detail) VALUES (?, ?, ?)").run(now(), action, JSON.stringify(detail));
}
