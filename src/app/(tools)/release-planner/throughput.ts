/**
 * The Release Planner's "count items" mode, as plain data: where the weekly
 * throughput comes from (finished stories on the Sprint board, cards on the
 * Flow board, or typed), how many items are left (the open backlog stories,
 * or typed), the features in order for the cut line (a typed count, or an
 * epic whose open stories are counted live), and the forecast itself
 * (lib/sprints/throughput-forecast). Pure, so the page, its export and the
 * tests read the same numbers.
 */

import type { Epic, KanbanCard, Sprint, Story } from "@/lib/stores/workspace-types";
import { cardItems, storyItems, type ThroughputPoint } from "@/lib/flow";
import { fmt, plural } from "@/lib/charts/chart-text";
import { formatDay } from "@/lib/sprints/release-forecast";
import {
  DEFAULT_WINDOW,
  FEATURE_ITEMS_MAX,
  FEATURES_MAX,
  THROUGHPUT_ITERATIONS,
  THROUGHPUT_WINDOWS,
  parseWeeklyCounts,
  perWeekText,
  throughputForecast,
  validItems,
  weeklyThroughput,
  type ThroughputForecast,
  type ThroughputWindow,
} from "@/lib/sprints/throughput-forecast";
import type { Validation } from "@/lib/utils/form";
import { isExampleId } from "@/lib/utils/example-id";
import type { BacklogScope } from "./scope-source";

/** What the forecast counts: story points (velocity, the default) or items (throughput). */
export type ForecastMode = "points" | "items";

export type ThroughputSource = "stories" | "cards" | "typed";

export const THROUGHPUT_SOURCE_LABEL: Record<ThroughputSource, string> = {
  stories: "Sprint board",
  cards: "Flow board",
  typed: "Type them",
};

export type ItemsSource = "backlog" | "typed";

export const ITEMS_SOURCE_LABEL: Record<ItemsSource, string> = {
  backlog: "Open backlog stories",
  typed: "Type a number",
};

/**
 * A feature on the cut line: a typed item count, or an epic counted live
 * (its open stories, as the Items left count reads the backlog). An epic
 * taken off the roadmap counts nothing: the page says so.
 */
export interface ReleaseFeature {
  id: string;
  name: string;
  /** Items in it, typed. */
  items?: number;
  /** An Epic Roadmap epic: its open stories are the count. */
  epicId?: string;
}

/** The Epic Roadmap's document (MUST match ER_ID in the Epic Roadmap). */
export const EPIC_ROADMAP_ID = "epicRoadmap:current";

/** A feature name's cap. */
export const FEATURE_NAME_MAX = 120;

export { DEFAULT_WINDOW, FEATURES_MAX, THROUGHPUT_WINDOWS };

/* ── Throughput ──────────────────────────────────────────────────────── */

/** Finished items on each board, as lib/flow reads them (example rows left out). */
export function finishedOn(
  stories: readonly Story[],
  cards: readonly KanbanCard[]
): { stories: { doneOn: string | null }[]; cards: { doneOn: string | null }[] } {
  return {
    stories: storyItems(stories).filter((i) => i.doneOn !== null),
    cards: cardItems(cards).filter((i) => i.doneOn !== null),
  };
}

/** The source picked, else the board with finished work (the Sprint board first), else typed. */
export function resolveThroughputSource(
  picked: ThroughputSource | undefined,
  finished: { stories: readonly unknown[]; cards: readonly unknown[] }
): ThroughputSource {
  if (picked) return picked;
  if (finished.stories.length > 0) return "stories";
  if (finished.cards.length > 0) return "cards";
  return "typed";
}

export interface ThroughputSample {
  source: ThroughputSource;
  /** One point per week, oldest first ("2026-W42", or "Week 3" when typed). */
  weeks: ThroughputPoint[];
  values: number[];
  /** The history window used for a board, in weeks. */
  window: ThroughputWindow;
}

/** The weekly counts the forecast replays. */
export function throughputSample(
  source: ThroughputSource,
  input: {
    finished: {
      stories: readonly { doneOn: string | null }[];
      cards: readonly { doneOn: string | null }[];
    };
    typed: string;
    window?: ThroughputWindow;
    today: string;
  }
): ThroughputSample {
  const window = input.window ?? DEFAULT_WINDOW;
  if (source === "typed") {
    const values = parseWeeklyCounts(input.typed).values;
    return {
      source,
      window,
      values,
      weeks: values.map((value, i) => ({ label: `Week ${i + 1}`, value })),
    };
  }
  const weeks = weeklyThroughput(
    source === "stories" ? input.finished.stories : input.finished.cards,
    input.today,
    window
  );
  return { source, window, weeks, values: weeks.map((w) => w.value) };
}

/* ── Items left ──────────────────────────────────────────────────────── */

/** The source picked, else the backlog when it has open stories, else typed. */
export function resolveItemsSource(
  picked: ItemsSource | undefined,
  backlog: Pick<BacklogScope, "stories">
): ItemsSource {
  return picked ?? (backlog.stories > 0 ? "backlog" : "typed");
}

/** The items to finish: the open backlog stories, or the typed count; null when not set. */
export function itemsLeft(
  source: ItemsSource,
  backlog: Pick<BacklogScope, "stories">,
  typed: number | undefined
): number | null {
  if (source === "backlog") return backlog.stories > 0 ? backlog.stories : null;
  return validItems(typed ?? null);
}

/* ── Features ────────────────────────────────────────────────────────── */

export interface FeatureRow {
  id: string;
  name: string;
  /** The items counted for it (an epic's open stories now; 0 once its epic is gone). */
  items: number;
  epicId?: string;
  /** The epic it counts is no longer on the roadmap. */
  epicMissing: boolean;
}

/** Which stories count as left, the way Items left reads the backlog (scope-source backlogScope). */
export interface OpenStoryRules {
  /** The sprints, so stories in a completed or cancelled sprint don't count. */
  sprints?: readonly Pick<Sprint, "id" | "status">[];
  /** The running sprint when the forecast starts after it: its stories are its own work. */
  skipSprintId?: string;
}

/**
 * Open stories of each epic, by epic id, counted as Items left counts the
 * backlog: example stories, stories in a closed sprint and the stories of
 * the sprint the forecast starts after are left out.
 */
export function openStoriesByEpic(
  stories: readonly Story[],
  { sprints = [], skipSprintId }: OpenStoryRules = {}
): Map<string, number> {
  const status = new Map(sprints.map((s) => [s.id, s.status]));
  const out = new Map<string, number>();
  for (const s of stories) {
    if (!s.epicId || s.status === "done" || isExampleId(s.id)) continue;
    const sprintStatus = s.sprintId ? status.get(s.sprintId) : undefined;
    if (sprintStatus === "completed" || sprintStatus === "cancelled") continue;
    if (skipSprintId && s.sprintId === skipSprintId) continue;
    out.set(s.epicId, (out.get(s.epicId) ?? 0) + 1);
  }
  return out;
}

/**
 * The features as the cut line reads them: an epic's count is live (0 once
 * the epic is off the roadmap); a typed one is its own.
 */
export function featureRows(
  features: readonly ReleaseFeature[] | undefined,
  stories: readonly Story[],
  epics: readonly Pick<Epic, "id" | "title">[],
  rules: OpenStoryRules = {}
): FeatureRow[] {
  const open = openStoriesByEpic(stories, rules);
  const byId = new Map(epics.map((e) => [e.id, e]));
  return (features ?? []).slice(0, FEATURES_MAX).map((f) => {
    if (f.epicId) {
      const epic = byId.get(f.epicId);
      return {
        id: f.id,
        name: f.name.trim() || epic?.title || "Epic",
        items: epic ? (open.get(f.epicId) ?? 0) : 0,
        epicId: f.epicId,
        epicMissing: !epic,
      };
    }
    return { id: f.id, name: f.name.trim() || "Feature", items: f.items ?? 0, epicMissing: false };
  });
}

export interface FeatureDraft {
  name: string;
  /** Typed, as text. */
  items: string;
  /** "" for a typed count. */
  epicId: string;
}

export const EMPTY_FEATURE_DRAFT: FeatureDraft = { name: "", items: "", epicId: "" };

type FeatureField = "name" | "items";

/**
 * A feature to add: a name (an epic's title when one is picked) and, unless
 * an epic is counted, a whole number of items from 1.
 */
export function validateFeatureDraft(
  draft: FeatureDraft,
  epics: readonly Pick<Epic, "id" | "title">[],
  count: number
): Validation<Omit<ReleaseFeature, "id">, FeatureField> {
  const errors: Partial<Record<FeatureField, string>> = {};
  if (count >= FEATURES_MAX) errors.name = `The cut line holds up to ${FEATURES_MAX} features.`;
  const epic = draft.epicId ? epics.find((e) => e.id === draft.epicId) : undefined;
  const name = draft.name.trim() || epic?.title.trim() || "";
  if (!errors.name && !name) errors.name = "Name the feature, or pick an epic.";
  if (name.length > FEATURE_NAME_MAX) {
    errors.name = `Keep the name to ${FEATURE_NAME_MAX} characters.`;
  }
  let items: number | undefined;
  if (!epic) {
    const n = Number(draft.items.trim());
    if (!draft.items.trim() || !Number.isInteger(n) || n < 1 || n > FEATURE_ITEMS_MAX) {
      errors.items = `Use a whole number of items from 1 to ${FEATURE_ITEMS_MAX}.`;
    } else items = n;
  }
  if (errors.name || errors.items) return { ok: false, errors };
  return {
    ok: true,
    values: epic ? { name, epicId: epic.id } : { name, items: items as number },
  };
}

/** The features moved: `from` swaps with its neighbour in `direction`. */
export function movedFeature(
  features: readonly ReleaseFeature[],
  id: string,
  direction: -1 | 1
): ReleaseFeature[] {
  const list = [...features];
  const at = list.findIndex((f) => f.id === id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= list.length) return list;
  [list[at], list[to]] = [list[to], list[at]];
  return list;
}

/* ── The plan ────────────────────────────────────────────────────────── */

export interface ItemsPlan {
  sample: ThroughputSample;
  itemsSource: ItemsSource;
  items: number | null;
  features: FeatureRow[];
  start: { date: string; from: "user" | "sprint" | "today" };
  target: string | null;
  forecast: ThroughputForecast;
}

export function planItems(input: {
  sample: ThroughputSample;
  itemsSource: ItemsSource;
  items: number | null;
  features: FeatureRow[];
  start: ItemsPlan["start"];
  target: string | null;
}): ItemsPlan {
  return {
    ...input,
    forecast: throughputForecast({
      samples: input.sample.values,
      items: input.items,
      start: input.start.date,
      target: input.target,
      features: input.features.map((f) => ({ id: f.id, name: f.name, items: f.items })),
    }),
  };
}

/** "the last 12 complete weeks on the Sprint board" / "8 typed weeks". */
export function sampleLine(sample: ThroughputSample): string {
  const n = sample.values.length;
  if (sample.source === "typed") return `${plural(n, "typed week")}`;
  return `${plural(n, "complete week")} of the ${THROUGHPUT_SOURCE_LABEL[sample.source]}${
    n >= sample.window ? ` (the last ${sample.window})` : ""
  }`;
}

const pct = (chance: number) => `${Math.round(chance * 100)}%`;

/** The one sentence over the item forecast. */
export function itemsVerdict(plan: ItemsPlan): string {
  const f = plan.forecast;
  if (!f.enough) {
    return f.notEnough === "nothing-finished"
      ? "No item was finished in the weeks used, so there is no pace to forecast from."
      : `Not enough history yet: ${plural(f.weeksUsed, "week")} of throughput, and a forecast needs 4.`;
  }
  const when = f.when;
  if (when) {
    const at85 = when.dates.p85;
    const lead = at85
      ? `${plural(when.items, "item")} are likely done by ${formatDay(at85)} (85% of runs)`
      : `${plural(when.items, "item")} aren't done within ten years in 15% of runs or more`;
    const chance =
      when.chance !== null && plan.target
        ? `; the chance by ${formatDay(plan.target)} is ${pct(when.chance)}`
        : "";
    return `${lead}${chance}.`;
  }
  if (f.howMany) {
    return `By ${formatDay(f.howMany.target)} the team finishes at least ${plural(
      f.howMany.p85,
      "item"
    )} in 85% of runs.`;
  }
  return `The team finishes about ${perWeekText(f.average ?? 0)}. Set the items left or a target date to see a forecast.`;
}

/* ── Markdown ────────────────────────────────────────────────────────── */

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const START_FROM = {
  user: "",
  sprint: " (the day after the active sprint ends)",
  today: " (today)",
};

const dayOr = (d: string | null) => (d ? formatDay(d) : "Not within ten years");

/** The item forecast as Markdown, for a release update. */
export function itemsMarkdown(plan: ItemsPlan, now: Date = new Date()): string {
  const f = plan.forecast;
  const lines = [
    `# Release forecast by items — ${now.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`,
    "",
    `**${itemsVerdict(plan)}**`,
    "",
    "## Inputs",
    "",
    "| Input | Value |",
    "|---|---|",
    `| Items left | ${plan.items === null ? "—" : `${plan.items} (${ITEMS_SOURCE_LABEL[plan.itemsSource].toLowerCase()})`} |`,
    `| Throughput | ${md(sampleLine(plan.sample))}${f.average === null ? "" : `, ${perWeekText(f.average)}`} |`,
    `| Weekly counts | ${plan.sample.values.length ? plan.sample.values.join(", ") : "—"} |`,
    `| Start | ${formatDay(plan.start.date)}${START_FROM[plan.start.from]} |`,
    `| Target date | ${plan.target ? formatDay(plan.target) : "—"} |`,
    "",
  ];
  if (f.when) {
    const w = f.when;
    lines.push(
      `## When ${plural(w.items, "item")} are done (${THROUGHPUT_ITERATIONS.toLocaleString("en-US")} simulated runs)`,
      "",
      "| Confidence | Weeks | Done by |",
      "|---:|---:|---|",
      `| 50% | ${w.weeks.p50 ?? "—"} | ${dayOr(w.dates.p50)} |`,
      `| 85% | ${w.weeks.p85 ?? "—"} | ${dayOr(w.dates.p85)} |`,
      `| 95% | ${w.weeks.p95 ?? "—"} | ${dayOr(w.dates.p95)} |`,
      ""
    );
    if (w.chance !== null && plan.target) {
      lines.push(`Chance of finishing by ${formatDay(plan.target)}: ${pct(w.chance)}.`, "");
    }
  }
  if (f.howMany) {
    const h = f.howMany;
    lines.push(
      `## How many items by ${formatDay(h.target)} (${plural(h.weeks, "week")})`,
      "",
      `- At least ${fmt(h.p50, 0)} items in half the runs (P50)`,
      `- At least ${fmt(h.p85, 0)} items in 85% of runs: the number to promise`,
      `- At least ${fmt(h.p95, 0)} items in 95% of runs`,
      ""
    );
  }
  if (f.cutLine && f.cutLine.rows.length > 0) {
    const cut = f.cutLine;
    lines.push("## Features in order", "");
    if (cut.target && cut.above !== null) {
      lines.push(
        `The cut line at ${formatDay(cut.target)}: ${plural(cut.above, "feature")} likely done by then (85% of runs).`,
        ""
      );
    }
    lines.push(
      "| # | Feature | Items | Likely (P50) | Safe (P85) | By the target |",
      "|---:|---|---:|---|---|---|"
    );
    cut.rows.forEach((r, i) => {
      // A feature with nothing left has no date of its own.
      const p50 = r.items === 0 ? "Nothing left" : dayOr(r.p50Date);
      const p85 = r.items === 0 ? "—" : dayOr(r.p85Date);
      lines.push(
        `| ${i + 1} | ${md(r.name)} | ${r.items} | ${p50} | ${p85} | ${
          r.inByTarget === null ? "—" : r.inByTarget ? "Above the line" : "Below the line"
        } |`
      );
    });
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
