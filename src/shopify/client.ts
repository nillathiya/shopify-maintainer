// Minimal, read-only Shopify Admin GraphQL client with both auth styles and throttle-aware retries.
import { config } from "../config.ts";
import { getSettings } from "../memory/settings.ts";

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const s = getSettings();
  if (s.adminToken) return s.adminToken;
  if (!s.clientId || !s.clientSecret) {
    throw new Error("Admin access isn't set up. Add an admin token, or a client ID and secret, in Settings.");
  }
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  // Client credentials grant (Dev Dashboard apps on stores in your own organization).
  const res = await fetch(`https://${s.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret }),
  });
  if (!res.ok) throw new Error(`Shopify token request failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

export class ShopifyError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);
/** Tests inject a fake transport here. */
export function setShopifyFetch(f: Fetcher): void {
  fetcher = f;
}

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const url = `https://${getSettings().shopDomain}/admin/api/${config.apiVersion}/graphql.json`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
      body: JSON.stringify({ query, variables }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new ShopifyError(`Shopify API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };
    if (body.errors?.some((e) => e.extensions?.code === "THROTTLED") && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (body.errors?.length) throw new ShopifyError(body.errors.map((e) => e.message).join("; "), body.errors);
    return body.data as T;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

