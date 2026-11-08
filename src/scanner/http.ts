// Polite storefront fetcher: identifies itself, limits concurrency, honours 429 Retry-After,
// and keeps cookies so password-protected storefronts can be unlocked.

export const USER_AGENT = "shopify-maintainer/0.1 (+https://github.com/nillathiya/shopify-maintainer)";

export interface FetchResult {
  url: string;
  status: number;
  body: string;
  ms: number;
  bytes: number;
}

let defaultFetch: typeof fetch = (...a) => fetch(...a);
/** Tests replace the network with a fake store here. */
export function setDefaultFetch(f: typeof fetch | null): void {
  defaultFetch = f ?? ((...a) => fetch(...a));
}

export class StorefrontClient {
  private cookies = new Map<string, string>();
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(public base: string, private maxConcurrent = 3, private fetchImpl: typeof fetch = (...a) => defaultFetch(...a)) {
    this.base = base.replace(/\/$/, "");
  }

  abs(pathOrUrl: string): string {
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
    if (pathOrUrl.startsWith("//")) return "https:" + pathOrUrl;
    return this.base + (pathOrUrl.startsWith("/") ? "" : "/") + pathOrUrl;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(res: Response): void {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async get(pathOrUrl: string, opts: { method?: string; body?: URLSearchParams; accept?: string } = {}): Promise<FetchResult> {
    const url = this.abs(pathOrUrl);
    return this.slot(async () => {
      for (let attempt = 0; ; attempt++) {
        const t0 = Date.now();
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            method: opts.method ?? "GET",
            body: opts.body,
            redirect: "follow",
            headers: {
              "User-Agent": USER_AGENT,
              Accept: opts.accept ?? "text/html,application/json;q=0.9,*/*;q=0.8",
              ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}),
            },
            signal: AbortSignal.timeout(30_000),
          });
        } catch (e) {
          if (attempt < 2) {
            await sleep(1000 * (attempt + 1));
            continue;
          }
          throw new Error(`Could not reach ${url}: ${(e as Error).message}`);
        }
        this.storeCookies(res);
        if (res.status === 429 && attempt < 4) {
          const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
          await sleep(Math.min(wait, 30) * 1000);
          continue;
        }
        const body = opts.method === "HEAD" ? "" : await res.text();
        return { url: res.url || url, status: res.status, body, ms: Date.now() - t0, bytes: body.length };
      }
    });
  }

  async json<T>(pathOrUrl: string): Promise<T | null> {
    const r = await this.get(pathOrUrl, { accept: "application/json" });
    if (r.status !== 200) return null;
    try {
      return JSON.parse(r.body) as T;
    } catch {
      return null;
    }
  }

  /** Returns true when the storefront was locked and is now unlocked. */
  async unlock(password: string): Promise<boolean> {
    const body = new URLSearchParams({ form_type: "storefront_password", utf8: "✓", password });
    const r = await this.get("/password", { method: "POST", body });
    return !r.url.includes("/password");
  }

  cookieList(domain: string): Array<{ name: string; value: string; domain: string; path: string }> {
    return [...this.cookies].map(([name, value]) => ({ name, value, domain, path: "/" }));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run fn over items with a concurrency limit, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
