// Where the context pack lives on disk, and how scans rotate it.
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import type { Manifest } from "./pack.ts";

export const KEEP_HISTORY = 3;

export const contextDir = () => path.join(config.dataDir, "store-context");
export const historyRoot = () => path.join(config.dataDir, "history");
export const stagingDir = (scanId: string) => path.join(config.dataDir, "staging", scanId);

export function readManifest(dir = contextDir()): Manifest | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export function readNotes(): string | null {
  const f = path.join(contextDir(), "NOTES.md");
  return existsSync(f) ? readFileSync(f, "utf8") : null;
}

export function writeNotes(text: string): void {
  mkdirSync(contextDir(), { recursive: true });
  writeFileSync(path.join(contextDir(), "NOTES.md"), text);
}

/** Make the finished staging folder the current context; keep the previous one in history. */
export function promote(scanId: string): void {
  const current = contextDir();
  const prev = readManifest(current);
  mkdirSync(historyRoot(), { recursive: true });
  if (existsSync(current)) {
    const dest = path.join(historyRoot(), prev?.scanId ?? `unknown-${Date.now()}`);
    rmSync(dest, { recursive: true, force: true });
    renameSync(current, dest);
  }
  renameSync(stagingDir(scanId), current);
  const old = readdirSync(historyRoot()).sort().reverse().slice(KEEP_HISTORY);
  for (const d of old) rmSync(path.join(historyRoot(), d), { recursive: true, force: true });
}

export function discardStaging(scanId: string): void {
  rmSync(stagingDir(scanId), { recursive: true, force: true });
}

/** Folder holding the pictures of a given scan (current or in history), or null if pruned. */
export function screensDirFor(scanId: string): string | null {
  if (readManifest()?.scanId === scanId) return path.join(contextDir(), "screens");
  const h = path.join(historyRoot(), scanId, "screens");
  if (existsSync(h)) return h;
  const s = path.join(stagingDir(scanId), "screens");
  return existsSync(s) ? s : null;
}
