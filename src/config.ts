import { existsSync } from "node:fs";
import path from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = (k: string, d = "") => (process.env[k] ?? "").trim() || d;

export const config = {
  shop: env("SHOPIFY_SHOP").replace(/^https?:\/\//, "").replace(/\/$/, ""),
  storefrontUrl: env("STOREFRONT_URL").replace(/\/$/, ""),
  storefrontPassword: env("STOREFRONT_PASSWORD"),
  adminToken: env("SHOPIFY_ADMIN_TOKEN"),
  clientId: env("SHOPIFY_CLIENT_ID"),
  clientSecret: env("SHOPIFY_CLIENT_SECRET"),
  apiVersion: env("SHOPIFY_API_VERSION", "2026-10"),
  port: Number(env("PORT", "4747")),
  dataDir: path.resolve(env("DATA_DIR", "./data")),
  chromiumPath: env("CHROMIUM_PATH"),
};
