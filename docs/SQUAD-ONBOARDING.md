# Squad Onboarding — MCP Coverage Buildout

Welcome to the parallel buildout. You're one of 14 squads turning 110 tools into agent-callable MCP actions in ~5–8 days of wall-clock work.

## 1. Setup (once per squad)

```bash
# From the toolkit root:
git fetch origin
git worktree add ".worktrees/squad-{N}" -b "squad/{N}-{slug}" origin/master
cd ".worktrees/squad-{N}"
npm install
```

Replace `{N}` and `{slug}` with your squad number (e.g. `1`, `12a`) and slug (e.g. `sprint-planning`). See [`.github/CODEOWNERS`](../.github/CODEOWNERS) for the canonical list.

## 2. Your scope

Every squad owns a fixed slice of `src/app/(tools)/` and exactly one action file under `src/lib/actions/tools/`. **No squad touches another squad's directories.** The scope is enforced by CODEOWNERS and validated in CI.

| If you need...                   | Do this                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A new tool action                | Add to your category action file, or create `src/lib/actions/tools/{tool-id}.ts` if your entity is unique |
| To add a new workspace entity    | Open an **infra-ask** issue → S0 batches daily                                                            |
| To touch shared signal-bus types | Open an **infra-ask** issue → S0                                                                          |
| To extend the workspace store    | Open an **infra-ask** issue → S0                                                                          |
| To bump rate limits or auth      | Open an **infra-ask** issue → S0                                                                          |

S0-protected (do not touch directly): see the full list in [`.github/CODEOWNERS`](../.github/CODEOWNERS#L19-L43).

## 3. Per-tool story template

For each tool you own, complete this checklist. One PR per tool (or per small group of related compute-only tools).

```
STORY: {tool-id} — MCP coverage + quality lift
SQUAD: S{n}
SIZE: S | M | L  (see Estimation Rubric below)
WORKTREE: .worktrees/squad-{n}/
BRANCH:   squad/{n}-{slug}

ACCEPTANCE CRITERIA (all must pass before PR):
[ ] Action file: append to src/lib/actions/tools/{category-slug}.ts
                 or create src/lib/actions/tools/{tool-id}.ts (new file
                 if entity is unique to this tool)
[ ] Minimum action set:
      • {tool-id}.list_state                    (read)   required for ALL tools
      • {tool-id}.compute_{primary}             (read)   required for compute tools
      • workspace.{entity}.create|update|delete (write)  via defineCrudActions (often already exists)
      • {tool-id}.{verb}_*                      (write)  tool-specific verbs
      • {tool-id}.persist_to_prioritization     (write)  required for calc tools
[ ] Every action has zod paramsSchema + meaningful description (≥1 sentence, examples preferred)
[ ] Every WRITE action has mcpHandler that hits src/lib/actions/server-store.ts (NOT Zustand)
[ ] Destructive writes set requiresConfirmation: true
[ ] Action ids appear in /api/mcp tools/list response
[ ] MCP smoke test passes: npm run mcp:smoke -- --tool {tool-id}
[ ] Client file ≤ 800 lines (split into ./_components/ if larger;
    mandatory for the 5 god-files: health-dashboard, sprint-review,
    retro, impediments, prioritizer)
[ ] Heavy deps lazy-loaded via next/dynamic (use the shared <Chart>
    shell from src/components/charts/lazy-chart.tsx for Recharts)
[ ] No console.* in production paths (ESLint enforced; use the
    eslint-disable-next-line escape only when intentionally dev-only)
[ ] Mobile breakpoint verified at 375px (no horizontal overflow)
[ ] a11y: keyboard focus + ARIA labels on every interactive element;
    aria-label on every form input that doesn't have a visible <Label>
[ ] Brief doc: docs/tools/{tool-id}.md listing exposed actions
    + example agent prompts
```

### Estimation Rubric

| Size  | Profile                                                              | Examples                                                                                                          |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **S** | No entity, compute-only, ≤1 chart                                    | wsjf, cost-of-delay, eisenhower                                                                                   |
| **M** | Single-entity CRUD, 1–2 charts                                       | nps-csat, mood-tracker, raci                                                                                      |
| **L** | Multi-entity, realtime, predicted-defaults, OR god-file > 1100 lines | health-dashboard, sprint-review, retro, impediments, prioritizer, pi-planning, agentic-workflow, llm-eval-tracker |

## 4. How to write a tool action

The canonical example is [src/lib/actions/tools/canvas.ts](../src/lib/actions/tools/canvas.ts). Every action has the same shape:

```ts
registry.register({
  id: "tool.{tool-id}.{verb}",
  toolId: "tool.{tool-id}",
  name: "{verb}",
  category: "read" | "write" | "intent",
  description: "One-line description shown to the agent.",
  requiresConfirmation: true,  // for destructive writes
  paramsSchema: z.object({ ... }),
  handler: async (params, ctx) => { /* browser path: useWorkspaceStore */ },
  mcpHandler: async (params, ctx) => { /* server path: server-store.ts */ },
});
```

For pure-compute tools (calculators), omit `mcpHandler` — the `handler` runs anywhere. Then add a separate `persist_to_prioritization` action that writes results to `workspace.prioritization` via `serverUpsertEntity`.

**Use the scaffold:** `npm run scaffold:action -- --tool {tool-id} --entity {EntityName}` emits a skeleton with the correct shape.

## 5. Verifying your work

```bash
# Type-check + lint
npm run lint
npx tsc --noEmit

# Smoke test (calls every action with stub args via /api/mcp)
npm run mcp:smoke -- --tool {tool-id}

# Visual + behavioral check via the preview server
npm run dev
# then visit http://localhost:3000/{tool-id} and exercise the UI
```

## 6. Daily flow

1. Pull `origin/master` into your worktree each morning (S0 ships foundation fixes daily)
2. Pick the next tool from your queue
3. Run the scaffold, fill in the action handlers
4. Lift the tool client per the acceptance criteria
5. Smoke-test, lint, type-check
6. Open a draft PR; mark ready when smoke passes
7. S0 reviews and merges within the same day

## 7. Common pitfalls

- **Forgetting `mcpHandler`.** A write action without it silently no-ops for MCP callers (the server-side Zustand singleton is empty). The smoke test catches this.
- **Schema collisions after dot→underscore munging.** `tool.foo_bar.create` and `tool_foo.bar.create` collide in Anthropic-format names. The registry throws at register time; pick a non-colliding id.
- **Hitting Zustand from `mcpHandler`.** It compiles, runs in CI, and silently fails in production for MCP callers. Always use `server-store.ts` helpers.
- **Touching the workspace store / signal bus.** S0-only territory — open an infra-ask issue.
- **Importing Recharts directly.** Use the lazy `<Chart>` shell to keep route bundles light.

## 8. Done definition for the squad

Your squad is done when:

- Every tool you own has its full action set + quality lift PR merged
- `npm run mcp:smoke -- --squad {N}` returns 100% green
- Every tool you own has a `docs/tools/{tool-id}.md` page
- Lighthouse regression vs. baseline ≤ +5% across your tools
