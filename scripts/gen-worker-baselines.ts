// Regenerates worker/baselines.ts from the exported dist/data/baselines-*.json.
// The edge Worker bakes league baselines in (they aren't served from the static
// site and rarely change), so after a weekly refresh + `bun run export` this must
// be re-run and the worker redeployed to pick up new baselines.
//
// Usage:  bun run scripts/gen-worker-baselines.ts
import type { LiveBaselines } from "../src/domains/live/index.ts";

const SERIES = [1, 2, 3];
const out: Record<number, LiveBaselines> = {};
for (const s of SERIES) {
  const path = `dist/data/baselines-${s}.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Missing ${path} — run \`bun run export\` first.`);
  }
  out[s] = (await file.json()) as LiveBaselines;
}

const body = `// GENERATED — do not edit by hand.
// Baked per-series league baselines for edge live-metric computation, copied from
// dist/data/baselines-{series}.json (emitted by \`bun run export\`). They are tiny
// and change ~weekly; regenerate with:  bun run scripts/gen-worker-baselines.ts
// then redeploy the worker.
import type { LiveBaselines } from "../src/domains/live/index.ts";

export const BASELINES: Record<number, LiveBaselines> = ${JSON.stringify(out, null, 2)};
`;

await Bun.write("worker/baselines.ts", body);
console.log(`wrote worker/baselines.ts (series ${SERIES.join(", ")})`);
