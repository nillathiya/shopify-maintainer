import { serve } from "@hono/node-server";
import { config } from "./config.ts";
import { createApp } from "./server/app.ts";

const app = createApp();
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`\n  Store Maintainer is running.\n  Open http://localhost:${info.port} in your browser.\n  (Press Ctrl+C to stop.)\n`);
});
