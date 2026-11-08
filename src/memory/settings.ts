// Store connection + scan preferences, editable from the Settings screen.
// Values in .env (if any) win over values saved from the UI.
import { config } from "../config.ts";
import { kvGet, kvSet } from "./db.ts";

export interface StoreSettings {
  storeUrl: string; // public address, e.g. https://rolltop.in
  storefrontPassword: string;
  shopDomain: string; // *.myshopify.com, discovered by the first scan
  scanDepth: "full" | "quick"; // full = every page; quick = one page of each kind
  maxPages: number; // safety cap for very large stores
  takePictures: boolean;
  checkLinks: boolean;
  // Optional admin access (read-only scopes) for the deeper theme scan
  adminToken: string;
  clientId: string;
  clientSecret: string;
}

export const DEFAULT_SETTINGS: StoreSettings = {
  storeUrl: "",
  storefrontPassword: "",
  shopDomain: "",
  scanDepth: "full",
  maxPages: 300,
  takePictures: true,
  checkLinks: true,
  adminToken: "",
  clientId: "",
  clientSecret: "",
};

export function normalizeStoreUrl(input: string): string {
  let s = input.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return "";
  }
}

export function getSettings(): StoreSettings {
  const saved = { ...DEFAULT_SETTINGS, ...kvGet<Partial<StoreSettings>>("settings", {}) };
  return {
    ...saved,
    storeUrl: normalizeStoreUrl(config.storefrontUrl || saved.storeUrl),
    storefrontPassword: config.storefrontPassword || saved.storefrontPassword,
    shopDomain: config.shop || saved.shopDomain,
    adminToken: config.adminToken || saved.adminToken,
    clientId: config.clientId || saved.clientId,
    clientSecret: config.clientSecret || saved.clientSecret,
  };
}

export function saveSettings(patch: Partial<StoreSettings>): StoreSettings {
  const current = { ...DEFAULT_SETTINGS, ...kvGet<Partial<StoreSettings>>("settings", {}) };
  const next: StoreSettings = { ...current };
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof StoreSettings>) {
    if (patch[k] === undefined) continue;
    const d = DEFAULT_SETTINGS[k];
    (next as any)[k] = typeof d === "boolean" ? Boolean(patch[k]) : typeof d === "number" ? Number(patch[k]) || d : String(patch[k]).trim();
  }
  next.scanDepth = next.scanDepth === "quick" ? "quick" : "full";
  next.maxPages = Math.max(10, Math.min(5000, next.maxPages));
  next.storeUrl = normalizeStoreUrl(next.storeUrl);
  kvSet("settings", next);
  return getSettings();
}

export function adminConfigured(s = getSettings()): boolean {
  return Boolean(s.shopDomain && (s.adminToken || (s.clientId && s.clientSecret)));
}

/** Settings safe to send to the browser (secrets masked). */
export function publicSettings(s = getSettings()) {
  const mask = (v: string) => (v ? "••••" + v.slice(-4) : "");
  return {
    ...s,
    storefrontPassword: s.storefrontPassword ? "••••" : "",
    adminToken: mask(s.adminToken),
    clientSecret: mask(s.clientSecret),
    adminConnected: adminConfigured(s),
    lockedByEnv: {
      storeUrl: Boolean(config.storefrontUrl),
      adminToken: Boolean(config.adminToken),
      clientId: Boolean(config.clientId),
      clientSecret: Boolean(config.clientSecret),
    },
  };
}
