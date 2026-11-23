/**
 * The four shapes a strategy map takes, level by level: an Impact Map (why,
 * who, how, what) and the Strategy Tree's DIBB, Lean Value Tree and Hoshin
 * Kanri. Each level has its name, a one-line hint in our own words, the
 * fields it shows and the ones it asks for (the checks name a missing
 * one; nothing refuses a save over it). Every map has exactly four levels,
 * 0 (its one root) to 3. Pure: the pages, the checks, the AI fallback and
 * Amr's verbs read the same table.
 */

import type { StrategyMapFormat } from "@/lib/stores/workspace-types";

/** A field a level shows beyond its text and detail. */
export type LevelField = "measure" | "owner" | "status" | "persona";

/** A field a level asks for: the checks say when it is missing. */
export type RequiredField = "measure" | "owner";

export interface StrategyLevel {
  /** Stable key: "goal", "actor", "bet". */
  id: string;
  /** "Actor". */
  label: string;
  /** "actors". */
  plural: string;
  hint: string;
  fields: readonly LevelField[];
  required: readonly RequiredField[];
}

export interface StrategyFormat {
  /** "Lean Value Tree". */
  label: string;
  /** One line under the format picker. */
  blurb: string;
  /** Levels 0 to 3. */
  levels: readonly [StrategyLevel, StrategyLevel, StrategyLevel, StrategyLevel];
}

/** The deepest level: a node there holds nothing. */
export const LAST_LEVEL = 3;

/** The Strategy Tree's shapes (the impact map has its own page). */
export const TREE_FORMATS = ["dibb", "lean-value-tree", "hoshin"] as const;
export type TreeFormat = (typeof TREE_FORMATS)[number];

const level = (
  id: string,
  label: string,
  plural: string,
  hint: string,
  fields: readonly LevelField[] = [],
  required: readonly RequiredField[] = []
): StrategyLevel => ({ id, label, plural, hint, fields, required });

export const STRATEGY_FORMATS: Readonly<Record<StrategyMapFormat, StrategyFormat>> = {
  "impact-map": {
    label: "Impact Map",
    blurb: "A goal, the people who can move it, how they would act differently, and what to build.",
    levels: [
      level(
        "goal",
        "Goal",
        "goals",
        "The change the business wants, with a measure and a date.",
        ["measure"],
        ["measure"]
      ),
      level("actor", "Actor", "actors", "Someone whose behaviour can help or block the goal.", [
        "persona",
      ]),
      level(
        "impact",
        "Impact",
        "impacts",
        "How that actor must act differently: start, stop, more or less."
      ),
      level(
        "deliverable",
        "Deliverable",
        "deliverables",
        "Something the team could build or do to cause that impact."
      ),
    ],
  },
  dibb: {
    label: "DIBB",
    blurb: "Data, the insight it gives, the belief you now hold, and the bet you place on it.",
    levels: [
      level(
        "data",
        "Data",
        "data points",
        "Something you saw or measured, and where it came from.",
        ["status"]
      ),
      level("insight", "Insight", "insights", "What the data tells you that you didn't know.", [
        "status",
      ]),
      level("belief", "Belief", "beliefs", "What you now believe and would bet on.", ["status"]),
      level("bet", "Bet", "bets", "What you'll try, small enough to learn from.", [
        "measure",
        "status",
      ]),
    ],
  },
  "lean-value-tree": {
    label: "Lean Value Tree",
    blurb: "A vision, the goals that show progress, the bets that might move them, and the work.",
    levels: [
      level("vision", "Vision", "visions", "Where the product is heading, in one line.", [
        "status",
      ]),
      level(
        "goal",
        "Goal",
        "goals",
        "An outcome that shows you're getting there.",
        ["measure", "status"],
        ["measure"]
      ),
      level(
        "bet",
        "Bet",
        "bets",
        "A guess about what will move the goal.",
        ["measure", "status"],
        ["measure"]
      ),
      level(
        "initiative",
        "Initiative",
        "initiatives",
        "A piece of work that tests or delivers the bet.",
        ["measure", "owner", "status"],
        ["measure"]
      ),
    ],
  },
  hoshin: {
    label: "Hoshin Kanri",
    blurb:
      "A three-to-five-year aim, this year's objectives, where the effort goes, and the targets.",
    levels: [
      level(
        "breakthrough",
        "Breakthrough objective",
        "breakthrough objectives",
        "Where you want to be in three to five years.",
        ["status"]
      ),
      level(
        "annual",
        "Annual objective",
        "annual objectives",
        "What must be true by the end of this year.",
        ["measure", "status"],
        ["measure"]
      ),
      level(
        "priority",
        "Improvement priority",
        "improvement priorities",
        "Where the team puts its effort this year.",
        ["owner", "status"],
        ["owner"]
      ),
      level(
        "target",
        "Target",
        "targets",
        "The number you'll check each month.",
        ["measure", "owner", "status"],
        ["measure", "owner"]
      ),
    ],
  },
};

/** Whether `f` is one of the Strategy Tree's shapes. */
export function isTreeFormat(f: unknown): f is TreeFormat {
  return typeof f === "string" && (TREE_FORMATS as readonly string[]).includes(f);
}

/** A level of a format; levels past 3 (a hand-edited row) read as the last. */
export function levelOf(format: StrategyMapFormat, n: number): StrategyLevel {
  const levels = STRATEGY_FORMATS[format].levels;
  return levels[Math.min(Math.max(0, Math.trunc(n)), LAST_LEVEL)];
}

/** Whether a format's level shows `field`. */
export function levelHas(format: StrategyMapFormat, n: number, field: LevelField): boolean {
  return levelOf(format, n).fields.includes(field);
}

/** A strategy tree's parts carry a status; an impact map's never do. */
export const hasStatus = (format: StrategyMapFormat): boolean => format !== "impact-map";

/* ── Where a level's nodes can go ────────────────────────────────────── */

/** The routes a node may be sent on: by format, the levels that take each. */
const SEND_LEVELS: Readonly<
  Record<StrategyMapFormat, Partial<Record<"hypothesis" | "epic" | "backlog-story", number[]>>>
> = {
  "impact-map": { hypothesis: [2], epic: [3], "backlog-story": [3] },
  dibb: { hypothesis: [3] },
  "lean-value-tree": { hypothesis: [2, 3], epic: [3] },
  hoshin: { epic: [2] },
};

export type StrategySendRoute = "hypothesis" | "epic" | "backlog-story";

/** Whether a node at `n` on a `format` map may be sent on `route`. */
export function levelSends(
  format: StrategyMapFormat,
  n: number,
  route: StrategySendRoute
): boolean {
  return (SEND_LEVELS[format][route] ?? []).includes(n);
}

/**
 * The level of a format's bets: what the checks and the next steps ask to
 * test (a DIBB bet, a Lean Value Tree bet); null for a format with none.
 */
export function betLevel(format: StrategyMapFormat): number | null {
  if (format === "dibb") return 3;
  if (format === "lean-value-tree") return 2;
  return null;
}

/** The status names, as the pages show them. */
export const STATUS_LABEL = {
  proposed: "Proposed",
  agreed: "Agreed",
  questioned: "Has questions",
  dropped: "Dropped",
} as const;
