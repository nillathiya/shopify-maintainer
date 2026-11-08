// Command-line scan: `npm run scan -- rolltop.in`
import { runScanNow, latestSnapshot } from "./scanner/pipeline.ts";

const url = process.argv[2];
let last = "";
const job = await runScanNow({
  storeUrl: url,
  onUpdate: (j) => {
    const line = j.steps.map((s) => ({ waiting: "·", running: "›", done: "✓", skipped: "–", failed: "✗" })[s.status]).join("") + "  " + j.message;
    if (line !== last) console.log(line);
    last = line;
  },
});
if (job.status === "failed") {
  console.error("Scan failed:", job.error);
  process.exit(1);
}
const snap = latestSnapshot()!;
console.log(`\n${snap.identity.name} — ${snap.stats.products} products, ${snap.stats.collections} collections, ${snap.stats.homeSections} homepage sections`);
for (const f of snap.findings) console.log(`  [${f.severity}] ${f.title}`);
if (snap.warnings.length) console.log("\nNotes:\n  " + snap.warnings.join("\n  "));
