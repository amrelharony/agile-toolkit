#!/usr/bin/env node
/**
 * Emit a skeleton tool-action file for one of the 110 tools.
 *
 * Usage:
 *   npm run scaffold:action -- --tool {tool-id} [--entity {EntityName}] [--out {path}]
 *
 * Example:
 *   npm run scaffold:action -- --tool planning-poker --entity PokerVote
 *
 * Produces src/lib/actions/tools/{tool-id}.ts unless --out is given.
 * Refuses to overwrite an existing file; pass --force to clobber.
 *
 * Looks the tool up in src/lib/constants/tools.ts to copy its name,
 * description, and category into the file header so the scaffold
 * arrives pre-contextualised. If the tool is not in the registry, the
 * script falls back to placeholders and prints a warning.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// ── arg parse ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf("--" + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const flag = (name) => args.includes("--" + name);

const toolId = arg("tool");
const entityName = arg("entity") ?? null;
const outOverride = arg("out");
const force = flag("force");

if (!toolId) {
  console.error(
    "Usage: scaffold-action --tool {tool-id} [--entity {EntityName}] [--out {path}] [--force]"
  );
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]+$/.test(toolId)) {
  console.error("Tool id must be kebab-case (lowercase letters, digits, hyphens). Got:", toolId);
  process.exit(1);
}

// snake_case for action ids (registry convention) and PascalCase for
// type names. ToolId "planning-poker" → snake "planning_poker",
// pascal "PlanningPoker".
const toolSnake = toolId.replaceAll("-", "_");
const toolPascal = toolId
  .split("-")
  .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
  .join("");

// ── look up the tool in tools.ts (best-effort) ─────────────────────
let toolMeta = null;
try {
  const toolsTs = readFileSync(join(ROOT, "src", "lib", "constants", "tools.ts"), "utf-8");
  // Cheap parse: find `id: "{toolId}"` then grab the surrounding name +
  // description from the immediate sibling fields. Not robust to weird
  // formatting, but tools.ts uses a consistent shape.
  const idRe = new RegExp(
    String.raw`\{\s*id:\s*"${toolId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}",[\s\S]*?\}`,
    "m"
  );
  const m = toolsTs.match(idRe);
  if (m) {
    const block = m[0];
    const name = (block.match(/name:\s*"([^"]+)"/) ?? [])[1];
    const description = (block.match(/description:\s*"([^"]+)"/) ?? [])[1];
    const category = (block.match(/category:\s*"([^"]+)"/) ?? [])[1];
    toolMeta = { name, description, category };
  }
} catch {
  // tools.ts not readable — fall through to placeholders
}

if (!toolMeta) {
  console.warn(`[scaffold] '${toolId}' not found in tools.ts — using placeholders.`);
  toolMeta = {
    name: toolPascal,
    description: "TODO: describe what this tool does.",
    category: "TODO: ToolCategory",
  };
}

// ── compose the file ───────────────────────────────────────────────
const outPath = outOverride
  ? isAbsolute(outOverride)
    ? outOverride
    : join(ROOT, outOverride)
  : join(ROOT, "src", "lib", "actions", "tools", `${toolId}.ts`);

if (existsSync(outPath) && !force) {
  console.error(`Refusing to overwrite ${outPath} — pass --force to clobber.`);
  process.exit(1);
}

const entityImport = entityName
  ? `import type { ${entityName} } from "@/lib/stores/workspace-types";\n`
  : "";

const entitySchemaSection = entityName
  ? `
// Loose schema — the workspace store's runtime checks own real
// validation. This schema exists primarily so /tools/list advertises
// the field names to the agent. Tighten if the entity is a primary
// agent surface.
const ${entityName}Schema = z.object({
  id: z.string(),
  // TODO: add the entity's fields here
}) as unknown as z.ZodType<${entityName}>;
`
  : "";

const computeStub = `
// ──────── tool.${toolSnake}.compute_primary ────────
// Read-only compute. Optional — delete if this tool has no computation
// to expose. For calculator tools (WSJF, ICE, RICE, etc.) this is the
// main agent entry point; add a sibling persist_to_prioritization
// action that writes the scored items to workspace.prioritization.
registry.register({
  id: "tool.${toolSnake}.compute_primary",
  toolId: "tool.${toolSnake}",
  name: "compute_primary",
  category: "read",
  description:
    "TODO: describe the computation and what the agent gets back. e.g. 'Score the given items by the ${toolMeta.name} formula and return them sorted descending.'",
  paramsSchema: z.object({
    // TODO: define inputs
    items: z.array(z.object({ id: z.string() })),
  }),
  handler: async (params) => {
    // TODO: implement
    return { items: params.items };
  },
});
`;

const listStateStub = `
// ──────── tool.${toolSnake}.list_state ────────
// Read-only snapshot of whatever state this tool manages. Required for
// every tool so an agent can introspect "what's currently set up here?"
// before deciding to act. If this tool's only state is a workspace
// entity already exposed via workspace.{entity}.list, you may delete
// this and document the redirect in the tool's docs/tools/{tool-id}.md.
registry.register({
  id: "tool.${toolSnake}.list_state",
  toolId: "tool.${toolSnake}",
  name: "list_state",
  category: "read",
  description: "Return the current state of the ${toolMeta.name} tool.",
  paramsSchema: z.object({}),
  handler: async () => {
    // Browser path — read from useWorkspaceStore
    return { /* TODO */ };
  },
  mcpHandler: async (_params, _ctx) => {
    // Server path — read from server-store.ts
    // const items = await serverListEntities<${entityName ?? "Entity"}>(ctx.userId, "workspace:${toolSnake}");
    return { /* TODO */ };
  },
});
`;

const writeVerbStub = `
// ──────── tool.${toolSnake}.<verb> ────────
// One or more tool-specific write verbs. Pattern: verbs describe what
// the agent intends ("cast_vote", "advance_phase", "reset_round"),
// not the storage operation. For generic CRUD, prefer the auto-
// generated workspace.${toolSnake}.{create|update|delete} actions —
// only add a tool verb when the semantics don't fit the CRUD shape.
// requiresConfirmation defaults true on write; flip false for
// idempotent additive ops.
//
// registry.register({
//   id: "tool.${toolSnake}.example_verb",
//   toolId: "tool.${toolSnake}",
//   name: "example_verb",
//   category: "write",
//   requiresConfirmation: false, // set true for destructive ops
//   description: "TODO: describe the action.",
//   paramsSchema: z.object({ /* … */ }),
//   handler: async (_params, _ctx) => {
//     return { /* … */ };
//   },
//   mcpHandler: async (_params, _ctx) => {
//     return { /* … */ };
//   },
// });
`;

const body = `/**
 * ${toolMeta.name} — tool-local actions.
 *
 * Category: ${toolMeta.category}
 * Tool:     ${toolMeta.description}
 *
 * Agent surface: tool.${toolSnake}.*
 * Generic CRUD over the backing entity (if any): workspace.${toolSnake}.*
 *
 * ─── ACCEPTANCE CRITERIA ─────────────────────────────────────────────
 * [ ] Action file imports compile, lint, and type-check
 * [ ] Minimum action set:
 *       • tool.${toolSnake}.list_state                  (read)
 *       • tool.${toolSnake}.compute_primary             (read, if applicable)
 *       • workspace.{entity}.create|update|delete       (via defineCrudActions in workspace/index.ts)
 *       • tool.${toolSnake}.{verb}_*                    (write, tool-specific)
 *       • tool.${toolSnake}.persist_to_prioritization   (write, calc tools only)
 * [ ] Every action has zod paramsSchema + 1-sentence description
 * [ ] Every WRITE action has mcpHandler that hits server-store.ts
 * [ ] Destructive writes set requiresConfirmation: true
 * [ ] MCP smoke test passes: npm run mcp:smoke -- --tool ${toolId}
 * [ ] Client file ≤ 800 lines (split into ./_components/ if larger)
 * [ ] Heavy deps lazy-loaded (use <Chart> for Recharts)
 * [ ] No console.* in production paths
 * [ ] Mobile breakpoint OK at 375px
 * [ ] a11y: keyboard + ARIA labels on interactive elements
 * [ ] docs/tools/${toolId}.md authored
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
${entityImport}// import { useWorkspaceStore } from "@/lib/stores/workspace-store";
// import {
//   serverListEntities,
//   serverGetEntity,
//   serverUpsertEntity,
//   serverDeleteEntity,
// } from "../server-store";
${entitySchemaSection}
${listStateStub}
${computeStub}
${writeVerbStub}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, "utf-8");
console.log(`[scaffold] wrote ${outPath}`);
console.log(`[scaffold] next steps:`);
console.log(`  1. Fill in TODOs in ${outPath}`);
console.log(`  2. Re-run dev to regenerate the registry: npm run dev`);
console.log(`  3. Smoke test: npm run mcp:smoke -- --tool ${toolId}`);
