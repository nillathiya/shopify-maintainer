// The scan pipeline: a fixed list of steps with live progress, saved to local memory.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { db, now, kvSet, logActivity } from "../memory/db.ts";
import { getSettings, saveSettings, adminConfigured } from "../memory/settings.ts";
import { StorefrontClient } from "./http.ts";
import { fetchIdentity, fetchProducts, fillImageAlts, fetchCollections, fetchContentIndex, choosePages, allPages, scanPages, checkInternalLinks, fileName, type LinkCheck } from "./storefront.ts";
import { writePack } from "../context/pack.ts";
import { stagingDir, promote, discardStaging, readNotes } from "../context/store.ts";
import { visualScan } from "./visual.ts";
import { adminScan } from "./admin-scan.ts";
import { analyze } from "./analyze.ts";
import { diffSnapshots, type Change } from "./diff.ts";
import type { StoreSnapshot } from "./types.ts";

export type StepStatus = "waiting" | "running" | "done" | "skipped" | "failed";
export interface StepState {
  id: string;
  title: string;
  status: StepStatus;
  note: string;
}
export interface ScanJob {
  id: string;
  storeUrl: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "failed";
  steps: StepState[];
  message: string;
  error: string | null;
}

const STEP_TITLES: Array<[string, string]> = [
  ["identify", "Finding your store"],
  ["catalog", "Reading products and collections"],
  ["content", "Listing pages and blog posts"],
  ["pages", "Reading every page, word by word"],
  ["pictures", "Taking pictures of every page on computer and phone"],
  ["links", "Checking links"],
  ["admin", "Reading theme settings (admin access)"],
  ["health", "Running the health check"],
  ["save", "Saving the store context"],
];

let current: ScanJob | null = null;
export const currentJob = () => current;

export function startScan(opts: { storeUrl?: string } = {}): ScanJob {
  if (current?.status === "running") return current;
  if (opts.storeUrl) saveSettings({ storeUrl: opts.storeUrl });
  const s = getSettings();
  if (!s.storeUrl) throw new Error("Enter your store address first.");
  const job: ScanJob = {
    id: new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + randomUUID().slice(0, 6),
    storeUrl: s.storeUrl,
    startedAt: now(),
    finishedAt: null,
    status: "running",
    steps: STEP_TITLES.map(([id, title]) => ({ id, title, status: "waiting", note: "" })),
    message: "Starting…",
    error: null,
  };
  current = job;
  db().prepare("INSERT INTO scans (id, started_at, status, store_url) VALUES (?, ?, 'running', ?)").run(job.id, job.startedAt, job.storeUrl);
  runScan(job).catch(() => {}); // errors are recorded on the job
  return job;
}

/** Runs a scan to completion (used by the CLI and tests). */
export async function runScanNow(opts: { storeUrl?: string; onUpdate?: (j: ScanJob) => void } = {}): Promise<ScanJob> {
  const job = startScan(opts);
  while (job.status === "running") {
    opts.onUpdate?.(job);
    await new Promise((r) => setTimeout(r, 400));
  }
  opts.onUpdate?.(job);
  return job;
}

async function runScan(job: ScanJob): Promise<void> {
  const t0 = Date.now();
  const s = getSettings();
  const step = (id: string) => job.steps.find((x) => x.id === id)!;
  const run = async <T>(id: string, fn: (note: (n: string) => void) => Promise<T>): Promise<T> => {
    const st = step(id);
    st.status = "running";
    job.message = st.title + "…";
    const note = (n: string) => {
      st.note = n;
      job.message = n;
    };
    try {
      const r = await fn(note);
      if (st.status === "running") st.status = "done";
      return r;
    } catch (e) {
      st.status = "failed";
      st.note = (e as Error).message;
      throw e;
    }
  };
  const skip = (id: string, why: string) => {
    const st = step(id);
    st.status = "skipped";
    st.note = why;
  };

  try {
    const client = new StorefrontClient(s.storeUrl);
    const warnings: string[] = [];

    const { identity, homeHtml, homeMs, homeStatus } = await run("identify", async (note) => {
      let r = await fetchIdentity(client);
      if (r.identity.passwordProtected && s.storefrontPassword) {
        note("Unlocking the password page…");
        if (await client.unlock(s.storefrontPassword)) r = await fetchIdentity(client);
      }
      if (r.identity.passwordProtected) throw new Error("The store is password-protected. Add the storefront password in Settings, then scan again.");
      if (r.identity.shopDomain && !s.shopDomain) saveSettings({ shopDomain: r.identity.shopDomain });
      note(`${r.identity.name || "Store"} · theme “${r.identity.theme.name}” · ${r.identity.currency}`);
      return r;
    });
    const storeHost = new URL(identity.url).hostname;

    const { products, collections } = await run("catalog", async (note) => {
      note("Reading products…");
      const products = await fetchProducts(client);
      note(`Found ${products.length} products. Reading photo descriptions…`);
      await fillImageAlts(client, products);
      note("Reading collections…");
      const collections = await fetchCollections(client, products);
      note(`${products.length} products, ${products.reduce((a, p) => a + p.variants.length, 0)} variants, ${collections.length} collections`);
      return { products, collections };
    });

    const content = await run("content", async (note) => {
      const c = await fetchContentIndex(client);
      note(`${c.pages.length} pages, ${c.blogs.length} blogs, ${c.articles.length} blog posts`);
      return c;
    });

    const pages = await run("pages", async (note) => {
      let targets = choosePages(identity, products, collections, content);
      if (s.scanDepth === "full") {
        const all = allPages(identity, products, collections, content, s.maxPages);
        targets = all.targets;
        if (all.skipped) warnings.push(`${all.skipped} pages were not read because of the ${s.maxPages}-page limit in Settings. Their products are still fully described from the catalog.`);
      }
      note(`Reading ${targets.length} pages…`);
      const pages = await scanPages(client, targets, storeHost, { path: "/", html: homeHtml, ms: homeMs, status: homeStatus }, (done, total) => note(`Read ${done} of ${total} pages`));
      // Images that belong to products are uploaded files too; label them as product photos.
      const productFiles = new Set(products.flatMap((p) => p.images.map((i) => fileName(i.src))));
      for (const p of pages) for (const sec of p.sections) for (const img of sec.images) if (img.source === "uploaded-file" && productFiles.has(fileName(img.src))) img.source = "product";
      const home = pages.find((p) => p.kind === "home");
      const words = pages.reduce((a, p) => a + p.sections.reduce((b, x) => b + (x.content.match(/\S+/g)?.length ?? 0), 0), 0);
      note(`${pages.length} pages read (${words.toLocaleString()} words). Homepage has ${home?.sections.filter((x) => !x.hidden).length ?? 0} sections`);
      return pages;
    });

    let design: StoreSnapshot["design"] = null;
    if (s.takePictures) {
      await run("pictures", async (note) => {
        const r = await visualScan({ pages, screensDir: path.join(stagingDir(job.id), "screens"), chromiumPath: config.chromiumPath || undefined, cookies: client.cookieList(storeHost), onProgress: note });
        design = r.design;
        warnings.push(...r.warnings);
        if (r.warnings.length && !r.design) {
          step("pictures").status = "skipped";
          note(r.warnings[0]);
        } else note(`Pictures saved for ${pages.length - r.warnings.length} of ${pages.length} pages`);
      });
    } else skip("pictures", "Turned off in Settings");

    let links: LinkCheck[] = [];
    if (s.checkLinks) {
      links = await run("links", async (note) => {
        const l = await checkInternalLinks(client, pages, homeHtml, storeHost);
        const bad = l.filter((x) => x.status >= 400).length;
        note(`${l.length} links checked, ${bad} broken`);
        return l;
      });
    } else skip("links", "Turned off in Settings");

    let admin: StoreSnapshot["admin"] = null;
    if (adminConfigured()) {
      await run("admin", async (note) => {
        try {
          const r = await adminScan(pages);
          admin = r.admin;
          note(`Theme “${r.admin.themeName}”: ${r.admin.editableSlotCount} editable texts and images found`);
        } catch (e) {
          warnings.push(`Admin scan failed: ${(e as Error).message}`);
          step("admin").status = "failed";
          note((e as Error).message);
        }
      });
    } else skip("admin", "Not connected (optional). Connect in Settings to see exactly what's editable.");

    const snapshot: StoreSnapshot = {
      version: 1,
      scannedAt: job.startedAt,
      durationMs: 0,
      identity,
      pages,
      products,
      collections,
      content,
      design,
      admin,
      findings: [],
      stats: {},
      warnings,
    };

    await run("health", async (note) => {
      snapshot.findings = analyze(snapshot, links);
      const by = (sev: string) => snapshot.findings.filter((f) => f.severity === sev).length;
      note(`${by("high")} urgent, ${by("medium")} worth fixing, ${by("low")} nice to have`);
    });

    await run("save", async (note) => {
      snapshot.durationMs = Date.now() - t0;
      snapshot.stats = statsFor(snapshot, links);
      const prev = latestSnapshot();
      const changes: Change[] = prev ? diffSnapshots(prev, snapshot) : [];
      const summary = { ...snapshot.stats, changes, storeName: identity.name, theme: identity.theme.name };
      note("Writing the store context folder…");
      const manifest = writePack(stagingDir(job.id), snapshot, changes, job.id, readNotes());
      promote(job.id);
      db().prepare("UPDATE scans SET finished_at = ?, status = 'done', summary = ?, snapshot = ? WHERE id = ?").run(now(), JSON.stringify({ ...summary, contextFiles: manifest.files.length }), JSON.stringify(snapshot), job.id);
      kvSet("lastScanId", job.id);
      logActivity("scan.done", { id: job.id, findings: snapshot.findings.length, changes: changes.length });
      note(prev ? `${changes.length} change(s) since the last scan` : "First scan saved");
    });

    job.status = "done";
    job.message = "Scan complete";
  } catch (e) {
    job.status = "failed";
    job.error = (e as Error).message;
    job.message = job.error;
    for (const st of job.steps) if (st.status === "waiting") st.status = "skipped";
    discardStaging(job.id);
    db().prepare("UPDATE scans SET finished_at = ?, status = 'failed', error = ? WHERE id = ?").run(now(), job.error, job.id);
    logActivity("scan.failed", { id: job.id, error: job.error });
  } finally {
    job.finishedAt = now();
  }
}

function statsFor(s: StoreSnapshot, links: LinkCheck[]): Record<string, number> {
  const home = s.pages.find((p) => p.kind === "home");
  return {
    products: s.products.length,
    variants: s.products.reduce((a, p) => a + p.variants.length, 0),
    productPhotos: s.products.reduce((a, p) => a + p.images.length, 0),
    collections: s.collections.length,
    pages: s.content.pages.length,
    articles: s.content.articles.length,
    pagesScanned: s.pages.length,
    homeSections: home?.sections.filter((x) => !x.hidden).length ?? 0,
    linksChecked: links.length,
    brokenLinks: links.filter((l) => l.status >= 400).length,
    issuesHigh: s.findings.filter((f) => f.severity === "high").length,
    issuesMedium: s.findings.filter((f) => f.severity === "medium").length,
    issuesLow: s.findings.filter((f) => f.severity === "low").length,
    durationSec: Math.round(s.durationMs / 1000),
  };
}

export function latestSnapshot(): StoreSnapshot | null {
  const row = db().prepare("SELECT snapshot FROM scans WHERE status = 'done' AND snapshot IS NOT NULL ORDER BY started_at DESC LIMIT 1").get() as { snapshot: string } | undefined;
  return row ? (JSON.parse(row.snapshot) as StoreSnapshot) : null;
}

export function getSnapshot(id: string): StoreSnapshot | null {
  const row = db().prepare("SELECT snapshot FROM scans WHERE id = ?").get(id) as { snapshot: string | null } | undefined;
  return row?.snapshot ? (JSON.parse(row.snapshot) as StoreSnapshot) : null;
}

export function listScans(limit = 50) {
  return (db().prepare("SELECT id, started_at, finished_at, status, store_url, summary, error FROM scans ORDER BY started_at DESC LIMIT ?").all(limit) as any[]).map((r) => ({
    ...r,
    summary: r.summary ? JSON.parse(r.summary) : null,
  }));
}
