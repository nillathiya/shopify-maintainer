// Visual scan with a real browser (Playwright, optional): full-page and per-section pictures
// on desktop and phone, plus what the browser measures — colours, fonts, broken images,
// page weight and sideways scrolling on phones.
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { DesignTokens, PageMetrics, ScannedPage } from "./types.ts";
import { mapLimit } from "./http.ts";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
} as const;
type ViewportName = keyof typeof VIEWPORTS;

const MAX_PAGE_HEIGHT = 16000;
const PAGES_IN_PARALLEL = 2;

export interface VisualOptions {
  pages: ScannedPage[];
  screensDir: string;
  chromiumPath?: string;
  cookies?: Array<{ name: string; value: string; domain: string; path: string }>;
  onProgress?: (msg: string) => void;
}

/** Short file-safe name for a page, e.g. "product--heritage-flap-backpack". */
export function pageSlug(p: Pick<ScannedPage, "kind" | "url">): string {
  let path = "";
  try {
    path = new URL(p.url).pathname;
  } catch {
    path = p.url;
  }
  const last = path.split("/").filter(Boolean).slice(p.kind === "article" ? -2 : -1).join("--");
  return (p.kind === "home" || p.kind === "collections" || !last ? p.kind : `${p.kind}--${last}`).replace(/[^\w.-]+/g, "-").slice(0, 120);
}

export interface VisualResult {
  design: DesignTokens | null;
  warnings: string[];
}

export async function loadPlaywright(): Promise<any | null> {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

export async function visualScan(opts: VisualOptions): Promise<VisualResult> {
  const warnings: string[] = [];
  const pw = await loadPlaywright();
  if (!pw) {
    return { design: null, warnings: ["Page pictures were skipped: the browser add-on isn't installed. Run `npx playwright install chromium` once, then scan again."] };
  }
  mkdirSync(opts.screensDir, { recursive: true });
  let browser: any;
  try {
    browser = await pw.chromium.launch(opts.chromiumPath ? { executablePath: opts.chromiumPath } : {});
  } catch (e) {
    return { design: null, warnings: [`Page pictures were skipped: the browser couldn't start (${(e as Error).message.split("\n")[0]}). Run \`npx playwright install chromium\` or set CHROMIUM_PATH.`] };
  }
  let design: DesignTokens | null = null;
  try {
    for (const vpName of Object.keys(VIEWPORTS) as ViewportName[]) {
      const vp = VIEWPORTS[vpName];
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
        userAgent: vp.isMobile
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 shopify-maintainer"
          : undefined,
      });
      if (opts.cookies?.length) await context.addCookies(opts.cookies);
      // tsx/esbuild wraps named functions with a __name() helper that doesn't exist inside the page.
      await context.addInitScript("window.__name = window.__name || ((f) => f);");
      let done = 0;
      await mapLimit(opts.pages, PAGES_IN_PARALLEL, async (page) => {
        opts.onProgress?.(`${vpName === "desktop" ? "Computer" : "Phone"} pictures: page ${++done} of ${opts.pages.length} (${pageSlug(page)})`);
        try {
          const r = await shootPage(context, page, vpName, opts);
          if (vpName === "desktop" && page.kind === "home") design = r.design;
          if (vpName === "desktop") page.metrics = r.metrics;
          else if (page.metrics) page.metrics.mobileOverflowPx = r.metrics.mobileOverflowPx;
        } catch (e) {
          warnings.push(`Couldn't take ${vpName} pictures of ${page.url}: ${(e as Error).message.split("\n")[0]}`);
        }
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { design, warnings };
}

async function shootPage(context: any, sp: ScannedPage, vpName: ViewportName, opts: VisualOptions): Promise<{ metrics: PageMetrics; design: DesignTokens | null }> {
  const page = await context.newPage();
  const failed: string[] = [];
  const consoleErrors: string[] = [];
  let requests = 0;
  page.on("request", () => requests++);
  page.on("requestfailed", (req: any) => failed.push(req.url()));
  page.on("response", (res: any) => {
    if (res.status() >= 400 && /\.(jpe?g|png|webp|gif|avif|css|js)(\?|$)/i.test(res.url())) failed.push(`${res.status()} ${res.url()}`);
  });
  page.on("console", (m: any) => {
    if (m.type() === "error" && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300));
  });
  try {
    await page.goto(sp.url, { waitUntil: "load", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    // Scroll through the page so lazy images and scroll-reveal effects load, then freeze motion.
    await page.evaluate(async () => {
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.addStyleTag({ content: "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}" });
    await page.waitForTimeout(600);

    const base = `${pageSlug(sp)}--${vpName}`;
    const height: number = await page.evaluate(() => document.documentElement.scrollHeight);
    const full = `${base}.jpg`;
    await page.screenshot({
      path: path.join(opts.screensDir, full),
      type: "jpeg",
      quality: 70,
      fullPage: height <= MAX_PAGE_HEIGHT,
      ...(height > MAX_PAGE_HEIGHT ? { clip: { x: 0, y: 0, width: VIEWPORTS[vpName].width, height: MAX_PAGE_HEIGHT } } : {}),
    }).catch(async () => {
      await page.screenshot({ path: path.join(opts.screensDir, full), type: "jpeg", quality: 70 });
    });
    sp.screens = { ...(sp.screens ?? {}), [vpName]: full };

    // Section positions and pictures
    const boxes: Array<{ id: string; top: number; height: number; width: number }> = await page.evaluate(() =>
      [...document.querySelectorAll('[id^="shopify-section-"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id.replace(/^shopify-section-/, ""), top: Math.round(r.top + window.scrollY), height: Math.round(r.height), width: Math.round(r.width) };
      }),
    );
    for (const s of sp.sections) {
      const b = boxes.find((x) => x.id === s.domId);
      if (!b) continue;
      s.screens ??= {};
      if (vpName === "desktop") {
        s.screens.top = b.top;
        s.screens.height = b.height;
        s.screens.aboveFold = b.top < VIEWPORTS.desktop.height && b.height > 0;
      }
      // Header/footer look the same everywhere: picture them on the homepage only.
      if (s.hidden || b.height < 12 || b.width < 12 || (s.group !== "template" && sp.kind !== "home")) continue;
      const file = `${base}-${s.key.replace(/[^\w-]/g, "_")}.jpg`;
      try {
        await page.screenshot({
          path: path.join(opts.screensDir, file),
          type: "jpeg",
          quality: 72,
          fullPage: true,
          clip: { x: 0, y: b.top, width: VIEWPORTS[vpName].width, height: Math.min(b.height, 4000) },
        });
        s.screens[vpName] = file;
      } catch {
        /* a single failed section picture shouldn't fail the scan */
      }
    }

    const measured = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      // encodedBodySize still counts files served from the browser cache, so every page is weighed fairly.
      const size = (r: PerformanceResourceTiming) => Math.max(r.transferSize || 0, r.encodedBodySize || 0);
      const transfer = (nav ? size(nav) : 0) + res.reduce((a, r) => a + size(r), 0);
      const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src) && !(i.currentSrc || i.src).startsWith("data:")).map((i) => i.currentSrc || i.src);
      return {
        loadMs: Math.round(nav ? nav.loadEventEnd - nav.startTime : 0),
        transferBytes: transfer,
        brokenImages: [...new Set(broken)].slice(0, 30),
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      };
    });

    const design = vpName === "desktop" && sp.kind === "home" ? await readDesign(page) : null;
    return {
      design,
      metrics: {
        loadMs: measured.loadMs,
        requests,
        transferBytes: measured.transferBytes,
        failedRequests: [...new Set(failed)].slice(0, 30),
        brokenImages: measured.brokenImages,
        consoleErrors,
        mobileOverflowPx: vpName === "mobile" ? measured.overflow : 0,
      },
    };
  } finally {
    await page.close();
  }
}

async function readDesign(page: any): Promise<DesignTokens> {
  return page.evaluate(() => {
    const toHex = (c: string): string | null => {
      const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
      if (!m) return null;
      if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return null;
      return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    };
    const firstFamily = (f: string) => f.split(",")[0].replace(/["']/g, "").trim();
    const counts = new Map<string, { uses: number; role: string }>();
    const bump = (hex: string | null, role: string, w: number) => {
      if (!hex) return;
      const cur = counts.get(hex) ?? { uses: 0, role };
      cur.uses += w;
      counts.set(hex, cur);
    };
    const els = [...document.querySelectorAll("body *")].slice(0, 4000) as HTMLElement[];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      bump(toHex(cs.backgroundColor), "background", Math.min(50, (r.width * r.height) / 20000));
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) bump(toHex(cs.color), "text", 1);
    }
    const bodyCs = getComputedStyle(document.body);
    bump(toHex(bodyCs.backgroundColor), "background", 100);
    const btn = document.querySelector(".btn, .button, [class*='button'], button[type='submit']") as HTMLElement | null;
    if (btn) bump(toHex(getComputedStyle(btn).backgroundColor), "button", 30);
    const heading = document.querySelector("h1, h2") as HTMLElement | null;
    const vars: Record<string, string> = {};
    const rootCs = getComputedStyle(document.documentElement);
    for (let i = 0; i < rootCs.length && Object.keys(vars).length < 60; i++) {
      const name = rootCs[i];
      if (!name.startsWith("--")) continue;
      const v = rootCs.getPropertyValue(name).trim();
      if (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/.test(v) || /^hsla?\(/.test(v) || /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v)) vars[name] = v;
    }
    const fonts: Array<{ family: string; role: string }> = [{ family: firstFamily(bodyCs.fontFamily), role: "body text" }];
    if (heading) {
      const hf = firstFamily(getComputedStyle(heading).fontFamily);
      if (hf && hf !== fonts[0].family) fonts.unshift({ family: hf, role: "headings" });
      else fonts[0].role = "headings and body text";
    }
    return {
      colors: [...counts].sort((a, b) => b[1].uses - a[1].uses).slice(0, 10).map(([value, v]) => ({ value, uses: Math.round(v.uses), role: v.role })),
      fonts,
      cssColorVariables: vars,
    };
  });
}
