// `npm run build`: next build with room for the type check.
//
// Since the tools plan's phase 2 (2026-11-23), the type check that next build
// runs needs about 4.5 GB of heap (tsc --extendedDiagnostics), over Node's
// default (about 2 GB on a hosted runner, about 4 GB on a big machine), so
// the build ran out of memory. next build type-checks after webpack is done,
// in a child process that inherits NODE_OPTIONS, so this sets the heap there
// unless NODE_OPTIONS already names one (CI sets its own). Vercel runs
// `npm run build` too, so its builds get the same room.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const HEAP = "--max-old-space-size=6144";
const current = process.env.NODE_OPTIONS ?? "";
const nodeOptions = /--max-old-space-size=/.test(current) ? current : `${current} ${HEAP}`.trim();
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [next, "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
