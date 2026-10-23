# Agile Toolkit — MCP Agent Surface

How authorized AI agents call the Agile Toolkit via the Model Context Protocol. Every tool keeps its actions, including the ones the UI shelves under “More tools” (`shelf: "more"` in `src/lib/constants/tools.ts`).

## 1. Architecture

```
┌─────────────────┐       stdio        ┌─────────────────┐       HTTPS         ┌──────────────────┐
│  Claude Desktop │ ─────────────────► │   MCP relay     │ ─────────────────►  │  /api/mcp        │
│  Claude Code    │  JSON-RPC 2.0      │  (Node binary)  │  Bearer PAT          │  (Next.js route) │
│  Other MCP host │                    │  mcp-server/    │  JSON-RPC 2.0        │                  │
└─────────────────┘                    └─────────────────┘                      └──────────────────┘
                                                                                          │
                                                                                          ▼
                                                                              ┌──────────────────────┐
                                                                              │  Action registry     │
                                                                              │  (singleton, hot-     │
                                                                              │   loaded per route)  │
                                                                              └──────────────────────┘
                                                                                          │
                                                          ┌───────────────────────────────┼───────────────────────────────┐
                                                          ▼                               ▼                               ▼
                                            ┌──────────────────┐            ┌──────────────────┐            ┌──────────────────┐
                                            │  workspace.*     │            │  tool.{tool}.*   │            │  intent.*        │
                                            │  (entity CRUD)   │            │  (tool verbs)    │            │  (compositions)  │
                                            └──────────────────┘            └──────────────────┘            └──────────────────┘
                                                          │                               │                               │
                                                          └───────────────────────────────┴───────────────────────────────┘
                                                                                          │
                                                                                          ▼
                                                                              ┌──────────────────────┐
                                                                              │ server-store.ts      │
                                                                              │ (Supabase service-   │
                                                                              │  role, bypasses RLS) │
                                                                              └──────────────────────┘
```

## 2. Action namespaces

| Namespace                   | Purpose                                                     | Example                                                            |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `workspace.{entity}.{verb}` | Generic CRUD over typed workspace entities                  | `workspace.sprint.create`, `workspace.impediment.list`             |
| `tool.{tool-id}.{verb}`     | Tool-specific verbs (semantics that don't fit generic CRUD) | `tool.canvas.add_sticky`, `tool.planning_poker.cast_vote`          |
| `intent.{name}`             | Compositions across multiple tools/entities                 | `intent.start_retro_for_sprint`, `intent.run_sprint_retrospective` |

### Categories

| `category` field | Semantics                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `read`           | Pure read. No mutation, no confirmation required. Rate-limit headroom 600/min                        |
| `write`          | Mutates state. Confirmation required for destructive verbs (delete, bulk_upsert). Rate-limit 120/min |
| `intent`         | High-level composition. Always requires confirmation. Rate-limit 30/min                              |

## 3. Authentication

Bearer-only. Mint a Personal Access Token at `/settings/access-tokens` (or via the owner UI). PATs:

- Are `pat_…` prefixed (36 chars total: the `pat_` prefix + 32 base64url chars = 192 bits)
- Are shown ONCE on creation, then stored as `scrypt(token, per_token_salt)`
- Default to 90-day expiry; can be revoked at any time
- Carry an optional `squad_profile_ids` scope (see §4)

```bash
curl -X POST https://agile.amrelharony.com/api/mcp \
  -H "Authorization: Bearer pat_xxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 4. Squad-scoped agents

A PAT may be minted with a `squad_profile_ids: uuid[]` scope. When set:

- `read` actions return only entities authored by (or visible to) the scoped squad profiles
- `write` actions are tagged with the first scoped squad profile in `history_events.squad_profile_id`
- `intent` actions inherit the scope; sub-actions they compose are filtered the same way
- Empty array `[]` (the default) = full workspace access for the issuing user

Use squad-scoped PATs when one user runs multiple parallel agents that should not see each other's data.

## 5. JSON-RPC methods

Subset of MCP 2024-11-05 implemented:

| Method                      | Purpose                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `initialize`                | Protocol handshake — returns `protocolVersion`, `capabilities`, `serverInfo`                  |
| `tools/list`                | Returns every callable action as `{ name, description, inputSchema }`                         |
| `tools/call`                | Invokes an action: `{ name, arguments }` → `{ content: [{type:"text",text:"..."}], isError }` |
| `notifications/initialized` | Client → server ready notification (no response)                                              |

Anything else → `-32601 method not found`.

## 6. Result envelope

`tools/call` always returns a `content` array. The single text block is the JSON-stringified handler result. Handlers that throw produce `isError: true` with `{error: "..."}` in the text. This lets agents distinguish:

- **Schema rejection** (`-32602 Invalid arguments`) — caller fixes args
- **Semantic failure** (`isError: true`) — caller adapts (e.g. sprint not found)
- **Internal error** (`-32603 Internal error`) — bug; surfaces to logs

## 7. Example workflows

### Plan a sprint and log impediments

```jsonc
// 1. list current sprints
{"method":"tools/call","params":{"name":"workspace.sprint.list","arguments":{}}}

// 2. create a new sprint
{"method":"tools/call","params":{"name":"workspace.sprint.create","arguments":{
  "entity": {"id":"sprint_x", "name":"Sprint 42", "startDate":"2026-06-01",
             "endDate":"2026-06-14", "pointsPlanned": 40, "status":"planned"}
}}}

// 3. log an impediment that came up
{"method":"tools/call","params":{"name":"workspace.impediment.create","arguments":{
  "entity": {"id":"imp_x", "title":"Staging env flaky", "severity":"high",
             "raisedAt":"2026-06-01T10:00:00Z"}
}}}
```

### Log a sprint's day (shared by Burndown, Burnup and Sprint Metrics)

A sprint's daily log and ratings live in `workspace.sprint_series`, one row per sprint whose `id` **is the sprint's id**. A create without an `id` is rejected. Day 0 is the sprint's `startDate`, counted in calendar days. Burndown records `remaining`, Burnup records `completed` and `scope`, and each tool derives the other's number, so write the one you have.

```jsonc
// create the series for sprint_x with day 0 and day 1
{"method":"tools/call","params":{"name":"workspace.sprint_series.create","arguments":{
  "entity": {"id":"sprint_x", "days":[{"day":0,"remaining":40},{"day":1,"remaining":37}]}
}}}

// later: replace the days (update writes the fields you pass; send the whole days array)
{"method":"tools/call","params":{"name":"workspace.sprint_series.update","arguments":{
  "id":"sprint_x",
  "patch": {"days":[{"day":0,"remaining":40},{"day":1,"remaining":37},
                    {"day":2,"remaining":38,"scope":43,"scopeChange":true,"note":"Refunds added"}]}
}}}

// Sprint Comparison ratings (1-10) by dimension
{"method":"tools/call","params":{"name":"workspace.sprint_series.update","arguments":{
  "id":"sprint_x", "patch": {"ratings":{"Velocity":7,"Quality":8,"Predictability":6}}
}}}
```

Deleting a sprint in the app also deletes its series. `workspace.sprint.delete` over MCP removes only the sprint row. Delete the series too (`workspace.sprint_series.delete`), or leave it: the app ignores a series whose sprint is gone.

The team's ceremony cadence (sprint length, Daily Scrum time and weekdays, Planning, Review and Retro times, the weekly refinement slot) is one document, `workspace.ceremony_cadence` with id `ceremony-cadence:current`: `tool.ceremony_cadence.get` returns it normalised (the defaults while unset) and `tool.ceremony_cadence.set` patches the fields you pass (times are local `HH:MM`, weekdays 0 = Sunday … 6 = Saturday, a bad value is rejected). It also holds the team's working calendar, both optional: `workingDays` (the weekdays the team works; Monday to Friday while unset) and `holidays` (`YYYY-MM-DD`; `[]` clears them). The sprint maths count working days with it (`lib/sprints/calendar.ts`), and there is no Daily Scrum or refinement on a holiday.

A story's status is `workspace.story` with one of `backlog`, `todo`, `in_progress`, `review`, `done`. Changing it through `workspace.story.update` (or creating a story already in progress) stamps the flow fields the app's sprint board writes: `startedAt` (moved into in progress, review or done; cleared when it goes back to the backlog or to do), `doneAt` (moved to done; cleared when it leaves), `statusHistory` (`{status, from, at}`, the latest 50) and clears `blocked` on done. Send those fields only to backfill: a value you set in the same patch is kept as you wrote it.

### Run a retro for a sprint (composed intent)

```jsonc
{
  "method": "tools/call",
  "params": {
    "name": "intent.start_retro_for_sprint",
    "arguments": {
      "sprintId": "sprint_x",
    },
  },
}
// → returns boardId; agent UI navigates to /canvas?b={boardId}
```

### Score a backlog with WSJF then persist top items

```jsonc
// 1. compute scores
{"method":"tools/call","params":{"name":"tool.wsjf.compute_scores","arguments":{
  "items": [{"id":"f1","businessValue":8,"timeCriticality":5,"riskReduction":3,"jobSize":3}]
}}}

// 2. persist top-N to workspace prioritization
{"method":"tools/call","params":{"name":"tool.wsjf.persist_to_prioritization","arguments":{
  "items": [/* scored items from step 1 */], "framework": "wsjf"
}}}
```

## 8. Rate limits

Per-PAT, token-bucket:

| Category | Limit     | Headers on 429    |
| -------- | --------- | ----------------- |
| `read`   | 600 / min | `Retry-After: 60` |
| `write`  | 120 / min | `Retry-After: 60` |
| `intent` | 30 / min  | `Retry-After: 60` |

Body cap: 1 MiB. Batch cap: 100 requests per array.

## 9. Discovering actions

`tools/list` returns the full registry. Filter client-side by the name prefix:

- `workspace.` — generic CRUD
- `tool.` — tool-specific verbs
- `intent.` — compositions

The `description` field on each tool is the agent's only hint about when to call it. Action authors: write descriptions that complete the sentence "call this when the user wants to \_\_\_".

## 10. Squad-execution audit trail

Every `tools/call` is logged to `mcp_call_log` with `{action_id, ms, user_id, squad_profile_ids, isError}`. The toolkit's `/history` and `/insights` pages surface these for both human and agent attribution. Squad-scoped PATs additionally tag `history_events.squad_profile_id` so the activity feed colors agent writes by squad.

## 11. Local development

```bash
# Run the toolkit (serves /api/mcp on http://localhost:3000)
npm run dev

# Run the MCP relay so Claude Desktop / Claude Code can connect
cd mcp-server && npm start

# Configure Claude Desktop to point at the relay (claude_desktop_config.json):
{
  "mcpServers": {
    "agile-toolkit": {
      "command": "node",
      "args": ["/abs/path/to/mcp-server/dist/index.js"],
      "env": {
        "AGILE_TOOLKIT_URL": "http://localhost:3000",
        "AGILE_TOOLKIT_PAT": "pat_xxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## 12. Writing a new action

See [docs/SQUAD-ONBOARDING.md §4](SQUAD-ONBOARDING.md#4-how-to-write-a-tool-action) and the canonical example at [src/lib/actions/tools/canvas.ts](../src/lib/actions/tools/canvas.ts).
