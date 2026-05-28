/**
 * Side-effect entry point that imports every action module so the
 * registry is fully populated.
 *
 * Import this ONCE per runtime entry:
 *   - In the browser, from `app-shell.tsx` (top-of-file)
 *   - In API routes (agent/MCP), from each route handler
 *
 * The actual import list lives in `_generated/index.ts`, produced by
 * `scripts/generate-action-registry.mjs` on every pre{dev,build,test}
 * run. This indirection means 14 parallel squads can each drop new
 * action files under tools/intents/workspace/ without ever editing
 * this file — eliminating the merge-conflict bottleneck.
 */

import "./_generated";

export {};
