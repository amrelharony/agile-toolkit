// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_GUIDES } from "@/lib/tools/guides/core";
import { GUIDES } from "@/lib/tools/guides/prioritize";
import type { ToolGuide } from "@/lib/tools/guides";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { FIBONACCI_TEXT, FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import {
  VE_HIGH_EFFORT_FROM,
  VE_HIGH_VALUE_FROM,
  VE_LABEL,
  VE_QUADRANTS,
} from "@/lib/prioritization/methods/value-effort";
import {
  MOSCOW_BUCKETS,
  MOSCOW_LABEL,
  MUST_BUDGET_MIN_SIZED,
  MUST_BUDGET_SHARE,
} from "@/lib/prioritization/methods/moscow";
import {
  REACH_PERIOD_LABEL,
  RICE_EFFORT_MIN,
  RICE_IMPACT_STEPS,
} from "@/lib/prioritization/methods/rice";
import {
  COD_DURATION_MIN,
  COD_URGENCIES,
  COD_URGENCY_LABEL,
} from "@/lib/prioritization/methods/cost-of-delay";
import {
  EISENHOWER_LABEL,
  EISENHOWER_QUADRANTS,
  URGENT_WITHIN_DAYS,
  dueText,
} from "@/lib/prioritization/methods/eisenhower";
import {
  KANO_CATEGORIES,
  KANO_CATEGORY_LABEL,
  KANO_MIN_RESPONSES,
  KANO_QUESTIONS,
} from "@/lib/prioritization/methods/kano";
import { MANY_AGREE, STALE_PROPOSED_DAYS } from "@/lib/decisions/model";
import { TEMPLATES } from "@/lib/decisions/templates";
import { DECISION_STATUSES } from "@/lib/stores/workspace-types";
import { DEFAULT_MATRIX_NAME, TIE_MARGIN } from "@/lib/weighted/model";
import { ANSWER_LABEL, DOMAINS, DOMAIN_IDS } from "@/lib/cynefin/model";

/*
 * The Prioritize & decide guides name the pages' labels and quote the
 * scales and minimums behind them. These lock the lines against the
 * method registry's constants and the pages' own source, so a renamed
 * button, a changed threshold or a removed control fails here instead of
 * leaving a guide describing a page that isn't there.
 */

const ALL = [...CORE_GUIDES, ...GUIDES];

function guide(id: string): ToolGuide {
  const found = ALL.find((g) => g.toolId === id);
  if (!found) throw new Error(`No guide for ${id}`);
  return found;
}

const allText = (g: ToolGuide) => [g.summary, ...g.steps, ...(g.tips ?? [])].join("\n");
const scaleValues = (g: ToolGuide, name: string) =>
  g.scales?.find((s) => s.name === name)?.values.map((v) => v.value) ?? [];

const source = (...files: string[]) =>
  files.map((f) => readFileSync(join(process.cwd(), f), "utf8")).join("\n");
const tool = (id: string, ...files: string[]) =>
  source(...files.map((f) => `src/app/(tools)/${id}/${f}`));

const WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

const TOOLS = [
  "prioritizer",
  "rice-scoring",
  "wsjf",
  "ice-score",
  "moscow",
  "cost-of-delay",
  "value-effort-matrix",
  "eisenhower",
  "kano-model",
  "buy-a-feature",
  "hundred-dollar-test",
  "decision-log",
  "daci",
  "rapid-decision",
  "weighted-decision",
  "cynefin",
];

/** The shared method shell and its backlog link, where the method tools' buttons are labelled. */
const SHELL = source(
  "src/components/prioritization/method-tool.tsx",
  "src/components/prioritization/backlog-link.tsx",
  "src/components/shared/resort-chip.tsx"
);

/** The vote-round kit's source, where its buttons are labelled. */
const KIT = source(
  "src/components/collab/vote-room/vote-round-panel.tsx",
  "src/components/collab/vote-room/host-vote-room.tsx",
  "src/components/collab/vote-room/facilitator-pair.tsx",
  "src/components/collab/vote-room/facilitator-allocation.tsx",
  "src/components/collab/visitor-room-chip.tsx"
);

describe("the Prioritize & decide guides describe the pages as they are now", () => {
  it.each([
    ["value-effort-matrix", /split at 5|click Plot|can't be edited|re-plot/i],
    ["kano-model", /Pick the Kano category|Sat if present|Dissat|tick each answer/i],
    ["eisenhower", /Pick the matching quadrant|quadrant menu/i],
    ["cost-of-delay", /weeks delayed|Total CoD|Top 10/i],
    ["ice-score", /remove it and add it again/i],
    ["hundred-dollar-test", /export each|add them up|one round per person/i],
    ["buy-a-feature", /doesn't track player budgets|can't be undone/i],
    ["prioritizer", /each 1–10|Major Projects|Time Sinks/i],
    ["daci", /separated by commas|click the tick/i],
    ["rapid-decision", /separated by commas|click the tick/i],
    ["decision-log", /numbered Title|ADR-0001:/i],
    ["cynefin", /click Classify/i],
  ])("%s drops the removed UI", (id, removed) => {
    expect(allText(guide(id))).not.toMatch(removed);
  });

  it("the method tools name the shell's own buttons", () => {
    for (const label of ["Import from backlog", "Add & score", "Re-sort", "Edit ", "Delete "]) {
      expect(SHELL).toContain(label);
    }
    expect(allText(guide("rice-scoring"))).toContain("Import from backlog");
    expect(allText(guide("ice-score"))).toContain("Add & score");
    expect(allText(guide("wsjf"))).toContain("Re-sort");
  });
});

describe("the hub and the scoring methods quote their scales", () => {
  it("Prioritizer: the tabs and the Decide order step's labels", () => {
    const text = allText(guide("prioritizer"));
    const page = tool(
      "prioritizer",
      "prioritizer-client.tsx",
      "components/add-item-form.tsx",
      "components/decide-order.tsx",
      "components/scores-tab.tsx",
      "components/score-editor.tsx"
    );
    for (const label of [
      "Add an item",
      "Add item",
      "All methods",
      "Decide order",
      "Score with",
      "Methods disagree",
      "Use the consensus",
      "Save order",
      "Add to the order",
      "2. Your order",
      "Clear all",
    ]) {
      expect(text, label).toContain(label);
      expect(page, label).toContain(label);
    }
    expect(text).toContain(FIBONACCI_VALUES.join(", "));
  });

  it("WSJF: the column picker's labels and the Fibonacci steps", () => {
    const text = allText(guide("wsjf"));
    const page = tool("wsjf", "wsjf-client.tsx", "column-mode.tsx", "wsjf-inputs.tsx");
    for (const label of ["Feature title", "Score by column", "Next column", "RR/OE", '"Size"']) {
      expect(page, label).toContain(label);
    }
    expect(text).toContain("(BV, TC, RR/OE or Size)");
    expect(text).toContain(FIBONACCI_VALUES.join(", "));
  });

  it("RICE: the periods, the impact scale and the effort minimum", () => {
    const g = guide("rice-scoring");
    const text = allText(g);
    expect(Object.values(REACH_PERIOD_LABEL)).toEqual([
      "per week",
      "per month",
      "per quarter",
      "per year",
    ]);
    expect(text).toContain("Reach period (per week, month, quarter or year)");
    expect(text).toContain(`${RICE_EFFORT_MIN} or more`);
    expect(scaleValues(g, "Impact")).toEqual(RICE_IMPACT_STEPS.map((s) => String(s.value)));
    expect(tool("rice-scoring", "rice-inputs.tsx")).toContain("How sure? See examples");
  });

  it("MoSCoW: the buckets, the 60% marker and the budget's minimum", () => {
    const g = guide("moscow");
    expect(scaleValues(g, "Buckets")).toEqual(MOSCOW_BUCKETS.map((b) => MOSCOW_LABEL[b]));
    const text = allText(g);
    expect(text).toContain(`a marker at ${Math.round(MUST_BUDGET_SHARE * 100)}%`);
    expect(text).toContain(`once ${WORDS[MUST_BUDGET_MIN_SIZED]} planned items have an effort`);
    expect(tool("moscow", "moscow-inputs.tsx")).toMatch(/"Move" : "Sort"/);
  });

  it("Cost of Delay: the lanes, the duration minimum and the unscored lane", () => {
    const text = allText(guide("cost-of-delay"));
    expect(COD_DURATION_MIN).toBe(0.5);
    expect(text).toContain("half a week at least");
    for (const u of COD_URGENCIES) expect(text).toContain(COD_URGENCY_LABEL[u]);
    const lanes = tool("cost-of-delay", "lanes.ts");
    expect(lanes).toContain("Not scored: add a duration");
    expect(text).toContain("Not scored: add a duration");
    expect(lanes).toContain("Start by ${start} to land by ${land}");
  });

  it("Value/Effort: the quadrants, the one value scale and what counts as high", () => {
    const g = guide("value-effort-matrix");
    const name = `Quadrants (value ${VE_HIGH_VALUE_FROM} or more, effort ${VE_HIGH_EFFORT_FROM} or more count as high)`;
    expect(scaleValues(g, name)).toEqual(VE_QUADRANTS.map((q) => VE_LABEL[q]));
    expect(allText(g)).toContain(`Value (${FIBONACCI_TEXT}`);
    expect(source("src/components/shared/drag-matrix.tsx")).toContain("Place in…");
  });

  it("Eisenhower: the quadrants and the due-date rule", () => {
    const g = guide("eisenhower");
    expect(scaleValues(g, "Quadrants")).toEqual(
      EISENHOWER_QUADRANTS.map((q) => EISENHOWER_LABEL[q])
    );
    const text = allText(g);
    expect(text).toContain(`Due within ${URGENT_WITHIN_DAYS} days, or overdue, makes it urgent`);
    expect(text).toContain(`“Urgent because it's ${dueText(1)}”`);
    expect(tool("eisenhower", "config.ts")).toContain('submitLabel: "Add task"');
  });
});

describe("the survey and vote tools run their rounds as the kit does", () => {
  const LIVE = ["Run a live round", "Copy link", "Show QR code", "Reveal results", "Save round"];

  it.each([...LIVE, "Enter counts instead", "Show totals"])("the kit labels a button %j", (l) => {
    expect(KIT).toContain(l);
  });

  it.each(["kano-model", "buy-a-feature", "hundred-dollar-test"])(
    "%s walks through the live round and the count entry",
    (id) => {
      const text = allText(guide(id));
      // The link is shared by Copy link or by the room chip's QR code.
      for (const label of LIVE) expect(text).toContain(label);
      expect(text).toContain("Enter counts instead");
      expect(text).toContain(`once ${MIN_SAMPLE.anonymous} have answered`);
      expect(text).toMatch(/never (anyone's split|who answered)/);
    }
  );

  it("Kano: the two questions, the categories and the minimum", () => {
    const g = guide("kano-model");
    const text = allText(g);
    expect(text).toContain(KANO_QUESTIONS.functional);
    expect(text).toContain(KANO_QUESTIONS.dysfunctional);
    expect(text).toContain(`from ${KANO_MIN_RESPONSES} answers`);
    expect(scaleValues(g, "Kano categories")).toEqual(
      KANO_CATEGORIES.map((c) => KANO_CATEGORY_LABEL[c])
    );
    const page = tool("kano-model", "kano-model-client.tsx", "inputs.tsx", "rows.tsx");
    for (const label of [
      "How you have the answers",
      "One person's answers",
      "Survey counts",
      "Ask customers",
      "Add to earlier answers",
      "Better vs Worse",
      "How the category is found",
      "Add answers",
    ]) {
      expect(page, label).toContain(label);
      expect(text, label).toContain(label);
    }
  });

  it("Kano: paper answers are counts typed into the pair grid, first answer down", () => {
    const grid = source("src/components/collab/vote-room/facilitator-pair.tsx");
    expect(grid).toContain('type="number"');
    expect(grid).toContain("First ↓, second →");
    expect(allText(guide("kano-model"))).toContain(
      "type how many people gave each answer pair into the feature's 5 × 5 grid (first answer down, second across)"
    );
  });

  it("Buy-a-Feature and the $100 Test: the spread shows from MIN_SAMPLE.distribution", () => {
    expect(allText(guide("buy-a-feature"))).toContain(
      `from ${MIN_SAMPLE.distribution} answers how many backed it and the spread`
    );
    // Every line saying a round keeps who backed an item says from how many answers.
    for (const id of ["buy-a-feature", "hundred-dollar-test"]) {
      const backed = allText(guide(id))
        .split("\n")
        .filter((l) => l.includes("backed it"));
      expect(backed.length, id).toBeGreaterThan(0);
      for (const line of backed) {
        expect(line, id).toContain(`from ${MIN_SAMPLE.distribution} answers`);
      }
    }
    expect(allText(guide("hundred-dollar-test"))).toContain(
      `from ${MIN_SAMPLE.distribution} answers how the amounts were spread`
    );
    const baf = tool("buy-a-feature", "buy-a-feature-client.tsx", "game-settings.tsx");
    for (const label of [
      "The game",
      "Players",
      "Budget per player",
      "Play a round",
      "Refund unfunded features",
      "About half the prices",
    ]) {
      expect(baf, label).toContain(label);
    }
    const hdt = tool("hundred-dollar-test", "hundred-dollar-test-client.tsx");
    for (const label of ["The agreed split", "Left to give", "Ask the team", "Team results"]) {
      expect(hdt, label).toContain(label);
    }
  });
});

describe("the decision guides follow the one decision record", () => {
  it("Decision Log: the statuses, the forms and what a record still needs", () => {
    const g = guide("decision-log");
    expect(scaleValues(g, "Status")).toEqual([...DECISION_STATUSES]);
    const text = allText(g);
    expect(text).toContain(`proposed for over ${STALE_PROPOSED_DAYS} days`);
    for (const t of Object.values(TEMPLATES)) expect(text).toContain(t.label);
    const page = tool("decision-log", "decision-card.tsx", "decide-form.tsx", "decision-form.tsx");
    for (const label of [
      "Record the decision",
      "What was decided",
      "Option chosen",
      "Superseded by…",
      "Supersede",
      "Reopen",
      "Deprecate",
      "Raised on",
      "Options considered",
    ]) {
      expect(page, label).toContain(label);
      expect(text, label).toContain(label);
    }
  });

  it("DACI and RAPID: the forms' roles and the Agree limit", () => {
    const daci = allText(guide("daci"));
    for (const r of TEMPLATES.daci.roles) expect(daci).toContain(r.label);
    expect(daci).toContain(TEMPLATES.daci.deciderLabel);
    const rapid = allText(guide("rapid-decision"));
    for (const r of TEMPLATES.rapid.roles) expect(rapid).toContain(r.label);
    expect(rapid).toContain(TEMPLATES.rapid.deciderLabel);
    expect(rapid).toContain(`more than ${WORDS[MANY_AGREE]} shows a warning`);
    for (const id of ["daci", "rapid-decision"]) {
      expect(allText(guide(id))).toContain("Mark carried out");
      expect(guide(id).summary).toMatch(/^The Decision Log raised in the (DACI|RAPID) form/);
    }
    expect(tool("decision-log", "decision-card.tsx")).toContain("Mark carried out");
  });

  it("Weighted Decision Matrix: the tie margin and the default matrix", () => {
    const text = allText(guide("weighted-decision"));
    expect(text).toContain(`within ${Math.round(TIE_MARGIN * 100)}%`);
    expect(text).toContain(`the ${DEFAULT_MATRIX_NAME}`);
    expect(tool("weighted-decision", "result-card.tsx")).toContain("Decision record (proposed)");
    expect(tool("weighted-decision", "result-card.tsx")).toContain("How sensitive is the result?");
  });

  it("Cynefin: the answers and the domains", () => {
    const g = guide("cynefin");
    expect(allText(g)).toContain(
      `${ANSWER_LABEL.yes}, ${ANSWER_LABEL.no} or ${ANSWER_LABEL.unsure}`
    );
    expect(scaleValues(g, "Domains")).toEqual(DOMAIN_IDS.map((d) => DOMAINS[d].label));
    const page = tool("cynefin", "sense-form.tsx", "item-card.tsx");
    for (const label of ["Make sense of it", "Use the suggestion", "Why this domain", "Place it"]) {
      expect(page, label).toContain(label);
    }
    expect(page).toContain("Turn into a hypothesis");
  });
});

describe("every Prioritize & decide guide", () => {
  it.each(TOOLS)("%s stays short enough to read in a panel", (id) => {
    expect(JSON.stringify(guide(id)).length).toBeLessThan(2500);
  });
});
