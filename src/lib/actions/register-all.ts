/**
 * Side-effect entry point that imports every action module so the
 * registry is fully populated.
 *
 * Import this ONCE per runtime entry:
 *   - In the browser, from `app-shell.tsx` (top-of-file)
 *   - In API routes (agent/MCP), from each route handler
 *
 * Order doesn't matter — each module calls `registry.register()` at
 * module-load, and the registry de-duplicates by id.
 */

// Workspace CRUD (auto-generated per-entity)
import "./workspace";
import "./workspace/scalars";

// Tool-local actions
import "./tools/canvas";

// Intents — high-level compositions
import "./intents/start-retro";
import "./intents/plan-sprint";

export {};
