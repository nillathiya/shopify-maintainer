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

/** Windows can briefly lock folders (antivirus, an open Explorer window): retry a few times. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * (attempt + 1));
    }
  }
}

/** Make the finished staging folder the current context; keep the previous one in history. */
export function promote(scanId: string): void {
  const current = contextDir();
  const prev = readManifest(current);
  mkdirSync(historyRoot(), { recursive: true });
  let movedTo: string | null = null;
  if (existsSync(current)) {
    movedTo = path.join(historyRoot(), prev?.scanId ?? `unknown-${Date.now()}`);
    rmSync(movedTo, { recursive: true, force: true });
    renameWithRetry(current, movedTo);
  }
  try {
    renameWithRetry(stagingDir(scanId), current);
  } catch (e) {
    // Put the previous context back so the store is never left without one.
    if (movedTo) {
      try {
        renameWithRetry(movedTo, current);
      } catch {
        /* the previous context is still safe in history */
      }
    }
    throw new Error(`Couldn't save the new store context folder. Close any window or program that has the "data" folder open, then scan again. (${(e as Error).message})`);
  }
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
