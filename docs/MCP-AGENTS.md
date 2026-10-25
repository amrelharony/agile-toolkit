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

| Namespace                   | Purpose                                                     | Example                                                                  |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `workspace.{entity}.{verb}` | Generic CRUD over typed workspace entities                  | `workspace.sprint.create`, `workspace.impediment.list`                   |
| `tool.{tool-id}.{verb}`     | Tool-specific verbs (semantics that don't fit generic CRUD) | `tool.canvas.add_sticky`, `tool.planning_poker.cast_vote`                |
| `intent.{name}`             | Compositions across multiple tools/entities                 | `intent.start_retro_for_sprint`, `intent.log_impediment_from_retro_card` |

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

The team's ceremony cadence (sprint length, Daily Scrum time and weekdays, Planning, Review and Retro times, the weekly refinement slot) is one document, `workspace.ceremony_cadence` with id `ceremony-cadence:current`: `tool.ceremony_cadence.get` returns it normalised (the defaults while unset) and `tool.ceremony_cadence.set` patches the fields you pass (times are local `HH:MM`, weekdays 0 = Sunday … 6 = Saturday, a bad value is rejected). It also holds the team's working calendar, both optional: `workingDays` (the weekdays the team works; Monday to Friday while unset) and `holidays` (`YYYY-MM-DD`; `[]` clears them). The ideal lines, gaps and projections of the cockpit, Burndown, Burnup and their status actions count the team's working days with it (`lib/sprints/calendar.ts`), and there is no Daily Scrum or refinement on a holiday.

A story's status is `workspace.story` with one of `backlog`, `todo`, `in_progress`, `review`, `done`. Changing it through `workspace.story.update` (or creating a story already in progress) stamps the flow fields the app's sprint board writes: `startedAt` (moved into in progress, review or done; cleared when it goes back to the backlog or to do), `doneAt` (moved to done; cleared when it leaves), `statusHistory` (`{status, from, at}`, the latest 50) and clears `blocked` on done. Send those fields only to backfill: a value you set in the same patch is kept as you wrote it.

### Plan a sprint with the Plan tools

The Plan tools read and write the same data as their pages:

- **Capacity and goals are per sprint.** `tool.capacity_planner.*` and `tool.sprint_goal.*` take an optional `sprintId`. A sprint's plan is `capacity-planner:sprint:<sprintId>` and its goal `sprint-goal:sprint:<sprintId>`; without `sprintId` they use the general `:current` documents, which also stand in for a sprint that has none. `capacity_planner.list_state` returns `capacityRatio` (this sprint's share of a normal one) and `suggestedPoints` (recent velocity × that share). `sprint_goal.set_goal` with a `sprintId` also writes `Sprint.goal`; `link_okr` / `unlink_okr` link workspace OKRs, and `record_outcome` answers "Did we meet the goal?" (`met` | `partly` | `not-met`).
- **Stories carry refinement and epics.** `Story.readiness` (`{checked, ready, updatedAt}`, the Definition-of-Ready result) and `Story.epicId`. `tool.epic_roadmap.link_story` / `unlink_story` set the epic, and `list_state` reports each epic's progress rolled up from its stories.
- **Dependencies live on the Dependency Map's edges**: `status` (`open` | `at-risk` | `resolved`), `owner`, `due` (`YYYY-MM-DD`), `note`. `tool.dependency_map.add_edge` takes them, `update_edge` changes them (resolving stamps `resolvedAt`), and `list_state` counts them by status with the overdue ones. PI Planning and Scrum of Scrums create their dependencies there too.
- **Estimates and forecasts match the screens.** `tool.planning_poker.compute_consensus` counts card positions on the deck (pass `scale` or `deck`); `tool.release_planner.forecast` keeps 0-point sprints and, with `startDate`, `sprintLengthDays` and `targetDate`, returns the chance of finishing by that date and the scope deliverable by then.

```jsonc
// Capacity for sprint_x, then commit the suggested points
{"method":"tools/call","params":{"name":"tool.capacity_planner.list_state","arguments":{"sprintId":"sprint_x"}}}
// → {"perSprint": true, "capacityRatio": 0.9, "suggestedPoints": 27, ...}

// Resolve a dependency
{"method":"tools/call","params":{"name":"tool.dependency_map.update_edge","arguments":{
  "id":"edge_1", "status":"resolved", "note":"Sandbox keys arrived"
}}}
```

### Run the sprint with the Run tools

The Run tools read and write the same data as their pages:

- **Impediments live in `workspace.impediment.*`**, the one store the Impediments page, the cockpit and hand-offs use (the page's old browser-only store is moved there once). Status is derived, not stored: resolved when `resolvedAt` is set, escalated when `escalatedAt` is, open otherwise. `tool.impediments.set_status` escalates, resolves or reopens on a day (`YYYY-MM-DD`, default today UTC); `list_state` returns the counts (open, escalated, resolved, overdue, critical), the average days to resolve, and the list in the page's order with each one's `status`, `ageDays`, `due` and `daysOverdue`. An impediment is due on `dueDate`, else `raisedAt` plus `expectedResolutionDays`.
- **Live and async standups share `StandupEntry`**, with `mode` (`live` when absent, or `async`). `tool.standup.post` posts a live entry and `tool.async_standup.post` an async one; either way it's one entry per person per day, so posting again replaces that day's entry (keeping its blocker's resolution and hand-offs while the blocker text is unchanged). The reads also include the older `workspace.async_update.*` rows, which stay readable but are no longer written by the page. `tool.standup.list_state` counts both modes (`byMode`), `resolve_blocker` takes `resolved: false` to reopen, and `remove_entry` removes an entry together with the old async update under its id (plain `workspace.standup_entry.delete` would bring that update back). `tool.async_standup.digest` covers the day's entries of both modes, as the page's digest does; `mode` narrows it.
- **Sprint reviews are per sprint.** `tool.sprint_review.*` take an optional `sprintId`; a sprint's review is `sprint-review:sprint:<sprintId>` and `sprint-review:current` is the draft (the old page's untouched "Sprint Alpha" starter reads as no draft). With a `sprintId`, `list_state` adds `facts`: the sprint goal and whether it was met (from Sprint Goal), the done stories (each with `inDemo`), and committed and completed points from the sprint's stories. `numbers` gives what the page shows, with its `source` (`stories`, else the review's `typed` numbers, else the `sprint`'s own). `add_feedback` needs a `category` (there is no default). `add_done_stories_to_demo` puts done stories in the demo script, and `send_feedback_to_backlog` turns a piece of feedback into a linked backlog story, once.
- **The Kanban Flow board stamps cards as the page does.** `tool.kanban.move_card` sets `columnSince` on every move, `startedAt` on entering `in_progress` or `review` (dropped on going back to `backlog` or `ready`), `completedAt` on entering `done` (dropped on leaving it), and clears `blocked` in `done`. `add_card` takes `assignee` and `blocked`. `list_state` counts blocked cards per column and gives cycle time (average, P85, sample size) for the cards in `done`.
- **The sprint board is the stories.** Moving a story with `workspace.story.update` and a new `status` stamps `startedAt`, `doneAt` and `statusHistory`, so the Kanban sprint board, the cockpit, Burndown, Burnup, Cumulative Flow, Cycle Time and the review all see it.

```jsonc
// Post an async update, then resolve its blocker once it's gone
{"method":"tools/call","params":{"name":"tool.async_standup.post","arguments":{
  "member":"Alice", "yesterday":"Payment form", "today":"Refunds", "blockers":"Waiting on sandbox keys"
}}}
// → {"posted": true, "id": "standup_x", "replaced": false}
{"method":"tools/call","params":{"name":"tool.standup.resolve_blocker","arguments":{"id":"standup_x"}}}

// Escalate an impediment
{"method":"tools/call","params":{"name":"tool.impediments.set_status","arguments":{
  "id":"imp_1", "status":"escalated"
}}}
```

### Look back with the Retro tools

The Retrospect & improve tools read and write the same data as their pages:

- **A retro looks back on a sprint.** `RetroBoard.sprintId` links the current board (`retro:current`) to its sprint. `tool.retro.start` starts the board as the page's format picker does (`formatId`, and `sprintId`, by default the sprint whose retro window holds today: from its start to 7 days after its end), following the newest archived retro; it refuses while a board is in progress (`already_started`). `set_sprint` links another sprint, or unlinks with `sprintId: null`. `add_card` trims the text (at most 500 characters) and says why it refused (`no_retro`, `unknown_column` with the board's columns, `empty_text`).
- **`tool.retro.list_state` returns the facts panel** for the board's sprint (or `sprintId`): the goal and whether it was met, committed and completed points with say/do (from the sprint's stories, or the sprint's recorded points once it's closed), the burndown's shape (`none`, `steady` or `late`, from the share of points finished in the last third), impediments raised in the sprint (resolved, still open, escalated), the average mood from at least 3 check-ins, follow-through on the previous retro's actions, and the sprint's kudos.
- **Retro actions are the action cards on every retro.** `tool.retro_actions.list` counts an action done when it's marked on its card or when the impediment or Kanban card it was sent to is finished (`closedByTarget`), follows carried-over actions back to where they started (`carriedFrom`), and gives `followThrough` per past retro (agreed, done, carried, open, rate). `add` is the page's quick add (onto `boardId`, else the current retro, else the newest archived one), `update` edits text, owner and due date, and `complete` marks one done (or open again with `done: false`).
- **Six Hats runs in sessions.** `tool.six_hats.start_session` takes a topic, the hats in order and the minutes per round; thoughts logged while it's open belong to it (`log_thought` takes `sessionId`). `set_summary` writes the Blue hat's summary, `close_session` needs it first (`summary_required`), and `reopen_session` reopens a closed one. `list_state` and `export_session` take `sessionId`.
- **Liberating Structures come from one catalog.** `tool.liberating_structures.find` filters it as the page does (`people`, `purpose`, `ceremony`, `maxMinutes`) and returns each structure's timed steps and Ceremony Timer agenda; `toggle_favorite` only takes catalog ids (`ls-1-2-4-all`, …).
- **The design sprint's day comes from its start date** and the team's working days and holidays (the ceremony cadence), never from a stored counter. `tool.design_sprint.list_state` returns the status (`upcoming`, `running`, `over`, `completed`), today's day, the five dates, `startsIn` while upcoming, and each day's tasks and outputs with their ids. `start_sprint` seeds the page's checklist and refuses to replace a sprint unless `replace: true`. `add_output` records what a day produced on the day it belongs to (`long-term-goal`, `sprint-question` and `target` on Map; `sketch` on Sketch; `decision` and `storyboard` on Decide; `prototype`; `finding` on Test; a `note` on any day); the goal, target, decision, storyboard and prototype are one each (`already_set`: change it with `update_output`). `set_answer` records Test day's answer to a sprint question, and `complete_sprint` finishes or reopens the sprint.

```jsonc
// Start the retro for the sprint that just ended, then read its facts
{"method":"tools/call","params":{"name":"tool.retro.start","arguments":{"formatId":"start-stop-continue"}}}
// → {"started": true, "id": "retro:current", "sprintId": "sprint_x"}
{"method":"tools/call","params":{"name":"tool.retro.list_state","arguments":{}}}
// → {..., "facts": {"goalOutcome": "partly", "sayDo": 0.8, "burndown": {"shape": "late", ...}, ...}}

// Record a design sprint finding from Test day
{"method":"tools/call","params":{"name":"tool.design_sprint.add_output","arguments":{
  "kind":"finding", "text":"Nobody found the skip link", "signal":"negative", "seenIn":4
}}}
// → {"added": true, "id": "f_x", "day": 5}
```

### Track delivery with the Delivery tools

The Track delivery tools read and write the same data as their pages, through the same pure libraries (`lib/sprints/{burn,trends,compare,metrics}`, `lib/flow`, `lib/value-stream`, `lib/health-dashboard`, `lib/dora`, `lib/releases`, `lib/flags`), so an agent's numbers match the screen.

- **Stories record their sprint moves.** `Story.sprintHistory` (`{sprintId?, from?, at, points?, carriedOver?}`, the latest 20) and `Story.createdAt` are stamped on every write, the agents' `workspace.story.*` included, whenever `sprintId` changes; the close dialog marks carry-overs. Burnup's scope added and removed, Sprint Metrics' churn and carry-over and Sprint Comparison's scope stability read them. Send `sprintHistory` only to backfill.
- **One flow convention.** Cycle times are whole local days with the start and the finish both counted (a same-day item is 1 day), from `lib/flow`, on the Sprint board's stories and the Flow board's cards alike (`KanbanCard.history` now records each move, the latest 50).

#### Burndown and Burnup (`tool.burndown.*`, `tool.burnup.*`)

Both pages chart one shared sprint with the same model, `lib/sprints/burn`.

**Where the numbers come from**

- **The sprint board**, while the sprint has pointed stories. A day's scope is the points of the stories in the sprint that day. Each story's `sprintHistory` says when it joined or left; a story with no join record counts from day 0. A day's done points are the stories in Done at the end of that day, read from their status history: a story done and then reopened stops counting, and one done after the last day counts on the last day.
- **The typed daily log** (`SprintSeries`) otherwise. A closed sprint is also read from its log, because closing can move its unfinished stories on.

**Counting days**

- "Day N" is a calendar day: day 0 is the start date, the last day (`lengthDays`) is the end date.
- The ideal line, the gap and the projections count the team's working days, from the cadence's `workingDays` and `holidays` (Monday to Friday while unset).
- `gap` is remaining minus ideal: positive means behind.
- `completionPct` is the share of the current scope.

**Actions**

- `tool.burndown.status` / `tool.burnup.status` `{sprintId?, today?, source?}`: the page's numbers for a sprint. `sprintId` defaults to the active sprint, else the newest. They return:
  - `source` and what each source holds;
  - `remaining`, `done`, `scopeNow`, `scopeAdded`, `scopeRemoved`;
  - `idealRemaining`, `gap` and `gapLabel`;
  - `projectedFinishDay` / `projectedMeetDay` (calendar days, possibly past the end);
  - `cantTell` (open stories without points);
  - `caveats`, the `verdict` (burndown) and `scopeVerdict` (burnup);
  - `days[]`, one entry per calendar day with `working`/`off`.

  Read these instead of recomputing from `workspace.sprint_series`.

- `tool.burndown.log_day {sprintId, day, remaining?, scopeChange?, note?}` and `tool.burnup.log_day {sprintId, day, scope?, completed?, note?}` merge one day of the typed log, the way the pages write it. `null` clears a field, and only the given fields change. Prefer these over `workspace.sprint_series.update`, which replaces the whole `days` array.
  - On a day flagged as a scope change, Burndown keeps that day's scope in step with a rise in remaining.
  - They refuse unknown, example and undated sprints, and days past the end.
  - The log is only the fallback: while the sprint has pointed stories, move stories on the board instead (`workspace.story.*`, or the Kanban/Sprint board actions).
- `tool.burndown.compute` / `tool.burnup.compute` stay pure calculators over arrays you pass.
  - Without dates they keep the day-index convention: the ideal reaches 0 at index `sprintDays − 1`.
  - With `startDate` and `endDate` (and optional `workingDays` and `holidays`) they return the page's working-day numbers (`convention: "working_days"`).
  - Burnup also returns `scopeAdded` and `scopeRemoved`; `scopeCreep` stays net.

#### Velocity — `tool.velocity.*`

- **`tool.velocity.compute`** (read) `{velocities?: number[]}` — the Velocity page's numbers from the workspace's finished sprints (status completed with `pointsCompleted`), oldest first by **end date**.
  - `velocity {average, count, window: 3, sprintIds}` is the mean of the last 3 finished sprints. `average` is null with none.
  - `sayDo {perSprint[{sprintId, name, committed, completed, pct, grade}], met, close, missed, over, considered, metPct, meanPct, window: 6}` is the graded say/do of the latest 6 pointed sprints: met 90–110%, close 70–90%, missed under 70%, over above 110%.
  - `perPersonDay {average, count, perSprint[{sprintId, points, personDays, perDay}]}` is the completed points per available person-day over the last 3 sprints. Only a sprint's own capacity plan (`capacity-planner:sprint:<id>`) counts. Person-days = Σ max(sprintDays − daysOff, 0) × availability.
  - Older fields kept: `count`, `average` (every finished sprint), `rollingAverage`, `trend`/`trendSignificant` (Mann-Kendall), `predictability` (a CV consistency score, not say/do), `commitmentReliability` (pass/fail), `forecastNext`, `velocities`.
  - With an explicit `velocities` array, `sayDo`, `perPersonDay` and `commitmentReliability` are null.
  - Quote averages from 3 sprints, spread from 5, a forecast from 4 and a trend from 6.

#### Sprint Comparison — `tool.sprint_compare.*`

- **`tool.sprint_compare.list_state`** (read) `{sprintIds?: string[]}` — the page's six scores (1–10) per sprint. The default is the five newest finished sprints.
  - Returns `{sprints[{id, name, startDate, endDate, status, scores{[dim]: {value, source, from?, basis, editable, typed?, missing?}}, average}], notFound?}`.
  - Computed: Velocity (completed ÷ the team's best, from 3 finished sprints), Predictability (say/do score), Goal Achievement (Sprint Goal outcome: met 10, partly 5.5, not met 1) and Scope Stability (1 − scope churn after day 0).
  - Prefilled: Team Happiness (Mood Tracker check-ins during the sprint, from 3) and Quality (that sprint's Squad Health Check, code and release lights, yellow = half). To override either, write `SprintSeries.ratings[dim]` with `workspace.sprint_series.update`.
  - A stored rating on a computed dimension is used only when the computation has no input (`source: "typed"`).
  - `value: null` means not scored.
- **`tool.sprint_compare.compute`** (read, pure) `{sprints[{name, dimensions}]}` → `{dimensions[{dim, min, max, average, leader}], perSprint[{name, total, average}], overallLeader}`. Unscored values are null, never 0.

#### Sprint Metrics — `tool.sprint_metrics.*`

- **`tool.sprint_metrics.trend`** (read) `{window?: 1–1000 | "all"}`, default 6 — the cross-sprint trend.
  - `rows[]` covers finished sprints, oldest first by end date, with examples left out. Each row has `{sprint{id, name, startDate, endDate}, committed, completed, sayDo{ratio, pct, grade, score}|null, carryOver{count, points, pct, source: history|stories|numbers|none}, scope{added, removed, net, churnPct, source: history|log|none}}`.
  - Summary fields: `window` (null = all), `finishedCount`, `sayDo{considered, met, close, missed, over, meanPct}`, `carryOver{meanPoints, count}` and `churn{meanPct, count}`. Means are null below 3 sprints.
  - `trends{sayDo, churn}` holds Mann-Kendall `{trend, significant, pValue}`, from 6 sprints.
  - Carry-over is read from the stories' sprint moves (the close dialog's carry-overs, moves out after the last day, stories still open). Scope churn counts the points that joined or left after day 0, carry-overs aside. It falls back to the daily log's scope readings.

#### Cumulative Flow — `tool.cumulative_flow.*`

The page charts a board live: the selected sprint's stories (Sprint board) or the Flow board's cards. Typed snapshots stay on the device that typed them, so agents read the boards. One point per local calendar day, and Done is a running total.

- **`list_state`** (read). Returns the CFD the page draws.
  - Params: `source?` (`sprint` | `flow`; default: the sprint when it has stories, else the Flow board), `sprintId?` (default: the active sprint, else the newest), `days?` (7–180, Flow board only; default 30, starting no earlier than the first card).
  - Returns `stages` (`{id, label, kind: queue | active | done}`), `days` (`{date, counts}`), `latest` (`{total, wip, done}`), `avgWip`, `throughputPerDay` (per elapsed day), `littlesLawDays` (≈ days from start to done = avg WIP ÷ throughput), `measuredCycleTime {count, averageDays}`, `approximateItems` (placed from start/done stamps because their history wasn't kept) and `wipLimit` (In progress + Review limits, only when both are set).
  - Throughput and lead time are `null` below 3 days, as the page shows "—".
- **`compute`** (read, pure). Computes the same numbers from a series you pass.
  - Params: `wip[]` and cumulative `done[]`, plus `dates?` so throughput divides by elapsed days between uneven dates.
  - avgWip, throughput and Little's Law are `null` below 3 points; `wipControlLimits` and `wipStable` are `null` below 8.

#### Cycle Time — `tool.cycle_time.*`

One convention everywhere: whole local calendar days with the start and the finish both counted, so a same-day item is **1** day. Percentiles are nearest rank, the same method as the page and the Flow board.

- **`list_state`** (read). Returns finished stories (Sprint board) and Flow-board cards in Done, read from their start and done stamps.
  - Params: `source?` (`sprint` | `flow` | `all`), `sprintId?`, `sinceDays?` (1–365).
  - Returns `count`, `average` (null below 3 items), `median` / `p85` / `p95` / `spread` / `sleDays` (null below 5), `items` (the latest 50 finished, newest first) and `ageing` (work in progress, oldest first, with `ageDays` where the start day is 1, `overP85` and `blocked`).
  - An item dropped straight into Done has no cycle time.
- **`compute_percentiles`** (read, pure). Params: `durations[]` in days (a same-day item is 1). Returns `count`, `average`, `min`, `max`, `p50` / `p85` / `p95`, `sleTarget` (= P85) and IQR `outliers`.

#### Value Stream — `tool.value_stream.*`

Two maps, `current` and `future`. Each stage's `order` is its position in its map; stages saved before reordering keep their stored position, after the numbered ones. Numbers are clamped as on the page: times at 0 or more, %C/A 0–100, flow efficiency capped at 100.

- **`list_state`** (read). Returns the current map's totals (`stageCount`, `totalProcessTime`, `totalLeadTime`, `totalWaitTime`, `flowEfficiencyPct`, `rolledCompleteAccuratePct`) and the page's `verdict`, plus:
  - `bottleneck` — the longest wait, ties to the longer lead time; `null` with fewer than 2 stages or when nothing waits.
  - `future` — the future map's totals and bottleneck, or `null`.
  - `comparison` — deltas (future minus current) and a one-sentence verdict.
  - `stages` — both maps in order, with `state` and `order`.
- **`add_stage`** (write). Adds a stage at the end of a map. Params: `name`, `processTime`, `leadTime`, `completeAccurate`, `description?`, `state?` (default `current`). Returns `{id, state, order}`.
- **`move_stage`** (write). Params: `{id, toIndex}` (0-based, clamped). Renumbers the whole map. Returns `{moved, index, order: [ids]}`.
- **`start_future_state`** (write). Copies the current map, in order, into an empty future map. Returns `{created, ids}`, or `reason: future_exists | no_current_stages`.

#### Team Dashboard (`tool.health_dashboard.*`)

The dashboard's numbers come from the synced workspace through `lib/health-dashboard`, the code the page runs. Example rows (`example-` ids) never count. Its only state is the team's settings, kept in the `healthDashboard:current` singleton (`workspace.health_dashboard.*`).

- `get_summary` (read, `{}`) returns `kpis[]`, one per KPI:
  - `predictability`: % of the latest pointed sprints that delivered 90–110% of their commitment.
  - `team-health`: the latest saved squad health check, scored green 1, yellow ½, red 0. The draft never counts.
  - `open-impediments`: open plus escalated.
  - `critical-impediments`: unresolved critical ones.
  - `open-blockers`: unresolved standup blockers from the last N days, one per person and blocker, not counting the ones already raised as impediments.
  - `cycle-time-p85`: whole days, start and finish day counted, over the stories and Flow-board cards finished in the last N days.

  Each KPI has `value` (null without data or below the minimum sample: 3 pointed sprints, 5 finished items), `status` (green/amber/red, or null), `n`, `hasData`, `enough`, `basis`, `detail`, `threshold` and `source`.

  It also returns `overall` (the average of the lit KPIs), `verdict`, `thresholds` and `windows`, plus the older roll-ups (`sprints`, `stories`, `impediments`, `risks`, `okrs`, `healthCheck`). It returns `flags`: one per KPI that isn't green, plus `high_risks_open` and `low_story_completion`.

- `set_thresholds` (write) takes `{thresholds?: {<kpiId>: {green?, amber?}}, sprintWindow?, blockerWindowDays?, cycleWindowDays?, reset?}`.
  - It merges over the current settings and checks the whole set as the page's form does.
  - Direction: higher-is-better KPIs need green ≥ amber; lower-is-better ones need green ≤ amber.
  - Ranges: percentages 0–100, whole counts, whole days ≥ 1, windows 1–26 sprints, 1–90 days and 1–1000 days.
  - Only differences from the defaults are stored. Defaults: predictability 80/60, team health 75/50, open impediments 0/3, critical 0/0, blockers 0/2, cycle time 7/14 days; windows 6 sprints, 7 days and 90 days.
  - Returns `{saved: true, thresholds, windows}` or `{saved: false, reason: "invalid", errors}`.

#### DORA Scorecard (`tool.dora_scorecard.*`)

The scorecard is one document, `doraScorecard:current`, with one sample per quarter (`"YYYY-Qn"`). Bands come from the 2023 Accelerate State of DevOps Report's performance clusters (`lib/dora/bands`):

| Band   | Deploys         | Lead time | Change failure | Restore  |
| ------ | --------------- | --------- | -------------- | -------- |
| Elite  | 7+ a week       | ≤ 1 day   | ≤ 5%           | ≤ 1 h    |
| High   | 1+ a week       | ≤ 1 week  | ≤ 10%          | ≤ 1 day  |
| Medium | monthly or more | ≤ 30 days | ≤ 15%          | ≤ 1 week |
| Low    | slower or worse |           |                |          |

- `list_state` (read) returns:
  - the samples, oldest quarter first;
  - `latest`: the latest quarter, not the last one added;
  - `averages`: null when there are no samples;
  - `bands` and `weakest` for the latest sample, and the `verdict`;
  - `bandsSource {report, publisher, year, note, citation, cut}` and `bandTable`.
- `add_sample` (write) takes `{quarter, deployFreqPerWeek, leadTimeHours, changeFailRate (0..1), mttrHours, description?, source?, derivedFrom?}`. It refuses a malformed quarter (schema), a quarter that hasn't started (`reason: "not_started"`) and a duplicate (`reason: "duplicate"` with the existing `id`; edit it instead).
- `update_sample` (write) takes `{id, patch}`. The patch is checked as the page checks it, and `updatedAt` is stamped. Returns `{updated, sample}` or `{updated: false, reason: "not_found" | "invalid", errors}`.
- `remove_sample` (write) takes `{id}` and returns the removed sample so it can be added back.
- `derive_sample` (read) takes `{quarter}` and works the quarter out from the data without writing anything:
  - deploy frequency: Release Readiness ships per week;
  - change failure rate: rolled back ÷ shipped;
  - lead time: the median hours from the start of work to the release that shipped it (by `Release.storyIds`, else the first ship on or after done; start to done when no releases are tracked). It needs 3 items;
  - time to restore: the mean of Incident Commander incidents resolved in the quarter.

  A metric the data can't give comes back null, with the reason in `missing`. Save the result with `add_sample` (`source: "derived"`, `derivedFrom`).

#### Release Readiness (`tool.release_readiness.*`)

One document, `workspace:releaseReadiness` / `releaseReadiness:current`, holds the releases and the team's gate list (`gates`; the nine built-ins until the team changes it). Two gates are checked automatically: **Feature flag ready** (`auto: "flags"`) reads `workspace:featureFlag`. It passes once the release has live flags linked (`releaseId`) and every linked rollout or experiment flag has an owner and a removal date that hasn't passed. **Definition of Done met** (`auto: "dod"`, id `dod_met`, not a default) reads the DoD Builder's blob and passes once every required criterion is ticked. A check that can't tell (no flags linked, no DoD) leaves the gate to a manual tick. Numbers come from `lib/releases` (gates, model, auto-gates), the same functions the page uses.

| Action           | Params                                                                       | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_state`     | —                                                                            | `{exists, total, byStatus, today, gates, archivedGates, releases[], stats}`. Each release has `gatesPassed`, `gatesTotal`, `openGates`, `gates[{id,label,passed,locked,auto?,check?}]` and `previousShips`. `stats` comes from `releaseStats` and counts every ship, including rolled-back ones and the earlier ships of reopened releases. It also carries the gate labels in `skippedByGate`, plus `minShipsForRates` (3) and `ratesQuotable`. |
| `add_release`    | `name`, `plannedDate` (**required** YYYY-MM-DD, may be past), `description?` | `{added, id}` or `{added:false, reason}`                                                                                                                                                                                                                                                                                                                                                                                                         |
| `update_release` | `releaseId`, `name?`, `plannedDate?`, `description?` (`''` clears)           | `{updated}` or `{updated:false, reason}`                                                                                                                                                                                                                                                                                                                                                                                                         |
| `toggle_gate`    | `releaseId`, `gate` (an id from `list_state`), `passed`                      | `{updated}`. Refused for a release that went out (gates frozen), for a gate that isn't one of its gates, and for an auto gate whose check decides it.                                                                                                                                                                                                                                                                                            |
| `ship_release`   | `releaseId`, `shippedDate?` (YYYY-MM-DD, not after today; default today)     | `{shipped:true, shippedDate, gatesOpenAtShip, openGates}`. Only a release in planning ships. The gates that apply, and the auto results, are frozen on it. Open gates don't block.                                                                                                                                                                                                                                                               |
| `set_status`     | `releaseId`, `status: "rolled_back" \| "planning"`, `rolledBackAt?`          | `rolled_back` works only from shipped, on a day from the ship day to today (default today), and the ship still counts. `planning` reopens a shipped or rolled-back release and keeps its ship on `previousShips`.                                                                                                                                                                                                                                |
| `set_gates`      | `gates: {id?, label, description?, auto?, archived?}[]`                      | Replaces the list in order. A gate left out is kept as archived, so shipped releases still name it. `{updated, gates, archivedGates}`                                                                                                                                                                                                                                                                                                            |
| `remove_release` | `releaseId`                                                                  | `{removed}`                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Schema change: `add_release.plannedDate` is now required and must be YYYY-MM-DD. Dates use the local day (`todayIso`), not UTC.

#### Feature Flag Tracker (`tool.feature_flag_tracker.*`)

Flags are a workspace collection, `workspace:featureFlag` (generic CRUD: `workspace.feature_flag.*`). The page moves the old `agile-toolkit:feature-flag-tracker` blob in once, by id. Staleness depends on purpose (`lib/flags/model`):

- **Removal date:** a flag is stale once its `removeBy` has passed.
- **No removal date:** a rollout goes stale after 30 days, an experiment after 60.
- **Exempt:** kill switches are never stale. Permission flags are stale only past a `removeBy`. Retired flags are never stale.

| Action        | Params                                                                                                                                                                                                                                       | Returns                                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_state`  | —                                                                                                                                                                                                                                            | `{total, today, summary, flags[]}`. The most overdue flags come first. Each flag has `staleness {stale, exempt, reason, dueOn, daysOver, ageDays}` and `releaseName` when it is linked. `summary` is `flagSummary`: live, on, off, retired, stale, pastRemoval, overLifetime, exempt, noOwner, retiredThisQuarter, byPurpose. |
| `add_flag`    | `name`, `purpose` (**required**: rollout \| experiment \| kill_switch \| permission), `createdAt?` (not after today; default today; backdatable), `removeBy?` (not before createdAt), `owner?`, `environment?`, `releaseId?`, `description?` | `{added, id, staleness}` or `{added:false, reason}`                                                                                                                                                                                                                                                                           |
| `update_flag` | `flagId` and any field; `null` clears `removeBy`, `owner`, `environment`, `releaseId` or `description`; `retiredAt` re-dates a retired flag                                                                                                  | `{updated, staleness}`                                                                                                                                                                                                                                                                                                        |
| `set_status`  | `flagId`, `status: "on" \| "off"`                                                                                                                                                                                                            | `{updated, broughtBack}`. A retired flag set on or off comes back.                                                                                                                                                                                                                                                            |
| `retire_flag` | `flagId`, `retiredAt?` (createdAt..today; default today)                                                                                                                                                                                     | `{retired, retiredAt}`. It counts toward "retired this quarter" by that day.                                                                                                                                                                                                                                                  |
| `remove_flag` | `flagId`                                                                                                                                                                                                                                     | `{removed}` (to record that a flag left the code, use `retire_flag`)                                                                                                                                                                                                                                                          |

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
// This makes a Canvas whiteboard. The Retro tool's own board is tool.retro.start.
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
