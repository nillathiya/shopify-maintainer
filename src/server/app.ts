// Local web server: serves the UI and a small JSON API over local memory.
// Nothing here scans on its own — scans start only when the operator asks.
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { startScan, currentJob, latestSnapshot, listScans } from "../scanner/pipeline.ts";
import { getSettings, saveSettings, publicSettings } from "../memory/settings.ts";
import { contextDir, readManifest, readNotes, writeNotes, screensDirFor } from "../context/store.ts";
import { NOTES_TEMPLATE } from "../context/pack.ts";
import { pageName } from "../scanner/names.ts";
import { db } from "../memory/db.ts";
import type { StoreSnapshot } from "../scanner/types.ts";

let cache: { id: string | null; snap: StoreSnapshot | null } = { id: null, snap: null };
function snapshot(): StoreSnapshot | null {
  const id = readManifest()?.scanId ?? null;
  if (cache.id !== id || !cache.snap) cache = { id, snap: latestSnapshot() };
  return cache.snap;
}

function latestSummary() {
  const row = db().prepare("SELECT id, finished_at, summary FROM scans WHERE status = 'done' ORDER BY started_at DESC LIMIT 1").get() as { id: string; finished_at: string; summary: string } | undefined;
  return row ? { scanId: row.id, scannedAt: row.finished_at, ...JSON.parse(row.summary) } : null;
}

const words = (s: string) => s.match(/\S+/g)?.length ?? 0;

export function createApp(publicDir = path.resolve("public")) {
  const app = new Hono();

  app.onError((err, c) => c.json({ error: err.message }, 400));

  app.get("/api/status", (c) => {
    const s = getSettings();
    return c.json({ settings: publicSettings(s), job: currentJob(), latest: latestSummary(), contextFolder: contextDir() });
  });

  app.post("/api/scan", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(startScan({ storeUrl: body.storeUrl }));
  });

  app.get("/api/scan/current", (c) => c.json(currentJob()));

  app.get("/api/overview", (c) => {
    const snap = snapshot();
    if (!snap) return c.json(null);
    const home = snap.pages.find((p) => p.kind === "home");
    return c.json({
      scanId: cache.id,
      scannedAt: snap.scannedAt,
      identity: snap.identity,
      stats: snap.stats,
      design: snap.design,
      admin: snap.admin,
      warnings: snap.warnings,
      changes: latestSummary()?.changes ?? [],
      home: home && {
        url: home.url,
        screens: home.screens,
        metrics: home.metrics,
        sections: home.sections.filter((s) => !s.hidden).map(({ content, ...s }) => ({ ...s, words: words(content), content })),
      },
      findingCounts: ["high", "medium", "low", "info"].map((sev) => snap.findings.filter((f) => f.severity === sev).length),
    });
  });

  app.get("/api/pages", (c) => {
    const snap = snapshot();
    if (!snap) return c.json([]);
    return c.json(
      snap.pages.map((p, i) => ({
        index: i, kind: p.kind, name: pageName(p, snap.identity.name), url: p.url, status: p.status, title: p.title,
        sections: p.sections.filter((s) => !s.hidden).length, words: p.sections.reduce((a, s) => a + words(s.content), 0),
        screens: p.screens ?? null, metaDescription: p.metaDescription,
      })),
    );
  });

  app.get("/api/pages/:index", (c) => {
    const snap = snapshot();
    const p = snap?.pages[Number(c.req.param("index"))];
    if (!snap || !p) return c.json({ error: "Page not found" }, 404);
    return c.json({ ...p, name: pageName(p, snap.identity.name), scanId: cache.id, sections: p.sections.filter((s) => !s.hidden) });
  });

  app.get("/api/catalog", (c) => {
    const snap = snapshot();
    if (!snap) return c.json(null);
    return c.json({ currency: snap.identity.currency, storeUrl: snap.identity.url, products: snap.products, collections: snap.collections });
  });

  app.get("/api/findings", (c) => c.json(snapshot()?.findings ?? []));
  app.get("/api/history", (c) => c.json(listScans()));

  app.get("/api/notes", (c) => c.json({ text: readNotes() ?? NOTES_TEMPLATE }));
  app.put("/api/notes", async (c) => {
    const { text } = await c.req.json();
    writeNotes(String(text ?? ""));
    return c.json({ ok: true });
  });

  app.get("/api/settings", (c) => c.json(publicSettings()));
  app.put("/api/settings", async (c) => {
    const body = await c.req.json();
    // Masked secrets coming back unchanged from the form mean "keep the saved value".
    for (const k of ["storefrontPassword", "adminToken", "clientSecret"]) if (typeof body[k] === "string" && body[k].startsWith("••••")) delete body[k];
    return c.json(publicSettings(saveSettings(body)));
  });

  // Pictures of any kept scan
  app.get("/screens/:scanId/:file", (c) => {
    const dir = screensDirFor(c.req.param("scanId"));
    const file = path.basename(c.req.param("file"));
    const full = dir && path.join(dir, file);
    if (!full || !existsSync(full)) return c.notFound();
    return c.body(readFileSync(full), 200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" });
  });

  // The context folder itself (STORE.md, pages/*.md, …) for viewing or handing to an AI tool
  app.get("/context/*", (c) => {
    const rel = decodeURIComponent(c.req.path.replace(/^\/context\/?/, "")) || "STORE.md";
    const root = contextDir();
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep) || !existsSync(full)) return c.notFound();
    const type = full.endsWith(".md") ? "text/markdown; charset=utf-8" : full.endsWith(".json") ? "application/json" : full.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
    return c.body(readFileSync(full), 200, { "Content-Type": type });
  });

  app.use("/*", serveStatic({ root: path.relative(process.cwd(), publicDir) || "." }));
  app.get("*", (c) => c.html(readFileSync(path.join(publicDir, "index.html"), "utf8")));
  return app;
}
