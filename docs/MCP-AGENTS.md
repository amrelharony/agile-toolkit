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
- **Stories carry notes, acceptance criteria, a link and a ticket key.** `Story.notes` (at most 2,000 characters), `Story.acceptanceCriteria` (2,000), `Story.link` (the story's issue in the team's tracker: an http or https address, at most 500) and `Story.ticketKey` (such as `PAY-12`, at most 50), all optional. `workspace.story.create` and `update` reject a longer value or a link that isn't http or https; send `""` to clear a field. Sprint Planning and Refinement show and edit them on the story's row, Refinement shows the acceptance criteria beside the Definition of Ready ticks, and a story queued for Planning Poker shows its notes and criteria under its title. A description that comes with a hand-off to the backlog (`backlog-story`) or with a Backlog Prioritizer item is kept as `notes`. They are left out of share links.
- **Dependencies live on the Dependency Map's edges**: `status` (`open` | `at-risk` | `resolved`), `owner`, `due` (`YYYY-MM-DD`), `note`. `tool.dependency_map.add_edge` takes them, `update_edge` changes them (resolving stamps `resolvedAt`), and `list_state` counts them by status with the overdue ones. PI Planning and Scrum of Scrums create their dependencies there too.
- **A queued story's estimate names its session story.** When the host accepts an estimate for a story that came from the Planning Poker queue, the entry logged in the estimate log (`tool.planning_poker.list_state`, `workspace.poker_estimation_log`) carries `sourceRef` (where the story came from) and `sessionStoryId` (the session story it was accepted for, optional). The page's CSV export uses the pair to give each row its story's `ticketKey`. An estimate recorded with `record_estimate` or `commit_round` has neither.
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
- **`tool.retro.list_state` returns the facts panel** for the board's sprint (or `sprintId`): the goal and whether it was met, committed and completed points with say/do (from the sprint's stories, or the sprint's recorded points once it's closed), the burndown's shape (`none`, `steady` or `late`, from the share of points finished in the last third), impediments raised in the sprint (resolved, still open, escalated), the average mood from at least 3 check-ins, anonymous pulse answers included (`mood.anonymous` counts them), follow-through on the previous retro's actions, and the sprint's kudos.
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
  - Prefilled: Team Happiness (Mood Tracker check-ins during the sprint, named check-ins and anonymous pulse answers alike, from 3) and Quality (the Squad Health Check saved for that sprint: by its `sprintId`, else an untagged check with the sprint's name, else one taken in its retro window; code and release lights, yellow = half). To override either, write `SprintSeries.ratings[dim]` with `workspace.sprint_series.update`.
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

  It also returns `overall` (the average of the lit KPIs), `verdict`, `thresholds` and `windows`, plus the older roll-ups (`sprints`, `stories`, `impediments`, `risks`, `okrs`, `healthCheck`). `risks` reads the risks the Risk Register lists (old-page rows not moved in yet included), and `risks.high` counts the active ones rated high or critical (probability × impact 10 or more, the register's bands). It returns `flags`: one per KPI that isn't green, plus `high_risks_open` and `low_story_completion`.

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

One document, `workspace:releaseReadiness` / `releaseReadiness:current`, holds the releases and the team's gate list (`gates`; the nine built-ins until the team changes it). Two gates are checked automatically: **Feature flag ready** (`auto: "flags"`) reads `workspace:featureFlag`. It passes once the release has live flags linked (`releaseId`) and every linked rollout or experiment flag has an owner and a removal date that hasn't passed. **Definition of Done met** (`auto: "dod"`, id `dod_met`, not a default) reads the workspace Definition of Done (`definitionOfDone:current`, else the DoD Builder's old blob until it has moved in). It passes when every done story the release links (`storyIds`) meets the DoD, and fails naming the ones that don't. With no linked stories, it reads the DoD's old team-level ticks while the DoD still has them. A check that can't tell (no flags linked; no DoD or no required criterion; none of the linked stories done yet; no linked stories once the old ticks are gone) leaves the gate to a manual tick. Numbers come from `lib/releases` (gates, model, auto-gates), the same functions the page uses.

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

### Team & people

The Team & people tools read and write the same data as their pages, through the same pure libraries (`lib/health-check/score`, `lib/psych-safety/instrument`, `lib/team/mood`, `lib/kudos/recognition`, `lib/working-agreement/model`, `lib/dod/model`, `lib/raci/model`, `lib/skills/coverage`, `lib/maturity/assessment`, `lib/adkar/model`), so an agent's numbers match the screen.

- **One document each.** The working agreement (`workingAgreement:current`), the Definition of Done (`definitionOfDone:current`), the RACI matrix (`raciMatrix:current`), the skills matrix (`skillsMatrix:current`), the maturity assessment (`maturity:current`) and the ADKAR initiatives (`adkar:current`) are singletons, and the pages read only those ids. Prefer the `tool.*` verbs: they create the document when it's missing and check each write as the page does. The generic `workspace.working_agreement`, `workspace.definition_of_done`, `workspace.raci_matrix`, `workspace.skills_matrix`, `workspace.maturity_assessment` and `workspace.adkar_doc` CRUD needs the fixed id on create, and a create when the document exists is refused (use update). A `skillsMatrix_…` or `maturityAssessment_…` document that `list` shows next to the fixed one came from an older id-less create: no page shows it and `update` refuses it, so `delete` it (after copying anything you need into the fixed document).
- **The pulse tools' documents.** The squad health check (`healthCheck:current`) and the psych-safety rounds (`psychSafety:current`) are singletons too. `workspace.health_check` and `workspace.psych_safety_log` still take a create without an id: it mints a `healthCheck_…` or `psychSafetyLog_…` document that no page shows, so use the `tool.*` verbs. The psych-safety document's `responses` are the answer sheets the tool kept one by one before rounds: each holds one person's answers and can carry the name they typed. `workspace.psych_safety_log` list and update still read and write them, so don't read, quote or write them; `tool.psych_safety.remove_round` with `psRound_legacy` clears them. Mood check-ins (`workspace.mood_entry`) and anonymous pulses (`workspace.mood_pulse`) are collections; the check-in mode, `named` or `anonymous`, is `mode` on the settings singleton `moodTracker:current` (`workspace.mood_tracker_doc`, which needs the fixed id on create). Switching to `anonymous` keeps the check-ins saved by name: the page hides them but still counts them in the team average, and `workspace.mood_entry` still lists them.
- **Vote rounds run in the browser.** A live round (Health Check, Psych Safety, Mood Tracker) runs between the host's tab and the participants' phones, encrypted so only the host's tab can read the answers, and no action opens, answers or reveals one. Nothing from a round reaches the workspace until the host presses Save round, and then only its totals. Agents record totals counted by hand: `tool.health_check.set_dimension` with `votes`, `tool.psych_safety.log_round` and `tool.mood_tracker.record_pulse`, under the same minimums (3 answers, 5 for Psych Safety). No `tool.*` action takes or returns who answered what in a round. The generic `workspace.psych_safety_log` still carries the per-person answer sheets from before rounds (see above): leave them alone.
- **People are the Team page roster.** RACI columns, working-agreement consent, ADKAR owners and skills-matrix columns match a roster name case-insensitively and keep the roster's spelling.
- **Example rows never count.** Rows from a page's Load an example have `example-` ids.
- **No agent actions** for the 1:1 Meeting Tracker (1:1 notes are private), the Onboarding Speed Tracker or the Stakeholder Map.

```jsonc
// Who did Sprint 12's kudos reach?
{"method":"tools/call","params":{"name":"tool.kudos.recognition_stats","arguments":{"sprintId":"sprint_12"}}}
// → {"total": 9, "received": [{"name": "Priya", "count": 3, "fromPeople": 3, ...}, ...],
//    "rosterWithNone": [{"memberId": "member_omar", "name": "Omar"}], "enough": true,
//    "hints": [{"kind": "none-received", "names": ["Omar"], "sentence": "Omar hasn't received a kudos yet in Sprint 12.", ...}],
//    "window": {"from": "2026-09-21", "to": "2026-10-04", "sprintId": "sprint_12", "sprintName": "Sprint 12"}}

// Tick a Definition of Done criterion on a story, as its Sprint board card does
{"method":"tools/call","params":{"name":"tool.dod_builder.set_story_check","arguments":{
  "storyId":"story_42", "criterionId":"crit_tests", "checked":true
}}}
// → {"updated": true, "meetsDod": false, "open": [{"id": "crit_review", "label": "Code reviewed"}]}
```

#### Squad Health Check — `tool.health_check.*`

The check in progress (`current`, the draft), the saved checks (`history`) and the team's own dimensions, in one document. Health counts green 1, yellow ½ and red 0 over the rated dimensions only, the rule the page, the Team Dashboard's team health and Sprint Comparison's Quality share. A dimension's trend is derived from the previous saved check, never typed.

- **`list_state`** (read) `{}` — `{exists, current, lights, notes, votes, trends, currentHealth, ratedCount, unrated, dimensions, archivedDimensions, checkCount, history}`.
  - `lights` maps each active dimension's key to `green`, `yellow` or `red`, or `null` while it isn't rated. Read it rather than `current.scores`, where an unrated dimension holds a placeholder green.
  - `currentHealth` (0–100) is null until something is rated; `unrated` names the dimensions still to rate.
  - `votes` are a dimension's counts `{green, yellow, red, total, split}`, totals only; `split` is true when some voted green and some red.
  - `trends` is `up`, `same` or `down`, or null when the dimension isn't rated or there is nothing to compare with (a first check, or a dimension added since). Never report a null as `same`.
  - `dimensions` are `{key, name, custom, description?}`: a built-in's key is its name, a custom one's its `custom-…` id.
  - `history` runs oldest first by date: `{id, label, sprintName, sprintId, date, scores, customScores, health, trends, source, responses, reds[{key, name, sent}]}`. Quote its `trends`, not the stored `scores[].trend`, which reads `same` where there was nothing to compare.
- **`set_sprint`** (write) `{sprintId | null}` — the shared sprint the check is for, which Sprint Comparison reads; `null` clears the sprint and its name. `set_sprint_name` `{sprintName}` names a check for a team without shared sprints.
- **`set_dimension`** (write) `{dimension, light?, note?, votes?}` — `dimension` is a built-in name or a custom dimension's key or name. `note` (≤500, `''` clears) is what the team said. `votes {green, yellow, red}` are counts, from 3 votes; they set the light unless `light` is given: their mean of green 1, yellow ½ and red 0 is green from 0.75, red below 0.25, yellow between. A `trend` is ignored. Returns `{set: true, key, light, lightFromVotes?, trendIgnored?}`, or `{set: false, reason}` (unknown or archived dimension, nothing to set, fewer than 3 votes).
- **`save_check`** (write) `{date?}` — saves the draft and starts a new one. Refused while a dimension is unrated: `{saved: false, unrated: [names]}`. `date` backdates, never into the future; over MCP the server's day plus one is accepted, so pass the user's local date. Returns `{saved: true, id, date, health, checkCount}`.
- **`remove_check`** `{id}`, **`add_dimension`** `{name, description?}` (naming an archived dimension restores it) and **`archive_dimension`** `{id}` (key or name; built-ins can't be archived, and saved checks keep its lights). **`reset`** asks for confirmation and clears the draft and every saved check; the team's own dimensions stay.

#### Psychological Safety — `tool.psych_safety.*`

Rounds of Edmondson's seven statements. A round is counts only: per statement, how many answered 1 to 5, raw. Q1, Q3 and Q5 are worded negatively and reverse-scored (6 − the answer) when read, so a higher score is always safer. A round's results show from 5 responses, and a statement with fewer than 5 answers is withheld. There is no benchmark.

- **`list_state`** (read) `{}` — `{exists, minResponses (5), questions[{id, text, reversed}], scale, rounds[], latestId, previousId, comparison, totalResponses}`, plus the latest round's `teamScore`, `perQuestion`, `lowestQuestionId`, `delta` and `anomaly` under the names the action always returned.
  - A round is `{id, name, date, sprintId, source (room | facilitator | legacy), responses, teamScore, statementsCovered, perQuestion[{id, n, mean, adjusted}], lowestQuestionId, withheld, readOnly}`, oldest first. Its results are null below 5 responses. When `statementsCovered` is under 7, say the score covers fewer statements.
  - `comparison` is the latest round against the one before, when both have 5 responses: `{delta, common, perQuestion[{id, delta}], anomaly, dropped}`. `delta` is the mean change over the statements both show (`common`), so a withheld one never moves it; `anomaly` is true when a statement fell by more than 0.5, and `dropped` lists them.
  - Nothing per response is returned.
- **`log_round`** (write) `{name, date?, sprintId?, counts: {q1..q7: [n1, n2, n3, n4, n5]}, responses?}` — a round counted by hand or on paper, checked as the page's count entry checks it: at least 5 people (`responses`, by default the most answers any statement has), no statement with more answers than people, and a statement under 5 answers kept as unanswered. `date` is never in the future. Returns `{added: true, id, teamScore, withheld}` or `{added: false, reason}`.
- **`remove_round`** (write) `{id}`. The answer sheets the tool kept one by one before rounds read as one read-only round, `psRound_legacy` ("Earlier responses"); removing it clears them.
- **Deprecated, still registered:** `log_response` is refused and points to `log_round`; `remove_response` `{id}` still removes one of those old answer sheets.

#### Team Mood Tracker — `tool.mood_tracker.*`

Named check-ins and anonymous pulses (how many picked each face on a day) count alike, the same way on the page, in the retro's facts and in Sprint Comparison. In the anonymous mode these verbs return or record nothing per person.

- **`list_state`** (read) `{days?}` (1–90, default 14) — `{mode, window {start, end, days}, average, checkIns, people, anonymous, daysWithCheckIns, distribution, byMember, pulses[{id, date, counts, source}], streak, streakSent}`.
  - `average` (1–5) is over this window. It follows the rule the retro and Sprint Comparison use (named check-ins and pulse answers alike; null below 3 check-ins, never 0), but they average over a sprint's dates, so it is usually a different number. For a sprint's mood, read `facts.mood` from `tool.retro.list_state` or Team Happiness from `tool.sprint_compare.list_state`. `checkIns` counts named check-ins plus pulse answers; `anonymous` counts the pulse answers.
  - `byMember` averages the named check-ins per person, in the named mode only (`[]` when anonymous).
  - `streak` is the team's current run of at least 3 check-in days averaging 2.5 or less, each day counting only from 3 check-ins, so it is never one person's. `streakSent` says it is already on the retro.
- **`record`** (write) `{memberId, score (1–5), note?, date?}` — one check-in per member per day: a second one for the same day replaces the first (`replaced: true`). The member must be on the roster; `date` is `YYYY-MM-DD`, a past day backfills, never a future one (default today; pass the user's local date over MCP). Refused in the anonymous mode.
- **`record_pulse`** (write) `{date?, counts: {1..5}}` — a pulse counted by hand, in either mode; it needs at least 3 answers. Returns `{added: true, id, answers}`.
- **`remove`** `{memberId, date}` and **`remove_pulse`** `{id}` take entries out. The page offers Undo; an agent's removal is final.

```jsonc
// Rate a dimension from a show of hands, then try to save the check
{"method":"tools/call","params":{"name":"tool.health_check.set_dimension","arguments":{"dimension":"Speed","votes":{"green":0,"yellow":2,"red":5},"note":"Waiting on QA"}}}
// → {"set": true, "key": "Speed", "light": "red", "lightFromVotes": "red"}
{"method":"tools/call","params":{"name":"tool.health_check.save_check","arguments":{}}}
// → {"saved": false, "unrated": ["Delivering Value", "Easy to Release", …]}

// Save a psych-safety round counted from paper answers
{"method":"tools/call","params":{"name":"tool.psych_safety.log_round","arguments":{"name":"October","counts":{"q1":[2,3,1,0,0],"q2":[0,0,1,3,2],"q3":[3,2,1,0,0],"q4":[0,1,2,2,1],"q5":[2,3,1,0,0],"q6":[0,0,1,4,1],"q7":[0,1,1,3,1]}}}}
// → {"added": true, "id": "psRound_x", "teamScore": 4, "withheld": []}
```

#### Kudos — `tool.kudos.*`

- **`list_state`** (read) `{}` — the wall, newest first: `{total, examples, kudos[]}`. A kudos has `toMemberId?` (the roster member it is for) and `replyTo?` (the kudos a reply answers). Example kudos carry `example: true`; they stay on the wall until the user clears them, so don't treat them as real recognition.
- **`recognition_stats`** (read) `{sprintId?, from?, to?}` — kudos received per person, read by the page's rules. The page itself shows no counts, only who hasn't been thanked (its Not thanked yet panel, `rosterWithNone` here); don't present these numbers as a ranking. Replies (a reply repeats its parent's recipient) and example kudos are left out. A kudos counts for a roster member by `toMemberId`, so a rename on the Team page keeps it; otherwise it counts by name (trimmed, case-insensitive), and a name that isn't on the roster gets its own row.
  - The window: `sprintId` covers that sprint's start to end day; `from`/`to` are local `YYYY-MM-DD` days, both included (`to` defaults to today, `from` to the first kudos). With neither, it covers all time.
  - Returns the tallies (`total`, `byRecipient`, `bySender`, `themeCounts`, `sentimentCounts`, `topRecipients`) and `received` (`{key, name, memberId?, onRoster, count, fromPeople, lastAt}`, most first), `rosterWithNone` (`{memberId, name}`), `topShare` (0–1, null with none), `enough`, `hints` and `window` (`{from, to, sprintId?, sprintName?}`, null for all time).
  - Hints wait for data: `enough` needs 5 kudos, and `hints` stays empty below that or with a roster of fewer than 2. `none-received` names the teammates with no kudos in the window; `concentrated` flags a sole top recipient with at least half the kudos and at least twice a fair share.
  - A bad window returns `{error: 'unknown_sprint' | 'sprint_has_no_dates' | 'from_after_to'}`.
- **`post_kudos`** (write) `{toName, message, fromName?, theme?, episode?, teamName?, toProfileId?, toMemberId?, fromProfileId?}` — a kudos on one of the printed Agile at Work cards, checked by `parseKudos`, the validator the realtime wire and the store use.
  - `episode` (1-26) picks that book episode's card (its headline, quote, lesson and comic panel show on the card); `theme` can be left out, as it is the episode's habit.
  - `theme` is one of `focus`, `ownership`, `real-needs`, `trust`, `open-thank-you` (Thank you!) or `open-teamwork` (Great teamwork!). A habit's cards are its episodes' cards, so a habit theme needs an episode of that habit: without one the error is `episode_required`, with another habit's episode `theme_episode_mismatch`, each with a `message` saying what fits. An open card may carry an `episode`: the one it reminds the sender of. With neither `theme` nor `episode`, it's a Thank you! card.
  - Any other `theme` returns `invalid_theme`, the tool's original ids included (awesome, thank-you, great-job, congratulations, very-happy, you-rock, well-done): saved cards still carry them and still open, drawn as the Thank you! card, but new kudos can't use them.
  - `fromName` defaults to "AI Assistant". `toMemberId` links the kudos to a roster member: it must be on the roster (`unknown_member`) and `toName` must be their name (`name_mismatch`); the kudos is saved in the roster's spelling. Returns `{posted: true, id}` or `{posted: false, error, message?}`.
- **`remove_kudos`** (write) `{id}` → `{removed}`.
- **Kudos reach the retro as appreciations.** The page's Add to retro sends a kudos to the current retro board through the `retro-topic` hand-off, as an appreciation card with `sourceRef {tool: "kudos", id}`. It's the same card the retro's "Kudos from Sprint N" panel adds, so it never appears twice. `tool.retro.list_state` facts list the sprint's kudos (no replies, no examples).
- **Example kudos stay on the page.** They are never synced, backfilled or broadcast to the room, and `recognition_stats` doesn't count them.

#### Working Agreement — `tool.working_agreement.*`

The team charter: rules, each person's answer to each rule, dated check-in rounds and published versions. A concern still consents; a rule has everyone's consent (`full`) when every roster member answered and nobody objects.

| Action            | Params                                                                                                                                          | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_state`      | —                                                                                                                                               | `{exists, total, byCategory, stillWorkingCount, partlyWorkingCount, notWorkingCount, meta {teamName?, version (0 = never published), publishedAt?, description?}, rules[], consent, lastCheckIn, checkIns[], versions[], unpublishedChanges, needsSnapshot, changesSinceLatest, verdict}`. Each rule has `stillWorking?` (`true`, `false` or `'partly'`), `consent: {name, vote: consent \| concern \| object, note?, at}[]`, `agreedBy` (the names voting consent) and `consentSummary` (`missing` lists the roster members who haven't answered). The three counts are the marks of the round not yet saved; `checkIns` run oldest first with `checked`, `working` and `partly`, and a `pct` that counts a rule partly working as half (null when nothing was checked). |
| `add_rule`        | `category` (communication \| meetings \| decisions \| work \| conflict \| other), `text`, `agreedBy?` (recorded as consent), `description?`     | `{added, id}`, or `{added: false, reason: 'duplicate', id}`. A new agreement starts unpublished (version 0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `update_rule`     | `ruleId`, `text?`, `category?`, `description?` (`''` removes it)                                                                                | `{updated}`, or `reason: not_found \| duplicate`. Consent is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `remove_rule`     | `ruleId`                                                                                                                                        | `{removed}`. Saved check-ins and versions keep their copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `set_consent`     | `ruleId`, `name`, `vote: consent \| concern \| object \| null`, `note?`                                                                         | One answer per person, matched by name; `null` clears it. `{updated, name, onRoster, consent (the line, e.g. "5 of 6 consented · Sam objects"), agreedBy}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `record_check_in` | `results: {ruleId, result: working \| partly \| not_working}[]`, `date?` (YYYY-MM-DD, default today, never in the future), `sprintId?`, `note?` | A dated round against the current version: `{recorded, id, checked, working, partly, pct}`, where a rule partly working (kept some of the time, or by some of the team) counts as half in `pct`; or `reason: future_date \| unknown_sprint \| unknown_rule (with unknown) \| no_results`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `remove_check_in` | `id`                                                                                                                                            | `{removed}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `publish`         | —                                                                                                                                               | Snapshots the rules, team name and description as the next version: `{published, version, publishedAt, changes}` (against the previous version, or null). Refused with `nothing_changed` or `no_rules`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

#### Definition of Done — `tool.dod_builder.*`

A story meets the DoD when every required criterion is ticked on it (`Story.dodChecks`, the Sprint board card's checklist), against the criteria as they are today. Until the DoD Builder's old blob (`agile-toolkit:dod-builder`) has moved into the workspace, reads fall back to it (`source: 'legacy'`) and the first write moves it in (a copy: the blob stays as the backup). Release Readiness's "Definition of Done met" gate checks a release's linked done stories against it (see Release Readiness above).

| Action             | Params                                                                                                                        | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_state`       | `sprintId?` (default: the active sprint, else the newest)                                                                     | `{exists, source: workspace \| legacy \| null, criteria[], requiredCount, byCategory, sprint, adherence {required, done, meeting, pct, missing[{id, title, sprintId?, open[]}]}, bySprint[] (oldest first), legacyHistory, verdict}`. `pct` is null with no done stories or nothing required; `legacyHistory` holds the read-only team-level tallies from before per-story ticks. `{exists, error: 'unknown_sprint'}` for an unknown sprint. |
| `add_criterion`    | `label`, `category` (code \| testing \| docs \| performance \| security \| other), `required?` (default true), `description?` | `{added, id, required}`, or `{added: false, reason: 'duplicate', id}`                                                                                                                                                                                                                                                                                                                                                                        |
| `update_criterion` | `id`, `label?`, `category?`, `required?`, `description?` (`''` removes it)                                                    | `{updated}`, or `reason: not_found \| duplicate`                                                                                                                                                                                                                                                                                                                                                                                             |
| `remove_criterion` | `id`                                                                                                                          | `{removed}`. Stories keep their ticks of it.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `set_story_check`  | `storyId`, `criterionId`, `checked`                                                                                           | `{updated, meetsDod (null when nothing is required), open[{id, label}] (the required criteria still open)}`, or `reason: unknown_criterion \| unknown_story`                                                                                                                                                                                                                                                                                 |

#### RACI Matrix — `tool.raci.*`

Columns are roster people (`memberId`) or group roles, such as "Dev Team". Cells are normalised as on the page: `[]`, `[R]`, `[A]`, `[A,R]`, `[C]` or `[I]`. The checks: each assigned activity needs one Accountable (`no_a`, `many_a`) and someone Responsible (`no_r`), with A/R counting as both; an activity nobody is assigned to is `unassigned`, not an error. The load warnings (`thresholds`) are `accountable_load` (one role Accountable for more than half of 4 or more activities) and `consulted_load` (more than 3 roles consulted on one activity). In the browser, a write that would create the matrix is refused while the RACI page's old local matrix still waits to move in.

| Action                            | Params                                                                                               | Returns                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_state`                      | —                                                                                                    | `{exists, roles[{id, name, description?, memberId?, onTeam?}], activities[], cells {activityId: {roleId: letters}}, matrix[], issues[], loadWarnings[{kind, roleId?, activityId?, activityIds?, count, of, message}], thresholds, unassigned, countsByRole[{roleId, name, memberId?, R, A, C, I}], verdict}` |
| `add_role`                        | `name` (a roster name links the person; any other name is a group role), `memberId?`, `description?` | `{added, id, name, memberId (null for a group role)}`, or `reason: duplicate \| unknown_member`                                                                                                                                                                                                              |
| `add_activity`                    | `name`, `description?`                                                                               | `{added, id}`, or `reason: duplicate`                                                                                                                                                                                                                                                                        |
| `set_cell`                        | `activityId`, `roleId`, `letters: (R \| A \| C \| I)[]`                                              | `{updated, letters (as saved), issues (that activity's)}`, or `reason: unknown_activity \| unknown_role`. C or I given with R or A is dropped; `[]` clears the cell.                                                                                                                                         |
| `rename`                          | `kind: role \| activity`, `id`, `name`                                                               | `{renamed, memberId?}`: a column renamed to a roster name links to them, any other name makes it a group role. `reason: not_found \| duplicate`                                                                                                                                                              |
| `remove_role` / `remove_activity` | `id`                                                                                                 | `{removed}`, with its cells                                                                                                                                                                                                                                                                                  |
| `reset`                           | —                                                                                                    | Asks for confirmation. Clears every column, row and cell (the page's Clear the matrix offers Undo; this doesn't): `{reset, roles, activities}`                                                                                                                                                               |

#### Skills Matrix — `tool.skills_matrix.*`

People are the Team page roster (`TeamMember.id` columns). People from older matrices are matched to the roster by name, and the rest are matrix-only (`onRoster: false`). The counts come from `lib/skills/coverage`:

- a person is **capable** from Intermediate (2); a **gap** is a skill nobody rated is capable at; a **single point of failure** (`spof`) is a skill exactly one person is capable at;
- **Not rated** (`null`) never counts, while `0` is a deliberate None; a skill nobody is rated in yet (`notRatedYet`) is neither a gap nor below target.

Writes upgrade an older matrix (its stored 0s were Not rated) and move people matched by name onto their roster ids, as the page does.

| Action              | Params                                                                                              | Returns                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_state`        | —                                                                                                   | `{exists, columns[{id, name, onRoster}], members, skills[{id, name, description, targetPeople (null = no target), targetLevel}], grid (skillId → column id → 0–4, null = Not rated), coverage[], gapCount, spofCount, belowTargetCount, unratedCount, notRatedYetCount, verdict, suggestions[], training[], rosterSkillsMissing}`, plus the deprecated `analysis`, `busFactorCount` (= `spofCount`) and `overallCoverage` |
| `add_member`        | `name`                                                                                              | Adds the person to the **roster**; a name already there returns that member. `{added, id, existing, onRoster: true}`, or `reason: name_required`                                                                                                                                                                                                                                                                          |
| `remove_member`     | `id`                                                                                                | Only a matrix-only person (`reason: on_roster \| not_found` otherwise); pairs they mentor go back to outside help                                                                                                                                                                                                                                                                                                         |
| `add_skill`         | `name`, `description?`, `targetPeople?` (1–50, no more than the team), `targetLevel?` (2 \| 3 \| 4) | `{added, id}`, or `reason: name_required \| invalid_name \| duplicate (with id) \| invalid_target`                                                                                                                                                                                                                                                                                                                        |
| `remove_skill`      | `id`                                                                                                | `{removed}`, with its ratings and training pairs                                                                                                                                                                                                                                                                                                                                                                          |
| `set_rating`        | `skillId`, `memberId` (a column id), `level: 0–4 \| null`                                           | `null` clears it to Not rated. `{set, level, label}`                                                                                                                                                                                                                                                                                                                                                                      |
| `set_target`        | `skillId`, `people: 1–50 \| null`, `level?` (2 \| 3 \| 4)                                           | `{set, target, targetLevel, atTarget, meetsTarget}`, or `reason: not_found \| invalid_target`                                                                                                                                                                                                                                                                                                                             |
| `add_training`      | `skillId`, `learnerId`, `mentorId?`, `toLevel?`, `due?`                                             | No mentor means outside help; one open pair per learner and skill. `{added, id, toLevel}`, or `{added: false, message}`                                                                                                                                                                                                                                                                                                   |
| `complete_training` | `id`, `on?` (default today, never after it), `reopen?`                                              | Done is never set automatically; `reached` says whether the rating got there. `{done, doneAt, reached}`, `{done: false, reopened: true}`, or `reason: not_found \| invalid_day`                                                                                                                                                                                                                                           |
| `remove_training`   | `id`                                                                                                | `{removed}`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `reset`             | —                                                                                                   | Asks for confirmation. Clears the skills, ratings, matrix-only people and pairs; the roster stays                                                                                                                                                                                                                                                                                                                         |

#### Agile Maturity Assessment — `tool.maturity.*`

One document (`maturity:current`, kind `workspace:maturityAssessment`). Its `scores` are the **draft**; saved, dated assessments are its history. A team that has never saved one is **unassessed**: no level, no percentage, no roadmap. The overall score runs from 0% (all 1s) to 100% (all 5s). `Workspace.maturityLevel` has one owner, the latest saved assessment (`maturityLevelOf` in `lib/maturity/assessment`): `save_assessment`, `remove_assessment` and `reset` keep it in step (`null` = unassessed), and the page does when it opens, so a value set with `workspace.scalars.set_maturity_level` doesn't last.

| Action              | Params                                                                                        | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_state`        | —                                                                                             | `{exists, assessed, draft {scores, scored, missing[{id, name}], legacy}, latest, assessments[] (oldest first), deltas[] (latest against the one before), targetLevel, roadmap[], verdict}`. `latest` is null when unassessed, else `{id, assessedAt, averageLevel, percentage, level, label, tone, note}`. Roadmap steps run weakest first, each with `key` (`dimensionId:toLevel`), `current`, `toLevel`, `nextLevel`, `sent` and `retroCards`. The older flat fields (`averageLevel`, `percentage`, `level`, `label`) come from `latest`. |
| `set_score`         | `dimensionId`, `level: 1–5 \| null`                                                           | Edits the draft only: `{set, scored}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `set_target_level`  | `level: 2–5`                                                                                  | `{set, targetLevel}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `save_assessment`   | `scores?` (laid over the draft), `date?` (YYYY-MM-DD, default today), `targetLevel?`, `note?` | Every one of the 8 dimensions must end up scored. Refuses `incomplete` (with `missing`), `unknown_dimension` and `invalid_date` (a future day; backdating is fine). Clears the draft: `{saved, id, assessedAt, averageLevel, percentage, level, label, tone, note, maturityLevel}`                                                                                                                                                                                                                                                          |
| `remove_assessment` | `id`                                                                                          | `{removed, maturityLevel}` (null once none is left)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `send_roadmap_step` | `key`, `owner?`                                                                               | A retro action `Maturity: <dimension> to level <n>` on the current retro (else the newest archived one), linked back by `sourceRef {tool: 'maturity', id: key}`. `{sent, cardId, boardId}`, or `reason: not_on_roadmap \| already_sent (with cardId) \| no_retro`                                                                                                                                                                                                                                                                           |
| `reset`             | —                                                                                             | Asks for confirmation. Clears the draft and the history, and the target goes back to 4; the team becomes unassessed                                                                                                                                                                                                                                                                                                                                                                                                                         |

#### ADKAR Change Tracker — `tool.adkar.*`

One document (`adkar:current`, kind `workspace:adkarDoc`). It moves once from the tool's old blob (`agile-toolkit:adkar`) when the page opens. Until then `list_state` also shows what still waits there (`pendingLegacy`), any write carries it into the doc, and deleting an initiative that still waits there is refused (`not_moved_yet`). Each affected group is scored 1–5 per element; its **barrier point** is the first element, in A-D-K-A-R order, at 3 or lower, and an unscored element before that makes it unknown (`unscoredBefore`). Stage moves are dated: never before the last move, never after today.

| Action                  | Params                                                                                 | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_state`            | —                                                                                      | `{exists, pendingLegacy, initiatives[], counts (per current stage), held, unknownBarriers[], stuck, medianDaysInStage {days (null below 3 finished stages), periods}, longestInCurrentStage, verdict}`. Each initiative has `stage`, `daysInStage`, `stageDurations[{stage, from, to, days}]`, `groups[]` (each with its `barrier`), `barrier` (the earliest across its groups) and `pastBarrier` (groups whose barrier is before the current stage). `stuck` lists the initiatives 30 or more days in one stage, Reinforcement left out. |
| `add_initiative`        | `name`, `owner?`, `startDate?` (default today, not in the future), `description?`      | Starts at Awareness on its start date. `{added, id}`, or `reason: invalid_name \| invalid_date`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `update_initiative`     | `id`, `name?`, `owner?`, `description?`, `startDate?`                                  | `null` clears the owner or description; the start date moves the Awareness entry (not after today or the first move). `{updated}`, or `reason: not_found \| invalid_name \| invalid_date`                                                                                                                                                                                                                                                                                                                                                 |
| `set_group_scores`      | `id`, `groupId?` or `name?`, `scores?` (element → 1–5 \| null), `assessedAt?`, `note?` | Finds the group by name (case-insensitive) or adds it. `{set, groupId, scores, barrier, initiativeBarrier}`, or `reason: not_found \| group_not_found \| invalid_name \| invalid_date`                                                                                                                                                                                                                                                                                                                                                    |
| `advance` / `step_back` | `id`, `on?` (default today)                                                            | `{moved, from, stage, enteredAt, pastBarrier}`, or `reason: not_found \| invalid_date \| at_final_stage` (`at_first_stage` for `step_back`)                                                                                                                                                                                                                                                                                                                                                                                               |
| `remove_initiative`     | `id`                                                                                   | `{removed}`, or `reason: not_moved_yet`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Prioritize & decide

The Prioritize & decide tools read and write the same data as their pages, through the same pure code (the method registry `lib/prioritization/methods` with `lib/prioritization/rank`, `lib/buy-a-feature/game`, `lib/hundred-dollar/allocation`, `lib/decisions`, `lib/weighted/model`, `lib/cynefin/model`), so an agent's numbers match the screen.

- **One backlog, one value field, one decided order.** Backlog items (`workspace.backlog_item`) hold the MoSCoW, WSJF, RICE and Value/Effort inputs. `businessValue` is the item's one value field: WSJF's business value and the Value/Effort value, on 1, 2, 3, 5, 8, 13, 20. The old 1–10 `value` is read only while `businessValue` is missing (mapped up to the next step) and is never written. `rank` (1 first) is the decided order: only `tool.prioritizer.set_order` (the page's Save order) sets it, a new item has none (Not ordered yet), and Sprint Planning imports the backlog in that order.
- **Not scored is never a default.** A method that hasn't scored an item reads `null` (`score: null` on a row, listed last), never 0 or a mid value. An item the current code never saved (no `updatedAt`) that still holds every one of a method's old "Add item" defaults (`moscow: "should"`; WSJF 5/5/5/5; RICE reach 100, impact 1, confidence 80, effort 1; `value` 5 with `matrixEffort` 5) reads as not scored in that method. Every write stamps `updatedAt`, so from then on its values read as chosen.
- **`workspace.backlog_item` writes go through the engine, as the hub's do.** `create` stamps the item (a `moscow: "should"` it sets reads as Should). `update` sets the keys its patch sends, each compared with what the item reads as: an equal value is no change, and any other is a choice, a stored old default sent again included (`{moscow: "should"}` on an old item makes it Should). So send only the keys you mean to set, not a whole item read back from `list`. The update clears the old defaults the item still holds in every method, the ones the patch touches included, so `{timeCriticality: 13}` on an old 5/5/5/5 item leaves WSJF Not scored until the other three parts are sent too. It drops the old `value` when `businessValue` is written and stamps `updatedAt`. What a write sets is checked by the methods' rules, as `tool.prioritizer.add_item` checks it (the WSJF parts and `businessValue` on 1, 2, 3, 5, 8, 13, 20, a value the item already holds excepted; RICE confidence above 0 and up to 100, effort 0.5 at least; `matrixEffort` 1–10). `value` can't be written, and a `rank` another item holds is refused (one item per place: save a whole order with `tool.prioritizer.set_order`). A problem saves nothing. An update that changes nothing leaves the item as it is.
- **Method rows read through.** Each method tool's rows are `workspace.prioritization` rows with a `framework`. A row linked to a backlog item (`backlogItemId`) in a method the backlog holds (MoSCoW, WSJF, RICE, Value/Effort) reads its inputs from the item, and its writes go to the item too. ICE, Kano and Cost of Delay rows only link; the Prioritizer shows each item's latest linked row. Scores are stored unrounded; the pages round them.
- **Rows linked before Phase 7 keep their values.** On an item the current code never saved that still holds a method's old defaults, a row linked before Phase 7 can hold the only real value (the old tools changed only the row). Every reader shows that value, and the item's first save from anywhere writes it to the item: the hub, a method page, `set_order`, a persist verb, `set_position` or `workspace.backlog_item.update`. Where such a row and its item hold different real values, the item's value counts and the row's page asks once which to keep, also after that first save. A persist of the row answers it, and so does a save that gives the item the row's value. The bookkeeping behind that question (`fields.legacyDiffers`) never shows in a method tool's list (`list_scored`, `list_items`); the raw `workspace.prioritization.list` rows carry it.
- **Persist verbs check like the forms.** They recompute the score (a supplied `score` is ignored), keep an existing row's other fields and its link, and refuse a batch at its first invalid item, writing nothing. An optional input a call leaves out keeps what the existing row shows (a linked row's from its item), as the page's editor prefills it: RICE's `reachPeriod`, MoSCoW's `effort`, Cost of Delay's `durationWeeks`, `urgency`, `fixedDate` and `weeksDelayed`, and Eisenhower's answers, `dueAt` and `delegateTo`. `null` clears one (not RICE's period: give another). Prefer them to the generic `workspace.prioritization.*` CRUD, which checks only the row's shape, not its inputs, and writes nothing through to the backlog item.
- **Live rounds run in the browser.** A Kano, Buy-a-Feature or $100 Test live round runs between the host's tab and the participants' phones, encrypted so only the host's tab can read the answers, and no action opens, answers or reveals one. Nothing reaches the workspace until the host presses Save round, and then only its totals. Agents record totals counted by hand (`tool.kano_model.record_round`, `tool.buy_a_feature.record_round`, `tool.hundred_dollar_test.record_round`) under the same minimums: results from 3 people, who backed what and the spread from 5. No action takes or returns anyone's answers or split.
- **Example rows are ordinary rows.** Rows from a page's Load an example have `example-` ids and sync like the team's own: every list, count and ranking includes them (`list_state`, `list_scored`, `list_items`, `decide_order`), and the Decision Log's `list_state` marks them `example: true`. Only a few verbs set them apart: example decision records keep their own numbers outside the log's sequence and don't count toward `timeToDecide`, and an example matrix or Cynefin item can't be sent to a decision record or a hypothesis. Leave `example-` ids out of `tool.prioritizer.set_order`.

```jsonc
// Score candidates with WSJF (pure), then persist the chosen one, linked to its backlog item
{"method":"tools/call","params":{"name":"tool.wsjf.compute_and_rank","arguments":{
  "items": [
    {"id":"f1","title":"Single sign-on","fields":{"businessValue":8,"timeCriticality":5,"rrOe":3,"jobSize":2}},
    {"id":"f2","title":"Audit log export","fields":{"businessValue":3,"timeCriticality":1,"rrOe":1,"jobSize":1}}
  ]
}}}
// → {"ranked": [{"id": "f1", "score": 8, "rank": 1, ...}, {"id": "f2", "score": 5, "rank": 2, ...}],
//    "count": 2, "columnsWithoutOne": ["businessValue"]}
{"method":"tools/call","params":{"name":"tool.wsjf.persist_to_prioritization","arguments":{
  "items": [{"title":"Single sign-on","fields":{"businessValue":8,"timeCriticality":5,"rrOe":3,"jobSize":2},"backlogItemId":"bk_123"}]
}}}
// → {"written": ["prio_x"], "count": 1, "scores": [{"id": "prio_x", "score": 8}]}

// Decide the order: read the consensus, agree it with the team, then save it
{"method":"tools/call","params":{"name":"tool.prioritizer.decide_order","arguments":{}}}
// → {"methods": ["moscow", "wsjf", "rice"], "consensus": [...], "suggestedOrder": ["bk_123", "bk_7"], "unscored": ["bk_9"], ...}
{"method":"tools/call","params":{"name":"tool.prioritizer.set_order","arguments":{"ids":["bk_123","bk_7"]}}}
// → {"ranked": 2, "unranked": 1, "changed": 3}
```

#### Backlog Prioritizer — `tool.prioritizer.*`

- **`list_state`** (read) `{}` — `{total, byMoscow, notSorted, items[], rankedByWsjf[], ordered[], rankedMethods[]}`.
  - Each item is `{id, name, moscow, wsjf, rice, rank, frameworkScores, methods, methodRanks, consensus, coverage, disagree}`. `rank` is the decided place (1 first), `null` while Not ordered yet.
  - `frameworkScores` holds `{moscow, wsjf, rice, valueEffort: {value, effort, quadrant} | null}` from the item's own inputs, plus `{ice, kano, cd3, urgency}` from the latest row linked to it in those tools (`costOfDelay` is deprecated: the old total). `methods` is each hub method's `{score, bucket, missing, warnings}`.
  - `rankedMethods` are the hub methods with 2 or more items scored. `methodRanks` is the item's place in each of them (tied items share the average place, so two tied for 2nd both read 2.5); `consensus` is the Borda score over them, 0–100 (100: first in every method that scored it), `null` when none did; `coverage` counts the methods that scored it; `disagree` means its places are more than half the list apart.
  - `ordered` lists the items in the decided order: ranked items first, then the ones not ordered yet, in stored order. `byMoscow` counts only items with a bucket; `notSorted` counts the rest.
- **`add_item`** (write) `{name, description?, moscow?, businessValue?, timeCriticality?, riskReduction?, jobSize?, reach?, reachPeriod?, impact?, confidence?, effort?, matrixEffort?}` — returns `{added: true, id}`.
  - Only the inputs given are stored: every other method starts Not scored, and the item Not ordered yet.
  - The WSJF parts (`businessValue` included) must be steps of 1, 2, 3, 5, 8, 13, 20: refused otherwise, never clamped.
  - RICE: `reachPeriod` week | month | quarter | year, `confidence` above 0 and up to 100, `effort` 0.5 person-months at least. `matrixEffort` is 1–10. A refused input adds nothing.
- **`decide_order`** (read) `{methods?}` — `{methods, skipped[{method, label, scored, reason}], consensus[{id, name, rank, borda, coverage, spread, disagree, perMethod}], suggestedOrder, unscored}`: the page's Decide order step, each method's places and the Borda consensus. Methods with fewer than 2 scored items are skipped, with the reason; unscored items come last. It writes nothing.
- **`set_order`** (write, asks first) `{ids}` — `{ranked, unranked, changed}`. Ranks 1..N go to `ids` in the order given, and every other item goes back to Not ordered yet. An unknown id is refused and nothing changes.

Typical flow: `list_state`, then `decide_order`, agree the order with the team, then `set_order` with `suggestedOrder` or the team's version. To score an item, use a method tool's persist verbs with `backlogItemId`.

#### RICE, WSJF, ICE, MoSCoW and Cost of Delay

Each has the calculator shape: a pure compute (`compute_score`; MoSCoW `classify`; Cost of Delay `compute_cd3`), a pure `compute_and_rank` (not MoSCoW), the workspace list (`list_scored`; MoSCoW `list_items`), a one-row `score_and_persist` (MoSCoW `classify_and_persist`) and a batch `persist_to_prioritization`. Items are `{id?, title, fields, backlogItemId?}`. Listed rows (not MoSCoW's) are `{id, title, fields, values, score, rank, percentile, bucket, missing, warnings, backlogItemId, live, updatedAt, extra?}`, in the page's order with unscored rows last (dense rank: ties share one). A batch persist returns `{written, count, scores}`.

- **RICE** (`tool.rice_scoring.*`) `fields {reach, reachPeriod?, impact, confidencePct, effort}`.
  - `reachPeriod` is week | month | quarter | year. Left out, a persist keeps the row's period (a linked row's is its item's, and a new row linked to an item takes the item's); a new unlinked row, and a compute, count per quarter. The score normalises reach to per quarter (week ×13, month ×3, year ÷4), so mixed periods compare; `compute_score` returns `{score, formula, reachPerQuarter, missing, warnings}` and rows carry `extra.reachPerQuarter`.
  - `confidencePct` is a percentage, 0–100: 100 backed by data, 80 some evidence, 50 mostly a guess; under 50 is a moonshot to test first. `impact` is kept exactly (3, 2, 1, 0.5, 0.25).
  - `effort` is person-months: a persist refuses less than 0.5. On a read, 0 is Not scored, and a legacy value under 0.5 counts as 0.5 with a warning.
  - With `backlogItemId`, the persists write the inputs to the item.
- **WSJF** (`tool.wsjf.*`) `fields {businessValue, timeCriticality, rrOe, jobSize}`, all four (`rrOe` is the item's `riskReduction`).
  - Every part is on 1, 2, 3, 5, 8, 13, 20, relative to the other items; nothing clamps to 10. A persist refuses a part off the scale (unless the row already holds it) and a job size below 1. A pure compute scores any number, dividing by at least 1; a job size of 0 is Not scored.
  - `list_scored` and `compute_and_rank` return `columnsWithoutOne`: the parts with 2 or more values where no item has a 1. Give the smallest a 1 and size the others against it. A title-only row (the page's column scoring) lists with `score: null`.
- **ICE** (`tool.ice_score.*`) `fields {impact, confidence, ease}`, each 1–10; the score runs up to 1,000. `backlogItemId` only links the row.
- **MoSCoW** (`tool.moscow.*`) `fields {category, effort?}`. `category` is must | should | could | wont, required, with no default. On a persist, `effort: null` clears the row's effort; left out, it stays.
  - `classify` returns `{category, priority (must 4 … wont 1), description}`. The persists store the bucket and the priority as the row's score, and with `backlogItemId` write the bucket to the item: `classify_and_persist` returns `{id, category, priority, backlogItemId, backlogUpdated}`, `persist_to_prioritization` `{written[{id, category, priority}], count}`.
  - `list_items` returns `{must, should, could, wont, unsorted, total, budget}`, each group newest first. The groups hold the stored rows, not the listed-row shape above: the bucket is `fields.bucket` (read from a linked item's MoSCoW bucket) and `fields.effort` is the row's own. A row with no bucket, or an unknown one, is under `unsorted`, never Must.
  - `budget` is the Must budget `{mustEffort, plannedEffort, share, over, excess, sized, unsized, unsizedMusts, limit: 0.6}`: Musts should take at most about 60% of the Must + Should + Could effort, counting a linked item's job size first, else the row's `effort`. `share` is null below 3 sized items, and while `unsizedMusts` is above 0 it is a lower bound.
- **Cost of Delay** (`tool.cost_of_delay.*`) `fields {perWeekUsd, durationWeeks?, urgency?, fixedDate?, weeksDelayed?, jobSize?}`. On a persist, `null` clears `durationWeeks`, `urgency` or `fixedDate`; left out, they stay as the row has them.
  - CD3 = `perWeekUsd` ÷ `durationWeeks`, with a duration of half a week at least. `urgency` is expedite | fixed_date | standard | intangible, and `fixed_date` needs `fixedDate` (YYYY-MM-DD); `latestStart` = that date − the duration.
  - Lists run in the page's lanes (`bucket` is the lane): expedite, fixed date by latest start, standard by CD3, rows with no profile yet, then intangible by CD3.
  - A row without a duration is saved and listed Not scored ("add a duration"). `weeksDelayed` (the old per week × weeks delayed model) stays on the row for reference, with the old total in `extra.totalCost`, and is never part of CD3. `jobSize` is a deprecated alias of `durationWeeks` for one release.
  - `compute_cd3` returns `{score, lane, latestStart, costOfDelay (deprecated: the old total, or null), formula, missing, warnings}`; the persists return the `lane` too. `backlogItemId` only links the row.

#### Value vs Effort — `tool.value_effort_matrix.*`

One rule on the page, in the Prioritizer and here: value is the backlog's one value field on 1, 2, 3, 5, 8, 13, 20 (8 or more is high; the same field as WSJF's business value), and effort is 1–10 (6 or more is high). The quadrant (`quick_wins`, `big_bets`, `fill_ins`, `time_wasters`) is derived, never stored; a stored legacy `quadrant` is ignored. The sort score is value ÷ effort, and lists go quadrant by quadrant in do-first order. A write refuses a value off the scale unless the row or its item already holds it.

- **`compute_quadrant`** (read, pure) `{value, effort}` — `{quadrant, score, quadrantScore (Quick Wins 4 … Time Wasters 1), missing, thresholds {value: 8, effort: 6}}`. `valueThreshold` and `effortThreshold` are deprecated and ignored, here and on `compute_and_rank`, `classify_and_persist` and `persist_to_prioritization`.
- **`compute_and_rank`** (read, pure) `{items[]}` — `{ranked[{id, title, fields, score, quadrant, quadrantScore}], count, thresholds}`.
- **`list_items`** (read) — `{groups {quick_wins, big_bets, fill_ins, time_wasters}, unplaced, count, quadrants, thresholds}`. Each row carries `{value, effort, quadrant}` as the page shows it (a linked row's from its item); `unplaced` is the page's Not placed yet.
- **`classify_and_persist`** (write) `{id?, title, fields {value, effort}, backlogItemId?}` — `{id, quadrant, score, quadrantScore, backlogItemId, backlogUpdated}`. **`persist_to_prioritization`** `{items[{id?, title, fields?: {value?, effort?}, backlogItemId?}]}` — `{written, count, placed[{id, quadrant, score}]}`, each item with both value and effort, or neither (Not placed yet). Only value and effort are stored; with `backlogItemId` they're written to the item (`businessValue`, `matrixEffort`). Neither on a linked row (or a new row with `backlogItemId`) un-places it as `set_position` does: the item's `matrixEffort` is cleared and its value stays. `placed` gives each quadrant and score as `list_items` then shows them, a linked row's from its item.
- **`place_item`** (write) `{id, value, effort}` moves one item, as dragging it does — `{id, quadrant, score, backlogItemId, backlogUpdated}`.
- **`set_position`** (write) `{id, value | null, effort | null, clearBacklog?}` places or moves an item, or with both `null` sends it back to Not placed yet; one without the other is refused. Un-placing a linked row clears only the item's effort (`matrixEffort`), as the page does: its value stays, being WSJF's business value too, unless `clearBacklog: true`, which clears it even while WSJF's other parts are set. Returns `{id, quadrant, score, placed, backlogItemId, backlogUpdated}` (the item fields changed).

#### Eisenhower — `tool.eisenhower.*`

Tasks store `urgent` and `important` (`"true"` / `"false"`), `dueAt` (YYYY-MM-DD, past days allowed) and `delegateTo` (a roster name). Urgent means the answer is yes or the task is due within 2 days, overdue included. The quadrant (do, schedule, delegate, delete) is derived for `today` (default: the server's date) and never stored. A task missing an answer is `unsorted` (Not sorted yet), never Do, and a legacy row still holding a stored quadrant reads as that quadrant's answers, as the page shows it.

- **`classify`** (read, pure) `{urgent, important, dueAt?, delegateTo?, today?}` — `{quadrant, score (4/3/2/1), urgentBecause ('toggle' | 'due' | null), daysToDue, rule}`.
- **`list_items`** (read) `{today?}` — `{do, schedule, delegate, delete, unsorted, total, today}`, each group newest first. Rows carry `values {urgent, important, dueAt, delegateTo}` and `extra {urgentBecause, daysToDue}`.
- **`classify_and_persist`** (write) `{id?, title, fields {urgent, important, dueAt?: string | null, delegateTo?: string | null}}` and **`update_task`** `{id, title?, urgent?, important?, dueAt?: string | null, delegateTo?: string | null}` (`null` clears; left out, an existing task keeps it) — `{id, quadrant, score, urgentBecause}`.
- **`persist_to_prioritization`** (write) `{items[{id?, title, fields?, quadrant?}]}` — `{written[{id, quadrant, score}], count}`. A `quadrant` is turned into its answers; one that contradicts the answers given is refused, and nothing is written. An existing task keeps the answers, `dueAt` and `delegateTo` an item leaves out (`null` clears `dueAt` or `delegateTo`).

#### Kano — `tool.kano_model.*`

A feature holds one person's answer pair (`functional` and `dysfunctional`, each like | must | neutral | live_with | dislike) or survey counts per class (`kanoA` … `kanoQ` with `kanoN`, and `kanoSource` pair | counts | room | tally). The Kano evaluation table maps a pair to A (attractive), O (performance), M (must-be), I (indifferent), R (reverse) or Q (questionable); (like, like) and (dislike, dislike) are Questionable. With counts, the category is the most common class (ties M > O > A > I > R > Q), from 3 answers. Better = (A+O)/(A+O+M+I) and Worse = −(O+M)/(A+O+M+I), `null` until 3 answers that aren't R or Q. The score is Decide order's ranking: must-be 5, performance 4, attractive 3, indifferent 2, reverse 1, questionable 0. The category is never stored; `category` alone is deprecated and stored as Picked by hand.

- **`classify`** (read, pure) `{functional + dysfunctional | counts {A, O, M, I, R, Q} | category}` — `{class, category (null under 3 answers), score, explanation, counts, n, better, worse, enough, picked}`.
- **`list_items`** (read) — `{"must-be", performance, attractive, indifferent, reverse, questionable, needs_more, unanswered, total}`, each group newest first. Survey counts under 3 answers are under `needs_more` (the page's Needs more answers; `extra.n` says how many), and a feature with no answers under `unanswered`. Rows carry `extra {n, better, worse, source, A, O, M, I, R, Q}`; `source: "pair"` is one person's answers, not a survey.
- **`classify_and_persist`** (write) `{id?, title, fields, backlogItemId?}` — `{id, category, score, explanation, class, n, better, worse, enough}`. **`persist_to_prioritization`** `{items[]}` — `{written[{id, category, score}], count}`. Both store the answers or the counts.
- **`record_round`** (write) `{featureId, counts | joint, add?, source?, roundId?, at?}` — a survey round's totals for one existing feature, as the page's Save round stores them.
  - Give exactly one of `counts` `{A, O, M, I, R, Q}` or `joint`, the 25-cell count of answer pairs (`joint[first × 5 + second]`, both in the order like, must, neutral, live_with, dislike).
  - The round replaces the feature's earlier answers unless `add: true` (then it is added, a single stored pair counting as one), and a hand-picked category goes. `source` is room | tally (default).
  - A `roundId` the feature already holds is never counted twice: nothing is written, and its stored totals come back with `alreadyRecorded: true`.
  - Returns `{id, category (null under 3 answers), score, counts, n, better, worse, enough, replaced, previous: {counts, n} | null, alreadyRecorded}`. Totals only: it takes no per-person answers.

#### Buy-a-Feature — `tool.buy_a_feature.*`

Features are prioritization rows (framework `buy-feature`) with a whole `price` and what was `raised` toward it. The game document (`workspace.buy_a_feature_game`, id `buyAFeature:current`) holds the players and each one's budget; the pool is the two multiplied. Money moves at pool level, never per player. Every number comes from `lib/buy-a-feature/game`, the code the page uses: a purchase is capped at what a feature still needs, a legacy row over its price counts only its price, and a price of 0 or a fraction reads as Not priced. Rounds (`workspace.allocation_round`, tool `buy-a-feature`) keep per-feature totals only, never anyone's split.

- **`list_state`** (read) `{}` — `{unit, game, pool, budgetCheck, nextRound, features, counts, rounds, verdict}`.
  - `game` is `{players, budgetPerPlayer, unit}`, each `null` until set. Never assume the team's size.
  - `pool` is `{players, budgetPerPlayer, pool, spent, left, overspent}`, or `null` until both are set. `spent` is what the features raised, each capped at its price.
  - `budgetCheck` is `{ok, pool, sumOfPrices, sharePct, suggestedBudget, budgetBelow, text, problem}`. `ok` means the pool is below the sum of the prices, so nobody can buy everything; `problem` names the budget each player must stay below.
  - `nextRound` is `{number, budgetPerPlayer, features[{id, cap}], blocked}`. Round 1 uses the budget per player; later rounds use what's left in the pool, split evenly. Each feature's `cap` is what it still needs, rounded up to a whole amount, and `blocked` says why a round can't run.
  - `features` are `{id, title, price, raised, remaining, funded, pctFunded, inBacklog, storyId}` (a `null` price is Not priced); `counts` is `{features, priced, funded, fundedNotInBacklog}`.
  - `rounds` run newest first: `{id, title, date, ballots, budget, source, spreadKnown, items[{featureId, text, cap, total, average, backers, middleHalf}]}`. `total` is before capping.
- **`add_feature`** (write) `{title, price}` — a whole price from 1 to 1,000,000,000. Returns `{added: true, id, title, price}`.
- **`set_game`** (write) `{players?, budgetPerPlayer?, unit?}` — players 1–999, budget 10–9,999, a unit of up to 4 characters; `null` clears one and an omitted one stays. Returns `{set: true, game, pool, problem}`.
- **`record_purchase`** (write) `{id, amount}` — a purchase at the table, capped at what the feature still needs (the rest is `refunded`). Refused above what's left in the pool, for a funded or unpriced feature, and before the pool is set. Returns `{recorded: true, applied, refunded, raised, remaining, funded}` or `{recorded: false, reason}`.
- **`refund`** (write) `{id}` gives one feature's money back to the pool — `{refunded: true, amount}` or `{refunded: false, reason}`. **`refund_unfunded`** (asks first) gives back the money of every feature that fell short — `{refunded, amount, ids}`. The page offers Undo; an agent's refund is final.
- **`record_round`** (write) `{totals: {featureId: total}, players, date?}` — a round added up from paper: each of `players` (3 or more) split `nextRound.budgetPerPlayer` across `nextRound.features`.
  - Each total is capped at what its feature needs, and the rest goes back to the pool. A feature that falls short keeps its pledge.
  - `date` backdates (YYYY-MM-DD, not in the future, not before the game's last round); over MCP the server's day plus one is accepted, so pass the user's local date.
  - The round is saved with totals only; typed totals never show a spread.
  - Refused when `nextRound.blocked` is set, when the totals can't come from that many splits, or when it would spend more than the pool has left.
  - Returns `{saved: true, id, round, date, budgetPerPlayer, spent, refunded, funded[{id, title}], short[{id, title, by}], outcome}` or `{saved: false, reason}`.
- Funded features go to the backlog on the page, through the `backlog-story` hand-off with `sourceRef {tool: "buy-a-feature", id}`, each once.

#### $100 Test — `tool.hundred_dollar_test.*`

Items are prioritization rows (framework `hundred-dollar`). Each holds its amount in the agreed split, `fields.allocation`: whole dollars, the group's split or one person's. A new item has none, which is different from $0. Team rounds (`workspace.allocation_round`, tool `hundred-dollar-test`) are everyone's own $100, split anonymously, and keep only aggregates: each item's total, how many people gave it something, and how many fell in each of five bands of the $100 ($0, $1–10, $11–25, $26–50, $51–100). A round never holds anyone's split or who answered. Every number comes from `lib/hundred-dollar/allocation` and the vote-room kit's counting: averages from 3 people, backers and bands from 5.

- **`list_state`** (read) `{}` — `{items, split, canRunRound, rounds, latestBesideSplit, verdict}`.
  - `items` are `{id, title, allocation}`, where `allocation` is `null` until an amount is given.
  - `split` is `{total, remaining, full, given}`; `remaining` is negative only for a legacy split over $100.
  - `rounds` run newest first: `{id, title, date, ballots, source, spreadKnown, spreadNote, items[{itemId, text, total, average, backers, bands, middleHalf}]}`. `average` is total ÷ ballots; `backers` and `bands` are `null` below 5 answers and for typed totals, and `spreadNote` says which.
  - `latestBesideSplit` sets the latest round beside the agreed split: `{itemId, text, agreed, teamAverage, backers, current}`, where `current` is false for an item deleted since the round.
- **`add_item`** (write) `{title}` — an item with no amount. Returns `{added: true, id, title}`.
- **`set_allocation`** (write) `{id, amount}` — whole dollars, 0–100, capped as on the page so the split never passes $100. Returns `{set: true, saved, note, remaining}` (`note` says why `saved` differs from `amount`) or `{set: false, reason}`.
- **`record_round`** (write) `{splits?, totals?, people?, date?}` — a round counted on paper, over every current item.
  - `splits` is one `{itemId: dollars}` per person, each exactly $100; they are folded and dropped. Or `totals` with `people`, and the spread is then unknown.
  - At least 3 people. `date` backdates, never into the future; over MCP the server's day plus one is accepted, so pass the user's local date.
  - Returns `{saved: true, id, title, date, ballots, source, spreadKnown, spreadNote, items, verdict}` or `{saved: false, reason}`.
- **`remove_round`** (write) `{id}` deletes one saved round — `{removed: true}` or `{removed: false, reason}`. The page offers Undo; an agent's delete is final.

#### Decision Log, DACI and RAPID — `tool.decision_log.*`

One entity, `workspace.decision`, holds every record the Decision Log, DACI and RAPID pages list. `template` is the form a record was raised in (`adr` | `daci` | `rapid`; absent = `adr`). Every record follows the ADR lifecycle (proposed → accepted → deprecated or superseded); DACI and RAPID's "implemented" and "revisit" are the dates `implementedAt` and `reopenedAt`.

- **One numbering sequence** runs across the forms, labelled by form (`ADR-0003`, `DACI-0004`, `RAPID-0005`): a new record gets one past the highest number in the log. Example rows keep their own numbers and don't count, and deleting the highest-numbered record frees its number for the next one.
- **Reads list what the page lists**: the stored records, the old DACI and RAPID rows read through as records under their own ids, and the old Decision Log page's rows not moved in yet (`pending`, read only). A write saves a record under the same id and leaves an old row behind as a backup. Names use the roster's spelling when the person is on the team.
- **Days are the user's** (`YYYY-MM-DD`): pass the user's local date. Over MCP the server's day (UTC on a typical deploy) may be a day behind theirs, so the day after the server's today is taken too, and a move with no `date` (`decide`, `reopen`, `set_status`, and the DACI and RAPID `set_status`) is never stamped before a day the record already carries.

- **`list_state`** (read) `{template?, status?}` — `{total, byStatus, byTemplate, pending, items, verdict, timeToDecide}`.
  - Each item is the record plus `template`, `label`, `options [{id, text, note?}]`, `issues [{kind, message}]`, `supersedes` (ids), `onTeam {name: boolean}`, `example` and `pending`.
  - `issues` kinds: `no_decider`, `no_driver`, `no_recommend`, `many_agree` (more than 3 Agree), `accepted_no_outcome`, `stale_proposed` (proposed for over 14 days).
  - `timeToDecide` is `{medianDays, n}` from 3 decided records, else `null`.
- **`add_decision`** (write) `{template?, title, context?, options?, recommendation?, decider?, roles?, date?}` — `{created: true, id, number, label}`, or `{created: false, reason: future_day | not_a_day | role_not_in_template | duplicate_option}`. `roles` takes only the form's roles (DACI: `driver` (one), `contributor`, `informed`; RAPID: `recommend` (one), `agree`, `perform`, `input`). `date` (raised on) can be backdated, not set in the future.
- **`decide`** (write) `{id, outcome, chosenOption?, decider?, date?}` — accepts the record with its outcome: `{decided: true, label, decidedAt}`, or `{decided: false, reason: not_found | future_day | before_raised | unknown_option | invalid, message?}`. A DACI or RAPID record needs its Approver / Decide (D) named, here or already. `chosenOption` is an option id or its exact text.
- **`supersede`** (write) `{id, supersededBy, reason?}` — `{superseded: true, label, by}`. The replacement must be another record still in force (proposed or accepted), an example only for an example, and not one this record already replaced, directly or down a chain; `reason` is added to the old record's consequences. A repeat returns `{superseded: false, alreadySuperseded: true}`; refusals are `not_found`, `replacement_not_found`, `example_mismatch`, `replacement_not_in_force` and `supersede_loop`.
- **`reopen`** (write) `{id, date?}` — back to proposed (DACI's revisit): `{reopened: true, label}`, or `reason: not_found | already_proposed | future_day`.
- **`set_status`** (write) `{id, status, supersededBy?}` — `{updated, confirmed?, reason?, message?}`. `proposed` reopens; `accepted` from proposed dates `decidedAt` today (use `decide` to write the outcome) and needs a DACI or RAPID decider first (`no_decider`). `deprecated` and `superseded` ask for confirmation when the caller can confirm.
- **`add_option`** (write) `{id, text, note?}` — `{added: true, optionId}`, or `reason: not_found | already_listed`. **`add_alternative`** `{id, alternative}` is kept for old callers — `{added}`.
- **`assign_role`** (write) `{id, role, person, replace?}` — `{assigned: true, role, person}`. `driver` and `recommend` hold one person: `replace: true` swaps, else `single_role_taken` with the `holder`. **`set_decider`** `{id, person}` — `{updated, decider}`.
- **`delete`** (write, asks first) `{id}` — `{deleted: true, id, label}`, or `{deleted: false, reason: not_found | pending_move}`. It removes the id from the records and from the old DACI and RAPID collections, as the page's delete does. A `pending_move` row moves in when the Decision Log is opened once.

**Aliases, kept for old callers.**

- `tool.daci.{list_state, set_status, add_contributor, add_informed}` and `tool.rapid_decision.{list_state, set_status, assign_role, set_decider, set_recommend}` act on the DACI and RAPID records of the same log, in their old shapes and status words, with `number`, `label`, `lifecycle`, the outcome (`decision`) and `issues` added. DACI: open = proposed, decided = accepted, implemented = accepted with `implementedAt`, revisit = proposed again with `reopenedAt`. RAPID: the same without revisit (open on a decided record reopens it, with `reopenedAt`, as the page's Reopen does), and its `implemented` asks for confirmation when the caller can confirm. Deciding through either needs the Approver / Decide (D) named first (`no_decider`).
- The generic CRUD stays: `workspace.decision.*` reads and writes the stored records, and `workspace.daci_decision.*` and `workspace.rapid_decision.*` the old DACI and RAPID rows. An old row shows in the log as its record until that record is first saved; after that it is a backup and may hold out-of-date text.
- **Delete with `tool.decision_log.delete`, not `workspace.decision.delete`.** The generic delete removes only the stored record, so a record that started as an old DACI or RAPID row reads back in from that row, with its pre-merge text. Prefer the `tool.decision_log.*` verbs throughout.

#### Weighted Decision Matrix — `tool.weighted_decision.*`

Named matrices (`workspace.weighted_matrix`); options and criteria carry `matrixId`, and rows without one belong to the default matrix `weightedMatrix:default` (the rows from before names, shown as the Untitled matrix). Every number comes from `lib/weighted/model`, as on the page: scores are 1–10; an empty cell is not scored, never 0; an option's `total` exists only once every criterion with a weight above 0 is scored (else `partialTotal` and `unscored`); the leader is the highest complete total, so an incomplete option never leads; a `tie` is complete options within 5% of the leader; and `sensitivity` lists, per criterion, the smallest weight change within ±50% that hands the lead to another option.

- **`list_state`** (read) `{matrixId?}` — `{matrices, count}`. Each matrix adds `weightSum`, `criteria [{id, name, weight, active, share, low?, high?}]`, `options [{id, name, total, partialTotal, unscored, offScale, complete, rank}]`, `leaderId`, `tie {ids, gap} | null`, `overtakers` (unfinished options whose lowest possible total already beats the leader's), `sensitivity [{criterionId, criterion, changePct, direction, weightAt, newLeaderId, newLeader}]`, `sensitivityChecked`, `emptyCells`, `verdict`, `sentToDecision` and `sentDecision {id, label, status, decided} | null`.
- **`create_matrix`** (write) `{name, question?}` — `{id}`; the question becomes the decision record's title.
- **`add_criterion`** `{matrixId?, name, weight, low?, high?}` and **`add_option`** `{matrixId?, name, note?}` — `{added: true, id, matrixId}`, or `reason: matrix_not_found | name_taken`. **`set_weight`** `{criterionId, weight}`: 0 keeps a criterion listed without counting it.
- **`set_score`** `{optionId, criterionId, score: 1–10 | null}` — `{updated: true}`, or `reason: off_scale | option_not_found | criterion_not_found | different_matrix`.
- **`send_to_decision`** `{matrixId}` — `{sent: true, decisionId, label, status: "proposed"}`: a PROPOSED decision record with the question as its title, the verdict and ranking as its context, the options in rank order and the leader as the recommendation; the outcome is the team's. It needs a fully scored leader that no unfinished option is sure to overtake, and goes once per matrix while that record exists. Refusals: `matrix_not_found`, `no_leader`, `overtaken`, `example`, `already_sent`.
- Kept for old callers: `compute_option_score` and `compute_and_rank` (the pure raw Σ score × weight for a caller's rubric, now with `complete` and `unscored`), `list_options {criteriaWeights?, matrixId?}`, and `score_and_persist_option` / `persist_options`, which replace an option's name and scores, keep every other stored field (its `matrixId`, its `note`) and return `offScale`.

#### Cynefin Decision Picker — `tool.cynefin.*`

The guided questions (`crisis`, `known`, `analysable`, `emergent`, `disagree`; answers yes | no | unsure), the suggestion and each domain's recipe come from `lib/cynefin/model`, as on the page. A suggestion is never a decision: the team confirms the domain.

- **`classify`** (read, pure) `{title, signals?, answers?}` — `{recommendedDomain, rationale, recommendedAction, from: answers | signals, answered | matched, questions}`. Answers win over signals.
  - From answers, `answered` counts the questions answered (Not sure counts). `recommendedDomain` (and `recommendedAction`) is `null` under 2 answers, unless `crisis` is yes (chaotic on its own), and when the answers don't point to one domain yet.
  - From signals, `matched: false` means no keyword matched: the `confused` that comes back is a placeholder, not a suggestion, and `classify_and_persist` files nothing from it.
- **`list_state`** (read) — `{clear, complicated, complex, chaotic, confused, total, verdict, complexNotTested, questions}`. Each item adds `plan`, `customPlan` and `hypothesis` (none | testing | tested); an unknown or legacy domain reads as confused.
- **`record_domain`** (write) `{id? | title, domain, rationale?, answers?}` — `{recorded: true, id, domain, created}`: files a problem under the domain the team confirmed, or moves one (a plan written for it survives the move). `domain` is required.
- **`classify_and_persist`** (write, kept) files a new item from an explicit `domain`, or from `answers` / `signals`. Nothing is filed under a default: `{persisted: false, reason: "no_suggestion"}` comes back when they point nowhere. **`set_recommended_action`** `{id, recommendedAction}` writes the item's own plan.
- **`send_to_hypothesis`** (write) `{id}` — `{sent: true, hypothesisId, believe}`: a drafted hypothesis in the Hypothesis Tracker (the title as its "We believe" line, without the words again: the tracker labels the field; the rationale as what to learn), linked both ways. Complex items only, once, and not for examples.

### Outcomes, quality & library

The Outcomes, quality & library tools read and write the same data as their pages, through the same pure code (`lib/okrs`, `lib/nps/score`, `lib/hypotheses/model`, `lib/interviews/model`, `lib/opportunity-tree/model`, `lib/assumptions/model`, `lib/risks/model`, `lib/tech-debt/model`, `lib/quality/cost`, `lib/quality/pyramid`, `lib/quality/flaky`, `lib/quality/review`), so an agent's numbers match the screen.

- **Nothing measured reads `null`, never 0.** NPS with no NPS answers, a validation rate with no decisive result, an unrated assumption's score, a cost not entered, a median below 3 values: each is `null` (or the field is absent), never a 0 or a mid value that looks like a result. Not scored is never a default either: an OKR confidence, an assumption's risk and evidence and an NPS score all start unset.
- **Example rows.** Rows from a page's Load an example have `example-` ids. The OKR, NPS and Hypothesis Tracker counts and verdicts leave them out (OKRs and NPS leave them out of the lists too); Riskiest Assumption leaves them out of its ranking, and the Risk Register and Tech Debt out of the summary keys after `items` (they report how many in `examples`). The User Interview Log and the Opportunity Tree list and count example rows as stored, as their pages do: an example interview and its quotes count in the totals, `participants` and `themes`, and example nodes are in `nodes`, `byKind` and `targets`, so check the id; nothing is added under an example (`add_quote`, `add_node`). The verbs that hand a row to another tool refuse an example (`reason: "example"`). The quality tools' examples stay in the page's memory and never reach the workspace, so agents never see them.
- **Hand-offs are linked both ways.** `send_quote_to_opportunity`, `send_experiment_to_hypothesis`, `test_assumption`, `raise_impediment` and `add_to_backlog` create the item in the other tool with a `sourceRef` back, record the link on the source (`sentTo`) and go once while that item exists (`reason: "already_sent"`, or `"already_raised"` for `raise_impediment`, with the existing item's id). A hypothesis that arrives this way is drafted and may lack what we'll do or its success metric: fill them with `tool.hypothesis_tracker.update_hypothesis` before it runs.
- **Risks and tech debt live in the workspace** (`workspace.risk`, `workspace.tech_debt`), one store each. The old Risk Register and Tech Debt pages kept their rows in a page blob; each page moves them in once, when it is opened. Until then the reads list those rows too (`pending: true` on an item, a count in `pending`), a write on one saves the merged row into the workspace (the generic `workspace.risk.update` and `workspace.tech_debt.update` too, a row only the old blob holds included), and a delete of one is refused with `pending_move` (the generic `workspace.risk.delete` and `workspace.tech_debt.delete` too, with an error starting `pending_move:`): open the page once, then delete. Every write stamps `updatedAt`.
- **Days are the user's** (`YYYY-MM-DD`). Over MCP the server's day (UTC on a typical deploy) may be behind theirs, so the day after the server's today is taken too; pass the user's local date.
- **The comic has no agent actions.** Agile at Work's stories live in Supabase and are read only by the site's own server code (`lib/comics/store`); the owner writes them in the portal at `/settings/comics`.

```jsonc
// A weekly OKR check-in, then the objective as the page reads it
{"method":"tools/call","params":{"name":"tool.okrs.check_in","arguments":{
  "okrId":"okr_q4", "keyResultId":"kr_activation", "value":38, "confidence":6, "date":"2026-10-26"
}}}
// → {"recorded": true, "checkInId": "ci_x", "date": "2026-10-26", "current": 38, "confidence": 6,
//    "keyResultProgressPct": 60, "progressPct": 52, "replacedUndated": null}

// The risk happened: raise it as an impediment, then close it once that is resolved
{"method":"tools/call","params":{"name":"tool.risk_register.raise_impediment","arguments":{"id":"risk_vendor"}}}
// → {"raised": true, "impedimentId": "imp_x", "severity": "high"}
```

#### OKR Tracker — `tool.okrs.*`

Progress runs from a key result's baseline to its target, up or down: `(current − baseline) ÷ (target − baseline)`, clamped to 0–100%. A key result with no baseline (saved before Phase 8) counts from 0, as it did. An objective is the mean of its key results. Confidence is 0–10 (≤3 off track, 4–6 at risk, ≥7 on track) and absent until scored. A key result's `current` and `confidence` follow its newest-dated check-in; it keeps its 52 newest.

- **`list_state`** (read) `{}` — `{total, overallProgressPct, measuredObjectives, measuredProgressPct, items}`.
  - `overallProgressPct` counts an objective with no key results as 0; `measuredProgressPct` is the page's headline, over the objectives with a key result (`null` when none has one).
  - Each item is `{id, objective, description, quarter ('2026 Q4'), owner, progressPct | null, confidence | null, verdict, confidenceTrend[{date, confidence, scored}], progressTrend[{date, progressPct, measured}], linkedSprintGoals[{goalId, sprintId, sprintName, goal, met?}], keyResults[]}`. `progressPct` is `null` for an objective with no key result yet (the page's "Not measured yet"). `verdict` is the sentence under the objective on the page. `progressTrend` replays the objective's progress per check-in day (each key result at its latest check-in value by then, at its baseline before its first; `measured` = how many had a check-in by then), the line beside confidence in the page's chart. Sprint Goal writes the links; they are read-only here.
  - Each key result is `{id, title, description, unit, baseline | null, direction ('increase' | 'decrease'), target, current, progressPct, progressText, confidence | null, confidenceBand | null, lastCheckIn | null, daysSinceCheckIn | null, checkInCount}`. The full history, with every check-in's id for `remove_check_in`, is in `workspace.okr.list` (each OKR's `keyResults[].checkIns`).
- **`check_in`** (write) `{okrId, keyResultId, value, confidence? (0–10), date?, note? (≤500)}` — a dated check-in, as the page's Check in. `date` defaults to today and is never in the future. A backdated check-in older than the newest joins the history without changing `current`. A key result's first check-in becomes its current value whatever its date: when one dated before today replaces a different value typed earlier, `replacedUndated` says which (a `current` still at the baseline a new key result starts at was never typed, so it reads `null`). Returns `{recorded: true, checkInId, date, current, confidence | null, keyResultProgressPct, progressPct (the objective's), replacedUndated: {current, confidence, message} | null}` or `{recorded: false, reason: not_found | future_day | too_old, message}`.
- **`update_key_result`** (write) `{okrId, keyResultId, current, confidence?, date?, note?}` — kept for old callers: it records a check-in with `value = current`, so the update joins the trend. Returns `{updated: true, progressPct, checkInId, current, replacedUndated}` or `{updated: false, reason, message}`.
- **`remove_check_in`** (write, asks first) `{okrId, keyResultId, checkInId}` — deletes one check-in, as the page's check-in history does. `current` and `confidence` then follow the newest one left; with none left, `current` goes back to the baseline (a key result with no baseline keeps its value). Returns `{removed: true, current, confidence | null, keyResultProgressPct, progressPct, checkInCount}` or `{removed: false, reason: not_found, message}`. The page offers Undo; an agent re-records with `check_in`.
- Objectives and key results themselves go through `workspace.okr.*`. An `update` whose `keyResults` leave a key result's `checkIns` out keeps the stored ones, and a confidence it sets must be 0–10. A key result with check-ins takes `current` from its newest one and `confidence` from its newest scored one, as `check_in` keeps them: a write setting either to anything else is refused (record values with `check_in`), and check-ins sent are stored oldest first. Write new key results as the page does: a `baseline`, a `direction`, `checkIns: []` and no `confidence`.

#### NPS / CSAT — `tool.nps_csat.*`

NPS = round((promoters 9–10 − detractors 0–6) ÷ n × 100), `null` with no NPS answers. CSAT is % satisfied (4–5 on 1–5), with the one-decimal mean kept beside it. Periods are calendar ISO weeks (`2026-W42`) or months (`2026-10`). A period with fewer than 10 answers of a kind still reads, with a warning that one answer moves it by about 100 ÷ n points. Scores off their kind's scale (saved before Phase 8) are left out of every number.

- **`list_state`** (read) `{by?: week | month (default month, as on the page), tag?, maxPeriods? (1–260)}` — `{total, tag, matching, nps, csat, by, minPerPeriod (10), periods, headline, undated, offScale, tags}`.
  - `nps` is `{n, count, score | null, promoters, passives, detractors}`; `csat` `{n, count, satisfied, satisfiedPct | null, average | null}`. `tag` narrows them, the periods and the headline.
  - `periods` run oldest first to today's, empty ones kept: `{period, label, from, to, nps, csat, enoughNps, enoughCsat}`.
  - `headline` is the page's cards: `{nps: {period, label, score, n} | null, csat: {period, label, satisfiedPct, n} | null}`, the latest period with enough answers, read over every period (even one older than the `periods` returned), as the page's cards are.
  - `tags` are over every response, most unhappy first: `{tag, n, promoters, detractors, satisfied, dissatisfied, unhappy (detractors + CSAT 1–2), nps, csat}`.
- **`record`** (write) `{kind: nps | csat, score, respondent? (≤120 characters), verbatim? (≤4,000), tags?, date?}` — one response. The score is a whole number on the kind's scale, the one the customer gave: the page has no default score. `tags` is a list or a comma-separated string, stored lower-case and once each (at most 10, 40 characters each). Returns `{added: true, id, date, tags}` or `{added: false, reason: off_scale | future_day | tags | too_long, message}` (`too_long`: a respondent or verbatim over the page's caps, which its form would refuse on the next edit).
- The CSV and paste import is the page's only (up to 1,000 rows; exact copies of stored answers are skipped). Edit or delete a response with `workspace.nps_response.update` / `delete`; tags a write sets are stored as `record` stores them (lower-case, once each, within its limits), and a respondent or verbatim over the same caps is refused.

#### Hypothesis Tracker — `tool.hypothesis_tracker.*`

One document, `hypothesisTracker:current`. A hypothesis is we believe / we will / to learn / success looks like (each up to 2,000 characters), with an optional numeric `target {direction: increase | decrease, value, unit?, baseline?}` and a measured `actual`. With both, the suggested verdict is binary: target met → validated, missed → invalidated. It is never applied for you.

- **`list_state`** (read) `{}` — `{exists, total, examples, byStatus, decisive, inconclusive, validationRate, verdict, needsDetail, hypotheses}`.
  - `validationRate` is validated ÷ (validated + invalidated), 0..1, and `null` while no result is decisive: inconclusive results never count.
  - `hypotheses` lists every stored row, each with `missing` (`willDo` | `successMetric`), `suggestedVerdict` (`{verdict, met, margin, moved?}` or `null`) and `suggestion` (that in words, or `null`).
- **`add_hypothesis`** (write) `{believe, willDo, toLearn, successMetric, experiment?, description?, outcome?, status?, raisedAt?, resolvedAt?, target?, actual?}` — first in the list, drafted unless `status` says otherwise. `raisedAt` can be backdated; a status with a result stamps `resolvedAt` (not before `raisedAt`). `actual` needs a target. Returns `{added: true, id, suggestedVerdict}` or `{added: false, reason: invalid, errors}`.
- **`update_hypothesis`** (write) `{hypothesisId, believe?, willDo?, toLearn?, successMetric?, experiment?, description?, outcome?, raisedAt?, target?}` — edit in place; `null` clears `experiment`, `description`, `outcome` or `target`. This is how a hand-off draft gets what we'll do, its metric and a target. Returns `{updated: true, id, missing, suggestedVerdict}` or `{updated: false, reason: nothing_to_update | not_found | invalid, errors?}`.
- **`set_status`** (write) `{hypothesisId, status, resolvedAt?}` — drafted | running | validated | invalidated | inconclusive. A draft missing what we'll do or its metric can't move on (`needs_detail`, with `missing`). Returns `{updated: true, status, resolvedAt?}` or `{updated: false, reason: not_found | needs_detail | not_a_day | future_day | before_raised | no_result}`.
- **`record_result`** (write) `{hypothesisId, actual: number | null}` — the measured result (`null` clears it). It never changes the status: apply the suggestion with `set_status` once the user agrees. Returns `{updated: true, actual, suggestedVerdict, suggestion}` or `{updated: false, reason: not_found | no_target, message?}`.

#### User Interview Log — `tool.user_interviews.*`

One document, `userInterviewLog:current`. Themes count participants, not quotes: participants match by name ignoring case, and an unnamed interview counts on its own.

- **`list_state`** (read) `{}` — `{exists, totalInterviews, totalQuotes, participants, themes[{tag, participants, quotes}], topTags[{tag, count (quotes), participants}], interviews}`. `themes` holds every tag, most participants first; `topTags` the first five. A quote's `sentTo` names the opportunity it was raised as.
- **`add_interview`** (write) `{participant (≤200), date?, context? (≤2,000)}` — first in the list; `date` can be backdated. Returns `{added: true, id}` or `{added: false, reason: not_a_day | future_day}`.
- **`add_quote`** (write) `{interviewId, text (≤4,000), tags?}` — tags are trimmed, lower-cased, each once. Returns `{added: true, id}`, `{added: false}` for an unknown interview, or `{added: false, reason: example}` for an example one.
- **`send_quote_to_opportunity`** (write) `{interviewId, quoteId, parentId?}` — raises a quote as an opportunity on the Opportunity Tree, under an outcome or an opportunity, or at the root. The opportunity gets the quote with emails, phone numbers and keys redacted and the participant's name read as "the participant" (the name is never sent), and "From an interview on <day>" as its evidence. Returns `{sent: true, nodeId, parentId, text}` or `{sent: false, reason: not_found | example | already_sent (nodeId) | parent_not_found | kind | blank}`.

#### Opportunity Solution Tree — `tool.opportunity_tree.*`

One document, `opportunityTree:current`. Kinds go where the page lets them: an outcome or an opportunity at the root, an opportunity under an outcome or another opportunity (nested as deep as needed), a solution under an opportunity, an experiment under a solution.

- **`list_state`** (read) `{}` — `{exists, total, byKind, targets[{id, text, outcomeId | null}], nodes}`. An experiment carries `test`: `{state: none}`, `{state: testing, hypothesisId, status}` or `{state: tested, hypothesisId, result}`. An opportunity with `sourceRef.tool` `user-interviews` came from a quote.
- **`add_node`** (write) `{kind, text (≤2,000), parentId?, evidence?, description?}` — Returns `{added: true, id}` or `{added: false, reason: parent_not_found | example | kind, message?}`. Nothing goes under an example node.
- **`set_target`** (write) `{nodeId, on}` — the opportunity the team pursues under its outcome; an outcome has at most one, so turning one on clears the others. Returns `{updated: true, target, cleared}` or `{updated: false, reason: not_found | not_opportunity}`.
- **`remove_node`** (write, asks first) `{nodeId}` — removes the node and its whole branch; the confirmation names how many nodes go. A JTBD job linked to a removed opportunity reads "Opportunity removed". Returns `{removed: true, ids, count}`, `{removed: false, reason: not_found}` or `{removed: false, confirmed: false}`. The page offers Undo; an agent's remove is final.
- **`send_experiment_to_hypothesis`** (write) `{nodeId}` — tests an experiment as a drafted hypothesis: we believe the solution it sits under (the experiment's own text when there is none), we'll do the experiment, to learn about the nearest opportunity above. Returns `{sent: true, hypothesisId, believe, missing}` or `{sent: false, reason: not_found | not_experiment | example | already_sent (hypothesisId) | blank}`.
- No verb moves a node: a re-parent, like any other edit, goes through `workspace.opportunity_tree.update` with the whole `nodes` list. A write that leaves two targets under one outcome is refused.

#### Riskiest Assumption Canvas — `tool.riskiest_assumption.*`

One document, `riskiestAssumption:current`. The score is risk × (6 − evidence), 1–25; ties go to higher risk, then lower evidence, then the order added, as the page ranks. An assumption with either rating unset is not rated and never ranked. One is tested, and leaves the ranking, when its own status is validated or invalidated or its linked hypothesis is; an inconclusive test keeps it ranked, to test again.

- **`list_state`** (read) `{}` — `{exists, total, byStatus, riskiest, ranking, unrated, tested, assumptions}`. `ranking` items are `{id, statement, rank, score, riskLevel, evidenceLevel, quadrant (test-first | monitor | defer | solid), status, test}`; `unrated` `{id, statement, status}`; `tested` `{id, statement, status, result: validated | invalidated}`. `total`, `byStatus` and `assumptions` count every stored row.
- **`add_assumption`** (write) `{statement (≤1,000), riskLevel? (1–5), evidenceLevel? (1–5), testIdea?, status?, description?}` — last in the list. Leave the ratings out when the user hasn't given them. Returns `{added: true, id, rated, score | null}`.
- **`rate_assumption`** (write) `{assumptionId, riskLevel?: 1–5 | null, evidenceLevel?: 1–5 | null}` — `null` clears a rating; one left out is kept. Returns `{updated: true, riskLevel, evidenceLevel, score | null, rank | null}` or `{updated: false, reason: not_found | no_change}`.
- **`set_status`** (write) `{assumptionId, status: untested | testing | validated | invalidated}` — `{updated}`. A linked hypothesis's result never sets it: set it once the user agrees, as the page's Mark validated / Mark invalidated does.
- **`test_assumption`** (write) `{assumptionId}` — the page's Test: a drafted hypothesis (the statement as we believe, the test idea as we'll do, the description as to learn), linked both ways; the assumption's status is left alone. Returns `{sent: true, hypothesisId, believe, missing}` or `{sent: false, reason: not_found | example | tested | already_sent (hypothesisId) | blank}`.

#### Risk Register — `tool.risk_register.*`

`workspace.risk` is the one store: the page, the Premortem's hand-off, the dashboards, the next steps and these verbs read it, plus the old page's rows still moving in (see above). The score is probability × impact (1–5 each). The level is low below 5, medium 5–9, high 10–15 and critical from 16, and "high" means high or critical everywhere in the toolkit. A mitigation is overdue when the risk is active (open or mitigating) and its due day has passed; due today isn't overdue. The residual rating is the probability and impact once the plan works, both or neither. Age in sprints is calendar days ÷ the cadence's sprint length (14 days when unset).

- **`compute_risk_score`** (read, pure) `{probability, impact}` — `{score, level, high, formula}`.
- **`list_state`** (read) `{today?}` — `{today, sprintLengthDays, total, byStatus, byLevel, topRisks, items, active, high, overdue, unowned, exposure, residualExposure, residualAssessed, verdict, timeToClose, pending, examples}`.
  - `items` run in the register's order (active first, then score, then days overdue, then title). Each is the risk plus `{score, level, residualScore, residualLevel, residualAboveCurrent, active, overdue, daysOverdue, ageDays, ageSprints, closedOn, impediment: {id, resolved} | null, example, pending}`. `closedOn` is the close day only while the risk is closed, so a reopened risk reads as open.
  - `total`, `byStatus`, `byLevel` and `topRisks` count every listed row, examples included.
  - `timeToClose` is `{closed, medianDays | null}`, the page's Median time to mitigate: the Kaplan-Meier median of days from raised to closed, open risks counted as still waiting and accepted ones left out. It is `null` below 3 closed risks or while fewer than half have closed.
- **`set_status`** (write) `{id, status, resolvedAt?}` — open | mitigating | accepted | closed; moves to closed or accepted are confirmed where the caller can confirm. Closing stamps the day given (backdated, never in the future or before the raised day) or today; closing a closed risk again re-dates it, and a reopen keeps the day. Returns `{updated: true, status, resolvedAt?}` or `{updated: false, reason: not-found | already-in-status | declined | resolved_at_needs_closed | not_a_day | future_day | before_raised}`.
- **`set_mitigation`** (write) `{id, mitigation?, mitigationDueAt?, residualProbability?, residualImpact?}` — at least one. Both residual values `null` clear the rating. A plan written on an open risk moves it to mitigating. A residual score above the current one is saved with a warning. Returns `{updated: true, transitioned, score, residualScore, warning?: residual_above_current}` or `{updated: false, transitioned: false, reason?: not_a_day | due_before_raised}`.
- **`set_owner`** (write) `{id, owner}` — the roster's spelling when the name is on the team; `""` clears it. Returns `{updated: true, owner | null, onTeam}` or `{updated: false, reason: not_found}`.
- **`delete`** (write, asks first) `{id}` — `{deleted: true, id, title}`, `{deleted: false, reason: not_found | pending_move, message?}` or `{deleted: false, confirmed: false}`. The page offers Undo; an agent's delete is final.
- **`raise_impediment`** (write) `{id}` — the risk happened. It creates an impediment with the title, the description and the mitigation plan, the owner, the risk's level as its severity and `sourceRef` risk-register, and the risk keeps its status. Once `list_state` shows `impediment.resolved`, close the risk with `set_status`. Returns `{raised: true, impedimentId, severity}` or `{raised: false, reason: not_found | example | not_active | untitled | already_raised, impedimentId?}`.

#### Technical Debt Tracker — `tool.tech_debt.*`

`workspace.tech_debt` is the one store, with the old page's rows moving in as for risks. An item is open until it has a `resolvedAt`. Its age in sprints is ⌊calendar days ÷ the cadence's sprint length (14 when unset)⌋ and stops at `resolvedAt`. The score is `impact × 4 − effort + min(10, interestRate × ageSprints)`: impact and effort are 1–5, and `interestRate` is the score points it gains per sprint left unpaid (0–100; 0 when not estimated). The interest term is capped at 10, so an old trivial item never outranks a fresh critical one.

- **`compute_priority`** (read, pure) `{impact, effort, interestRate?, ageSprints?}` — `{priority, score: {base, interest, capped, total}, rank_tier: must_fix (≥16) | should_fix (≥8) | defer, formula}`.
- **`list_state`** (read) `{today?}` — `{today, sprintLengthDays, totalImpact, totalEffort, openCount, resolvedCount, byArea, items, openByArea, hotspot, interestPerSprint, unestimated, oldestSprints, inBacklog, verdict, timeToResolve, pending, examples}`.
  - `items` run in the page's order (open first, then score, then age, then title). Each is the item plus `{ageDays, ageSprints, score, rank_tier, open, inBacklog: storyId | null, storyDone, example, pending}`.
  - The counts before `items` take in every item, examples included; the keys after leave examples out. `hotspot` is the area with the most impact points of open debt.
  - `timeToResolve` is `{resolved, medianDays | null}`: the Kaplan-Meier median of days from raised to resolved, open items counted as still waiting; `null` below 5 paid-down items or while fewer than half are.
- **`mark_resolved`** (write, asks first) `{id, resolvedAt?}` — paid down on a day (default today; never in the future or before the raised day); a resolved item is re-dated. Returns `{updated: true, resolvedAt}` or `{updated: false, reason: not_found | not_a_day | future_day | before_raised}`. Reopen with `workspace.tech_debt.update {id, patch: {resolvedAt: ""}}`.
- **`add_tag`** (write) `{id, tag}` (idempotent) and **`set_area`** `{id, area}` work as before and see pending rows; the page shows tags on the row.
- **`delete`** (write, asks first) `{id}` — the same results as the risk delete, `pending_move` included. A backlog story made from the item stays.
- **`add_to_backlog`** (write) `{id}` — the page's Add to backlog: an unestimated backlog story with the item's title and `sourceRef` tech-debt, linked both ways. Once `list_state` shows `storyDone`, mark the item resolved. Returns `{sent: true, storyId}` or `{sent: false, reason: not_found | example | resolved | untitled | already_sent, storyId?}`.

#### Cost of Quality — `tool.quality_cost.*`

The figures live in the page's cloud-synced blob (`agile-toolkit:quality-cost`), quarter by quarter, and only the page writes them. A cost not entered is absent (`missing`), never $0.

- **`compute_cost_of_quality`** (read, pure) `{preventionCost?, detectionCost?, internalFailureCost?, externalFailureCost?, hours?: {prevention?, detection?, internalFailure?, externalFailure?}, hourlyRate?}` — `{conformance, nonConformance, totalCoq, conformancePct, failurePct, failureShare, externalToInternal, entered, missing, costs, filledFromHours, needRate}`. A category given only as hours is costed at `hourlyRate`. `failureShare` is 0..1, or `null` without a cost on each side; `failurePct` is kept for older callers (0 at a total of 0).
- **`list_periods`** (read) `{}` — `{exists, hourlyRate | null, periods, trend, verdict | null, legacy}`.
  - Each period is `{id, period ('2026-Q3'), costs, hours, note, entered, missing, total, conformance, nonConformance, failureShare, externalToInternal}`, oldest first.
  - `trend` is `{points[{period, share, total}], latest, previous, changeVsPrevious, mannKendall}`; `changeVsPrevious` is `null` without two quarters and `mannKendall` below six.
  - `legacy` holds the one set of figures from before quarters until the person saves it as a quarter on the page; no quarter is ever assigned to it for them.

#### Test Pyramid Analyzer — `tool.test_pyramid.*`

One document, `testPyramid:current`. The shape comes from all three layers' shares: `pyramid`, `ice-cream-cone`, `hourglass`, `diamond`, `even` or `empty`, with layers within 5 points counted as level. `weighting: runtime` works the shares out from the minutes each layer takes instead of the counts, and needs all three.

- **`list_state`** (read) `{}` — `{exists, unit, integration, e2e, total, pctUnit, pctIntegration, pctE2e, healthy, inverted, weighting, runtime, shares, shape, verdict, runCost, description, updatedOn, snapshotCount, latestSnapshot, shapeHistory}`. `healthy` and `inverted` read the counts and are kept for older callers. `runCost` is `{basis: count (the relative 1 / 5 / 25 index) | runtime (minutes), byLayer, total}` or `null`. `shapeHistory` runs oldest first: `{id, takenOn, shape, unitShare}`.
- **`set_counts`** (write) `{unit?, integration?, e2e?, description?, runtime?: {unit?, integration?, e2e?}, weighting?: count | runtime}` — a merge: a field left out is kept, and `null` clears a layer's minutes (or all of them). A new pyramid needs all three counts. Stamps `updatedOn`. Returns `{updated: true, shape}` or `{updated: false, reason: missing_counts | runtime_needed, message}`.
- **`take_snapshot`** (write) `{takenOn?, note?}` — keeps the current counts (and minutes) as a dated snapshot, backdated or today, never later. Returns `{taken: true, id, takenOn}` or `{taken: false, reason: no_counts | invalid_date | too_many (200 at most), message}`.
- **`remove_snapshot`** (write) `{snapshotId}` — `{removed: true}` or `{removed: false, reason: not_found}`.

#### Flaky Test Scoreboard — `tool.flaky_tests.*`

One board, `flakyTestBoard:current`. A test's rate is failures ÷ runs, and `failureRate` is kept equal on every write. Rows from before run counts hold only a rate: they are ranked by it but left out of the weighted rate (counted in `rateOnly`). Fixed tests are out of every rate and ranking.

- **`list_state`** (read) `{}` — `{exists, total, byStatus, fixedThisQuarter, avgFailureRate, weightedFailureRate, highRateCount, fewRunsCount, longQuarantined, quarantineDateUnknown, worstOffenders, verdict, tests}`.
  - `weightedFailureRate` is the page's Failure rate (by runs): `{rate (Σ failures ÷ Σ runs over open tests with run counts, null without), failures, runs, rateOnly}`. `avgFailureRate` is the plain mean of the open tests' rates, `null` with none.
  - `highRateCount` counts open tests above 20%, `fewRunsCount` those under 10 runs, and `longQuarantined` `{id, name, days}` those quarantined 14 days or more. A `quarantinedAt` one day after today (a stamp from a clock a day ahead) reads as 0 days; `quarantineDateUnknown` counts the quarantined tests whose age can't be read (no date, or one more than a day ahead). `worstOffenders` are the top 5 open: `{id, name, status, failureRate, failures, runs, fewRuns}`.
- **`add_test`** (write) `{name, failures?, runs?, failureRate? (0..1, only without counts), status?, suite?, owner?, description?, firstSeenAt?, quarantinedAt?, fixedAt?}` — `firstSeenAt` defaults to today; a quarantined or fixed test gets its day (never before `firstSeenAt`). Returns `{added: true, id}` or `{added: false, reason: invalid_runs | missing_rate | invalid_date, message}`.
- **`update_test`** (write) `{testId, patch: {name?, suite?, owner?, failures?, runs?, description?, firstSeenAt?, quarantinedAt?, fixedAt?}}` — counts are checked against each other and the stored ones; `null` or blank clears suite, owner or description. `quarantinedAt` and `fixedAt` backdate the day of the status the test is in. Returns `{updated: true}` or `{updated: false, reason: not_found | invalid_runs | invalid_date | wrong_status, message?}`.
- **`set_status`** (write) `{testId, status: active | quarantined | fixed}` — going into quarantine stamps `quarantinedAt` (leaving clears it), becoming fixed stamps `fixedAt`, and reopening keeps `fixedAt`, which the page shows as Last fixed. The stamp is today, or the test's own later day when that is one day ahead at most, as the page stamps it, so it never comes before `firstSeenAt`. Returns `{updated: true, status, fixedAt, quarantinedAt}` or `{updated: false}`.
- **`remove_test`** (write) `{testId}` — `{removed: true}` or `{removed: false, reason: not_found}`.

#### Code Review Metrics — `tool.code_review_metrics.*`

One log, `codeReviewLog:current`. Times are wall-clock `YYYY-MM-DDTHH:MM`: a zone suffix is dropped, not converted (only the page's CSV import converts zoned times). Working hours count the ceremony cadence's working days minus its holidays, and only the hours of the log's `workingWindow` when one is set; unset counts whole working days, and there is no default window. The view is team-level by PR size, with no per-author figures, and these medians don't feed DORA or the Team Dashboard.

- **`list_state`** (read) `{}` — `{exists, total, mergedCount, openCount, invalidCount, awaitingReviewCount, medianCycleWorkingHours, medianFirstReviewWorkingHours, medianCycleHours, medianFirstReviewHours, p85CycleWorkingHours, p85FirstReviewWorkingHours, workingBasis, bySize, largeNoComments, weekly, verdict, avgCycleTimeHours, avgReviewers, avgComments, avgLinesChanged, samples}`.
  - The medians are `null` below 3 PRs and the P85s below 5; the `…Hours` ones without "Working" are elapsed time.
  - `workingBasis` is `{label, workingDays (0 = Sunday), holidays, window: {start, end} | null}`, printed under the page's cards.
  - `bySize` holds the bands small (≤100 lines), medium (101–400) and large (>400): `{band, label, n, merged, medianCycleWorkingHours, medianFirstReviewWorkingHours, medianComments}`, each median `null` below 3. `largeNoComments` counts large PRs merged with 0 comments. `weekly` is by merge week, quiet weeks included: `{week, n, medianCycleWorkingHours (null below 3 merges)}`.
  - The means (`avg…`) are kept for older callers.
- **`add_sample`** (write) `{author, openedAt, firstReviewAt?, mergedAt?, reviewerCount, commentCount, linesChanged, prNumber?, description?}` — checked as the page's form: opened ≤ first review ≤ merged, none in the future, whole-number counts; a leading `@` on the author is dropped. Returns `{added: true, id}`, `{added: false, reason: invalid, message, errors}` or `{added: false, reason: duplicate, id}` (that PR number is logged already).
- **`update_sample`** (write) `{sampleId, patch}` — edits a logged PR in place, as the page's Edit does; the PR keeps its id. `patch` holds `add_sample`'s fields to change; `null` or blank clears `firstReviewAt`, `mergedAt`, `prNumber` or `description`. The patched PR must still read as `add_sample` requires, and a `prNumber` another PR holds is refused. Returns `{updated: true, id, fields (the stored fields that changed; [] when nothing did)}`, `{updated: false, reason: not_found}`, `{updated: false, reason: invalid, message, errors}` or `{updated: false, reason: duplicate, id}`.
- **`remove_sample`** (write) `{sampleId}` — `{removed: true}` or `{removed: false, reason: not_found}`.
- **`set_working_window`** (write) `{start?, end?}` as `HH:MM`, end after start; neither clears it (whole days). Returns `{updated: true, workingWindow: {start, end} | null}` or `{updated: false, reason: invalid_window, message}`.

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
