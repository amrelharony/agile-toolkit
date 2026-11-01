/**
 * docs/MCP-AGENTS.md against the code it describes, for the pulse tools
 * (Squad Health Check, Psych Safety, Mood Tracker): every registered verb
 * is documented, the singleton CRUDs say what a create without the id does,
 * the minimums are the libraries' own, and the worked examples return what
 * the code returns. A change on either side fails here instead of leaving
 * the doc wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/workspace";
import "@/lib/actions/tools/health-check";
import "@/lib/actions/tools/psych-safety";
import "@/lib/actions/tools/mood-tracker";
import "@/lib/actions/tools/retro";
import "@/lib/actions/tools/sprint-compare";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { HEALTH_CHECK_ID, emptyHealthCheck, lightFromVotes } from "@/lib/health-check/score";
import {
  ANOMALY_DROP,
  LEGACY_ROUND_ID,
  PSYCH_SAFETY_ID,
  PSYCH_SAFETY_MIN_RESPONSES,
  checkRoundCounts,
  emptyPsychSafetyLog,
  roundResult,
  withoutRound,
} from "@/lib/psych-safety/instrument";
import {
  LOW_MOOD,
  MOOD_WINDOW_DAYS,
  moodDuring,
  moodSummary,
  moodTrackerDoc,
} from "@/lib/team/mood";
import {
  MOOD_TRACKER_ID,
  type MoodEntry,
  type PsychSafetyResponse,
} from "@/lib/stores/workspace-types";

const DOC = readFileSync(join(process.cwd(), "docs", "MCP-AGENTS.md"), "utf8");

/** The text under `heading`, up to the next heading of the same level or above. */
function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`No "${heading}" in docs/MCP-AGENTS.md`);
  const level = heading.slice(0, heading.indexOf(" ")).length;
  const rest = DOC.slice(start + heading.length + 1);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

const HEALTH = section("#### Squad Health Check — `tool.health_check.*`");
const PSYCH = section("#### Psychological Safety — `tool.psych_safety.*`");
const MOOD = section("#### Team Mood Tracker — `tool.mood_tracker.*`");
const TEAM = section("### Team & people");

describe("MCP-AGENTS.md: the pulse tools' verbs", () => {
  it.each([
    ["tool.health_check", HEALTH],
    ["tool.psych_safety", PSYCH],
    ["tool.mood_tracker", MOOD],
  ] as const)("%s: every registered verb is documented", (toolId, text) => {
    const verbs = registry.list({ toolId }).map((a) => a.name);
    expect(verbs.length).toBeGreaterThan(0);
    for (const verb of verbs) expect(text, verb).toContain(`\`${verb}\``);
  });

  it("Psych Safety: the per-response verbs are documented as deprecated", () => {
    expect(registry.get("tool.psych_safety.log_response")?.description).toMatch(/^Deprecated/);
    expect(registry.get("tool.psych_safety.remove_response")?.description).toMatch(/^Deprecated/);
    expect(PSYCH).toMatch(/\*\*Deprecated, still registered:\*\* `log_response`/);
    expect(PSYCH).toContain(`\`${LEGACY_ROUND_ID}\``);
  });
});

describe("MCP-AGENTS.md: the pulse tools' documents", () => {
  const bullet =
    TEAM.split("\n").find((l) => l.startsWith("- **The pulse tools' documents.**")) ?? "";

  const takesNoId = (toolId: string, entity: object) => {
    const create = registry.get(`${toolId}.create`);
    if (!create) throw new Error(`missing action ${toolId}.create`);
    return create.paramsSchema.safeParse({ entity: { ...entity, id: undefined } }).success;
  };

  it.each([
    ["workspace.health_check", HEALTH_CHECK_ID, emptyHealthCheck()],
    ["workspace.psych_safety_log", PSYCH_SAFETY_ID, emptyPsychSafetyLog()],
  ] as const)("%s mints a document no page shows without the id", (toolId, id, doc) => {
    expect(takesNoId(toolId, doc)).toBe(true);
    expect(bullet).toContain(`\`${id}\``);
    expect(bullet).toContain(`\`${toolId}\``);
    expect(bullet).toMatch(/no page shows/);
  });

  it("workspace.mood_tracker_doc needs the fixed id on create", () => {
    expect(takesNoId("workspace.mood_tracker_doc", moodTrackerDoc(undefined))).toBe(false);
    expect(bullet).toContain(`\`${MOOD_TRACKER_ID}\``);
    expect(bullet).toMatch(/`workspace\.mood_tracker_doc`, which needs the fixed id on create/);
  });

  it("workspace.psych_safety_log still carries the named answer sheets, and says so", () => {
    // A sheet from before rounds, with the name its respondent typed: the
    // generic CRUD's schema still takes it, and list still returns it.
    const sheet: PsychSafetyResponse = {
      id: "r1",
      ts: "2026-01-05T10:00:00.000Z",
      scores: { q1: 2, q2: 4, q3: 2, q4: 4, q5: 2, q6: 4, q7: 4 },
      respondent: "Priya",
    };
    const log = { ...emptyPsychSafetyLog(), responses: [sheet] };
    const create = registry.get("workspace.psych_safety_log.create");
    expect(create?.paramsSchema.safeParse({ entity: log }).success).toBe(true);
    for (const verb of ["list", "update"]) {
      expect(registry.get(`workspace.psych_safety_log.${verb}`), verb).toBeDefined();
    }
    expect(bullet).toMatch(/`responses` are the answer sheets .* can carry the name they typed/);
    expect(bullet).toMatch(/`workspace\.psych_safety_log` list and update still read and write/);
    expect(bullet).toMatch(/don't read, quote or write them/);
    // Removing the legacy round is what clears them.
    expect(withoutRound(log, LEGACY_ROUND_ID)?.responses).toEqual([]);
    expect(registry.get("tool.psych_safety.remove_round")).toBeDefined();
    expect(bullet).toContain(`\`tool.psych_safety.remove_round\` with \`${LEGACY_ROUND_ID}\``);
  });

  it("switching Mood to anonymous keeps the check-ins by name, as the page says", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "app", "(tools)", "mood-tracker", "mood-tracker-client.tsx"),
      "utf8"
    );
    expect(page).toContain(
      "Earlier check-ins by name are kept but not shown, and still count in the team average."
    );
    expect(bullet).toMatch(
      /Switching to `anonymous` keeps the check-ins saved by name: the page hides them but still counts them in the team average, and `workspace\.mood_entry` still lists them/
    );
  });
});

describe("MCP-AGENTS.md: the pulse tools' minimums", () => {
  it("vote rounds are the browser's; agents record totals under the same floors", () => {
    const bullet = TEAM.split("\n").find((l) =>
      l.startsWith("- **Vote rounds run in the browser.**")
    );
    expect(bullet).toContain(
      `(${MIN_SAMPLE.anonymous} answers, ${PSYCH_SAFETY_MIN_RESPONSES} for Psych Safety)`
    );
    // Only the tool verbs keep rounds anonymous: the generic CRUD still holds
    // the sheets from before rounds, and the bullet says so.
    expect(bullet).toMatch(/No `tool\.\*` action takes or returns who answered what in a round\./);
    expect(bullet).not.toMatch(/No action takes or returns/);
    expect(bullet).toMatch(
      /`workspace\.psych_safety_log` still carries the per-person answer sheets/
    );
  });

  it("Health Check: votes from MIN_SAMPLE.anonymous", () => {
    expect(HEALTH).toContain(`counts, from ${MIN_SAMPLE.anonymous} votes`);
    expect(HEALTH).toContain(`fewer than ${MIN_SAMPLE.anonymous} votes`);
  });

  it("Psych Safety: results and people from five, a fall over ANOMALY_DROP", () => {
    expect(PSYCH).toContain(`results show from ${PSYCH_SAFETY_MIN_RESPONSES} responses`);
    expect(PSYCH).toContain(`at least ${PSYCH_SAFETY_MIN_RESPONSES} people`);
    expect(PSYCH).toContain(`fell by more than ${ANOMALY_DROP}`);
    expect(PSYCH).toMatch(/There is no benchmark/);
  });

  it("Mood Tracker: the window, the average and the streak", () => {
    expect(MOOD).toContain(`default ${MOOD_WINDOW_DAYS}`);
    expect(MOOD).toContain(`null below ${MIN_SAMPLE.average} check-ins`);
    expect(MOOD).toContain(`averaging ${LOW_MOOD} or less`);
    expect(MOOD).toContain(`at least ${MIN_SAMPLE.anonymous} answers`);
  });

  it("Mood Tracker: list_state's average is its window's, not the sprint's", () => {
    // Same rule, different dates: a sprint that ended before the window.
    const day = (d: string, score: MoodEntry["score"], memberId: string): MoodEntry => ({
      id: `m_${d}_${memberId}`,
      memberId,
      date: d,
      score,
    });
    const entries = [
      day("2026-09-01", 1, "a"),
      day("2026-09-01", 1, "b"),
      day("2026-09-02", 1, "c"),
      day("2026-09-20", 5, "a"),
      day("2026-09-20", 5, "b"),
      day("2026-09-21", 5, "c"),
    ];
    const windowAvg = moodSummary(entries, [], "2026-09-08", "2026-09-21").average;
    const sprintAvg = moodDuring(entries, "2026-08-31", "2026-09-11").average;
    expect(windowAvg).not.toBe(sprintAvg);

    expect(MOOD).not.toMatch(/is the number the retro and Sprint Comparison quote/);
    expect(MOOD).toMatch(/`average` \(1–5\) is over this window/);
    for (const id of ["tool.retro.list_state", "tool.sprint_compare.list_state"]) {
      expect(registry.get(id), id).toBeDefined();
      expect(MOOD).toContain(`\`${id}\``);
    }
  });
});

describe("MCP-AGENTS.md: the pulse tools' examples", () => {
  /** The example's call on `name` and the result line after it, parsed. */
  function example(name: string): { args: Record<string, unknown>; result: unknown } {
    const lines = HEALTH.split("\n").concat(PSYCH.split("\n"), MOOD.split("\n"));
    const at = lines.findIndex((l) => l.includes(`"name":"${name}"`));
    if (at < 0) throw new Error(`No example calls ${name}`);
    const call = JSON.parse(lines[at]) as { params: { arguments: Record<string, unknown> } };
    const result = JSON.parse(lines[at + 1].replace(/^\/\/ → /, ""));
    return { args: call.params.arguments, result };
  }

  it("set_dimension: the votes give the light the example says", () => {
    const { args, result } = example("tool.health_check.set_dimension");
    const light = lightFromVotes(args.votes as { green: number; yellow: number; red: number });
    expect(result).toEqual({ set: true, key: args.dimension, light, lightFromVotes: light });
  });

  it("log_round: the counts give the team score the example says", () => {
    const { args, result } = example("tool.psych_safety.log_round");
    const checked = checkRoundCounts(args.counts as Record<string, number[]>);
    if (!checked.ok) throw new Error(checked.reason);
    const r = roundResult({
      id: "psRound_x",
      name: String(args.name),
      date: "2026-10-01",
      source: "facilitator",
      responses: checked.responses,
      counts: checked.counts,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(result).toEqual({
      added: true,
      id: "psRound_x",
      teamScore: r ? Math.round((r.teamScore ?? NaN) * 100) / 100 : null,
      withheld: r?.withheld ?? [],
    });
  });
});
