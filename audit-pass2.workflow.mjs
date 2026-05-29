export const meta = {
  name: "deep-test-pass2",
  description:
    "Calibrated 2nd-pass deep test of 79 MCP tools: round-trip/drift/math/guards with a 3-lens verification panel (fixes pass-1 over-refutation)",
  phases: [
    {
      title: "Review",
      detail:
        "fresh per-tool + core review; cross-tool ownership + drift emphasis; pre-verified invariants excluded",
    },
    {
      title: "Verify",
      detail:
        "3 distinct lenses (round-trip / logic-math / guard-edge); confirm on 2-of-3 OR one high-confidence concrete proof",
    },
    { title: "Synthesize", detail: "prioritize + dedupe confirmed findings into a report" },
  ],
};

const TOOLS = [
  "a11y-tracker",
  "agentic-workflow",
  "ai-feature-spec",
  "ai-red-team",
  "ai-safety-checklist",
  "async-standup",
  "burndown",
  "burnup",
  "canvas",
  "capacity-planner",
  "code-review-metrics",
  "control-map",
  "cost-of-delay",
  "cumulative-flow",
  "cycle-time",
  "cynefin",
  "daci",
  "decision-log",
  "dependency-map",
  "design-sprint",
  "devex-survey",
  "dora-scorecard",
  "eisenhower",
  "epic-roadmap",
  "estimation-guide",
  "flaky-tests",
  "hallucination-log",
  "hitl-quality",
  "hypothesis-tracker",
  "ice-score",
  "jtbd-mapper",
  "kanban",
  "kano-model",
  "liberating-structures",
  "llm-eval-tracker",
  "model-card",
  "model-comparison",
  "model-migration",
  "mood-tracker",
  "moscow",
  "nps-csat",
  "okrs",
  "ooda-loop",
  "opportunity-tree",
  "platform-maturity",
  "polarity-map",
  "prioritizer",
  "prompt-registry",
  "quality-cost",
  "rapid-decision",
  "release-planner",
  "retro",
  "rice-scoring",
  "risk-register",
  "riskiest-assumption",
  "rlhf-log",
  "scrum-of-scrums",
  "six-hats",
  "slo-builder",
  "space-pulse",
  "sprint-compare",
  "sprint-goal",
  "sprint-review",
  "standup",
  "story-mapper",
  "tech-debt",
  "test-pyramid",
  "threat-model",
  "token-cost-tracker",
  "user-interviews",
  "value-effort-matrix",
  "value-stream",
  "vector-store-inventory",
  "velocity",
  "vuln-burndown",
  "wardley-map",
  "weighted-decision",
  "working-agreement",
  "wsjf",
];

const CORE = [
  {
    name: "core:store-wiring",
    focus: `src/lib/stores/workspace-store.ts + workspace-types.ts. For EVERY entity the 7 sites must be present & consistent (type import; WorkspaceActions upsert/remove sigs; impl replaceById/filter; snapshot "field: s.field"; hydration "field: arr(...)"; registerCollection(camelKind, field); partialize) PLUS the Workspace field + emptyWorkspace default. Report any field missing from ANY site (missing partialize=not persisted; missing hydration=not loaded; missing registerCollection=not synced; missing snapshot=excluded from cross-tool reads), replaceById dedup errors, remove-cascade, or any field-name typo across sites.`,
  },
  {
    name: "core:crud",
    focus: `src/lib/actions/workspace/index.ts (defineCrudActions ~60 entities) + define-crud.ts. For each: is toolId vs selectAll field vs upsert/remove method mutually consistent? Catch copy-paste mismatches where selectAll returns the WRONG field or upsert writes a different entity than remove deletes. Check zod schema vs entity type, generateId prefixes, the generic create/list/update/delete AND mcpHandler (update merges-vs-replaces, delete-by-id, list pagination), nullable handling.`,
  },
  {
    name: "core:server-store",
    focus: `src/lib/actions/server-store.ts + context.ts. Verify serverListEntities/GetEntity/UpsertEntity correctness; soft-delete filtering; user scoping by ctx.userId. KEY: ctx.squadProfileIds is threaded in but server-store filters rows by user_id+kind ONLY — can an agent with a squad-scoped PAT read/write entities outside its squad, or is squad-scoping enforced elsewhere on the call path? Trace it concretely. Pagination correctness.`,
  },
  {
    name: "core:mcp-security",
    focus: `src/lib/mcp/transport-http.ts, pat.ts, rate-limit.ts, call-log.ts + the MCP route. PAT validation/scoping holes (cross-user/cross-squad read/write); rate-limit bypass (per-category buckets, reset window, where is it applied — route vs transport?); missing auth; injection via params; info leak in call-log. NOTE the MCP path has NO per-call confirmation by design — judge only whether THAT enables a concrete privilege/data problem, not the design itself.`,
  },
  {
    name: "core:sync",
    focus: `src/lib/sync/engine.ts, entity-adapter.ts, lww.ts, register.ts, use-cloud-persisted.ts. LWW conflict-resolution correctness; the useCloudPersisted [state,setState] hook (SSR guard, key-change race, quota) that backs migrated tools; round-trip of entities; subscription cleanup; can concurrent local+remote edits lose data?`,
  },
  {
    name: "core:analytics-forecast",
    focus: `Math correctness in src/lib/analytics/forecasting.ts, forecasting-bayesian.ts, monte-carlo.ts, bootstrap.ts, survival.ts. Hunt divide-by-zero/empty-input → NaN/Infinity, wrong percentile/quantile indexing, off-by-one CIs, bad distribution sampling, seedless nondeterminism, wrong survival/hazard math. Work a concrete numeric example to prove any claim.`,
  },
  {
    name: "core:analytics-stats",
    focus: `Math correctness in src/lib/analytics/anomaly.ts, anti-patterns.ts, changepoint.ts, control-chart.ts, cross-correlation.ts, trend-test.ts. Hunt wrong control limits (XmR constants), Mann-Kendall/CUSUM sign+significance errors, cross-correlation lag indexing, anomaly thresholds, empty/short-series handling. Prove with a concrete example.`,
  },
  {
    name: "core:analytics-misc",
    focus: `src/lib/analytics/clustering.ts, scoring-rubric.ts, eval-regression.ts, insights.ts, board-insights.ts. Aggregation errors, divide-by-zero, wrong grouping, off-by-one, empty-input crashes. Prove with a concrete example.`,
  },
];

const REVIEW_SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "severity", "file", "why", "fix", "confidence"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          file: { type: "string" },
          line: { type: ["number", "null"] },
          evidence: { type: "string", description: "short code snippet proving the bug" },
          why: {
            type: "string",
            description: "why it is a real bug and how it manifests at runtime",
          },
          fix: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["real", "confidence", "severity", "reason"],
  properties: {
    real: {
      type: "boolean",
      description: "true ONLY if you traced the live code and it concretely manifests",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
    reason: {
      type: "string",
      description:
        "cite the exact code you read; if refuting, state the concrete guard/schema/caller that prevents it",
    },
  },
};

const PRE_VERIFIED = `ALREADY VERIFIED — do NOT re-report these (they are confirmed CORRECT or are not prod bugs):
- The action executor (src/lib/agent/execute-tool.ts AND src/lib/mcp/transport-http.ts) ALWAYS runs paramsSchema.safeParse(input) BEFORE calling the handler, so Zod .default() IS applied. A handler that reads params.X with no in-handler default is NOT a bug when the zod field has .default(). Only flag if the zod field has NO default AND no in-handler guard.
- Every tool's KIND_* constant equals kindFromToolId(its workspace.* CRUD toolId) AND a registerCollection camelKind. All 79 verified consistent. Do NOT report generic "KIND mismatch" unless it is a NEW axis (e.g. the KIND points at a DIFFERENT tool's collection — see model-card below).
- All singleton-doc *_ID constants match between the action file and the client. Do NOT report singleton-id mismatches.
- Baseline is green: tsc --noEmit passes and all 1062 vitest tests pass. A "bug" that a passing test would have caught is likely wrong — unless the TEST ITSELF encodes the bug (e.g. seeds the wrong collection).`;

const KNOWN_TRUE = `KNOWN-TRUE EXAMPLE of the subtle class we are hunting (already confirmed — use it to calibrate sensitivity, and check whether YOUR tool has the same class of defect):
- model-card: the tool.model_card.* agent surface reads/writes workspace:model (ModelEntry, owned by the model-comparison tool) while the model-card UI persists workspace:modelCard (ModelCard). Agent and UI are on DIFFERENT collections, so the agent can neither see nor modify the cards the user creates, and its writes collide with model-comparison's data. The test seeds {models:[]} so it passes despite the bug. THIS is the kind of cross-collection / agent-vs-own-UI divergence and handler↔mcpHandler drift to hunt.`;

const BUG_CLASSES = `Hunt REAL, demonstrable bugs (NOT style/naming/formatting). Priority classes:
1. ROUND-TRIP / OWNERSHIP: does the agent surface read/write the SAME collection (KIND + store field) that THIS tool's OWN client component uses? A tool whose agent writes a sibling tool's collection is broken (model-card). Intentional shared reads (velocity→sprints, kudos→everything, mood/standup→teamMembers) are fine — only flag a WRITE/primary-collection divergence.
2. handler ↔ mcpHandler DRIFT: different mutation logic or return shape between the browser handler and the server mcpHandler (agent gets different results in-app vs over MCP, or one path corrupts/omits data).
3. Logic/math errors in compute_/summarize/list_state: wrong denominator, off-by-one, divide-by-zero → NaN/Infinity, wrong aggregation/sort/percentage base, nullish-vs-OR pitfalls. Work a concrete numeric example.
4. Missing guards: unknown id → should yield updated:false/added:false not crash; null/empty/NaN inputs; array index OOB.
5. requiresConfirmation:false on a genuinely destructive/overwriting op.
6. Mutation correctness: wrong timestamp stamping/clearing, replaceById vs append, dropping fields on partial update, singleton-doc id drift.
7. Migrated-client hook bugs: unstable empty {}/[] reference each render feeding a memo/selector (re-render loop), stale closure in setState, wrong doc→state field mapping, SSR/hydration mismatch — only if it concretely manifests.`;

function toolPrompt(name) {
  return `You are a meticulous senior engineer hunting REAL, demonstrable bugs in ONE MCP agent-action tool: "${name}". This is a SECOND, calibrated pass — a prior harsh audit found nothing, so look harder at the subtle classes below; do not stop at the obvious.

Read in full before judging:
- src/lib/actions/tools/${name}.ts  (the agent action surface — primary target)
- its client: src/app/(tools)/${name}/${name}-client.tsx (if missing, Glob src/app/(tools)/**/${name}-client.tsx). CONFIRM the agent surface and this client use the SAME collection/KIND + store field.
- its test: test/actions/tool-${name}.test.ts (does the test seed the SAME collection the client uses? a test seeding the wrong field hides a round-trip bug)
- the entity in src/lib/stores/workspace-types.ts, its CRUD in src/lib/actions/workspace/index.ts, its wiring in src/lib/stores/workspace-store.ts
- for any compute/aggregation, the reused lib (e.g. src/lib/analytics/*) — verify the math with a concrete example.

${PRE_VERIFIED}

${KNOWN_TRUE}

${BUG_CLASSES}

Be concrete: cite file + approx line + snippet, explain the runtime manifestation, give a precise fix. Report findings at confidence medium or high (include a high-value low only if clearly real). Cap at the 6 strongest. If genuinely none, return findings:[]. Return ONLY the structured object.`;
}

function corePrompt(unit) {
  return `You are a meticulous senior engineer doing a calibrated 2nd-pass DEEP audit of a core area of this Next.js + Zustand + Supabase codebase. A prior harsh audit found nothing here — look harder, prove concretely.

AREA: ${unit.name}
FOCUS: ${unit.focus}

${PRE_VERIFIED}

${KNOWN_TRUE}

${BUG_CLASSES}

Read the named files in full (Glob/Grep/Read freely; read callers/guards/schemas to confirm). Cite file+line+snippet, explain runtime impact, give a precise fix. REAL bugs only (confidence medium+). Cap at the 8 strongest. If none, return findings:[]. Return ONLY the structured object.`;
}

// Three DISTINCT verification lenses — calibrated, NOT refute-by-default.
const LENSES = [
  {
    key: "round-trip",
    instr: `LENS = ROUND-TRIP & WIRING. Judge whether the claim concretely breaks an agent↔UI or agent↔server round-trip, or corrupts/omits data. Trace the handler AND mcpHandler, the store field, registerCollection, and the tool's OWN client collection. A divergence where the agent's primary collection != the tool's own client collection IS real (model-card). Confirm if the data genuinely fails to round-trip.`,
  },
  {
    key: "logic-math",
    instr: `LENS = LOGIC & MATH. Judge whether the computation/aggregation/sort/guard is actually wrong. Construct a concrete numeric/string example and execute it mentally step by step. Remember the executor applies zod .default() before the handler. Confirm only if your worked example produces a wrong/NaN/Infinity/crash result.`,
  },
  {
    key: "guard-edge",
    instr: `LENS = GUARD & EDGE. Judge whether the cited input (null/empty/unknown-id/NaN/duplicate/OOB) actually crashes or misbehaves at runtime, accounting for the zod schema (defaults, required fields, enums) that runs FIRST. Confirm only if a concretely-constructable input reaches the bad code path.`,
  },
];

function verifyPrompt(lens, unitName, f) {
  const loc = f.line ? " (line ~" + f.line + ")" : "";
  return `Verify a claimed bug through ONE specific lens. You are NOT refute-by-default: confirm if the live code concretely proves the problem through your lens; refute only if you find a concrete guard/schema/caller that prevents it. If your lens does not apply to this claim, return real=false, confidence=low, reason="out of lens".

${lens.instr}

CLAIM (unit "${unitName}"):
- title: ${f.title}
- severity(claimed): ${f.severity}
- file: ${f.file}${loc}
- evidence: ${f.evidence || "(none provided)"}
- why: ${f.why}
- proposed fix: ${f.fix}

Open the cited file and read the relevant code plus any caller/guard/type/zod schema/store-site/handler/mcpHandler/client needed to judge through your lens. Return {real, confidence, severity (recalibrated), reason (cite the exact code you read)}.`;
}

const units = [
  ...TOOLS.map((name) => ({ kind: "tool", name })),
  ...CORE.map((c) => ({ kind: "core", name: c.name, focus: c.focus })),
];

log(
  "Pass-2 deep test: " +
    TOOLS.length +
    " tools + " +
    CORE.length +
    " core = " +
    units.length +
    " units; 3-lens calibrated verification."
);

const reviewed = await pipeline(
  units,
  (u) =>
    agent(u.kind === "tool" ? toolPrompt(u.name) : corePrompt(u), {
      label: "review:" + u.name,
      phase: "Review",
      schema: REVIEW_SCHEMA,
    }).catch(() => ({ findings: [] })),
  (review, u) => {
    const findings = (review && review.findings) || [];
    if (findings.length === 0) return { unit: u.name, confirmed: [] };
    return parallel(
      findings.slice(0, 8).map(
        (f) => () =>
          // 3-lens panel per finding
          parallel(
            LENSES.map(
              (lens) => () =>
                agent(verifyPrompt(lens, u.name, f), {
                  label: "verify:" + lens.key + ":" + u.name,
                  phase: "Verify",
                  schema: VERDICT_SCHEMA,
                }).catch(() => null)
            )
          ).then((votes) => {
            const v = votes.filter(Boolean);
            const reals = v.filter((x) => x.real);
            const anyHigh = reals.some((x) => x.confidence === "high");
            // Confirm on 2-of-3 real, OR a single high-confidence concrete proof.
            const confirmed = reals.length >= 2 || anyHigh;
            if (!confirmed) return null;
            // severity = max across confirming lenses
            const order = { critical: 0, high: 1, medium: 2, low: 3 };
            const sev = reals
              .map((x) => x.severity || f.severity)
              .sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9))[0];
            return {
              ...f,
              unit: u.name,
              severity: sev,
              votes: v.map((x) => ({ real: x.real, confidence: x.confidence, reason: x.reason })),
              realCount: reals.length,
              anyHigh,
            };
          })
      )
    ).then((vs) => ({ unit: u.name, confirmed: vs.filter(Boolean) }));
  }
);

const confirmed = reviewed.filter(Boolean).flatMap((r) => r.confirmed);
const order = { critical: 0, high: 1, medium: 2, low: 3 };
confirmed.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
log(
  "Pass-2 confirmed " +
    confirmed.length +
    " findings across " +
    reviewed.filter((r) => r.confirmed.length).length +
    " units."
);

phase("Synthesize");
const compact = confirmed.map((f) => ({
  unit: f.unit,
  severity: f.severity,
  title: f.title,
  file: f.file,
  line: f.line ?? null,
  why: f.why,
  fix: f.fix,
  realCount: f.realCount,
  anyHigh: f.anyHigh,
}));

let report = "(no confirmed findings in pass 2)";
if (compact.length > 0) {
  report = await agent(
    "You are the lead engineer. Below is a JSON array of findings confirmed by a calibrated 3-lens panel (2-of-3 or one high-confidence proof) in a 2nd-pass deep test of an MCP-enabled agile-toolkit. Produce a precise, prioritized Markdown report:\n" +
      "- 1-paragraph executive summary (counts by severity + systemic patterns).\n" +
      '- "Systemic issues" section: recurring classes across tools (a store-site repeatedly missed, a shared hook flaw, a round-trip/ownership pattern). Dedupe near-identical findings into ONE entry listing all affected files.\n' +
      "- Findings grouped by severity (Critical→Low): stable id, title, file:line, one-line impact, concrete fix.\n" +
      "- Recommended fix order.\n" +
      "Be concise; do not invent beyond the data. JSON:\n\n" +
      JSON.stringify(compact),
    { label: "synthesize", phase: "Synthesize" }
  ).catch((e) => "Synthesis failed: " + String(e));
}

return {
  totalConfirmed: confirmed.length,
  bySeverity: confirmed.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {}),
  confirmed,
  report,
};
