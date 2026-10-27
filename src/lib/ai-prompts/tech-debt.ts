import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Story, TechDebtItem } from "../stores/workspace-types";
import {
  INTEREST_CAP,
  UNASSIGNED_AREA,
  backlogLinkOf,
  debtScale,
  debtStoryOf,
  debtSummary,
  debtVerdict,
  interestOf,
  isInterestEstimated,
  isOpenDebt,
  rankedDebt,
} from "../tech-debt/model";
import { fmt } from "../charts/chart-text";
import { scoreSum } from "@/app/(tools)/tech-debt/analysis";

/**
 * The debt as the Tech Debt page counts it: the rows its numbers read (the
 * team's own, or the example's while it holds nothing else), the sprint
 * length the ages are counted in, the day they are counted on, and the
 * board's stories (which items are on the backlog).
 */
interface DebtData {
  items: readonly TechDebtItem[];
  /** The ceremony cadence's sprint length (14 when the team hasn't set one). */
  sprintLengthDays: number;
  /** True when that length is the default, not the team's. */
  defaultLength?: boolean;
  /** "YYYY-MM-DD". */
  today: string;
  stories?: readonly Pick<Story, "id" | "status">[];
}

/** The table lists this many items, in the page's order. */
const MAX_ROWS = 20;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "≈ 4 sprints", "under a sprint", or "unknown" with no raised day. */
function ageText(ageSprints: number | null): string {
  if (ageSprints === null) return "unknown (no raised day)";
  return ageSprints === 0 ? "under a sprint" : `≈ ${plural(ageSprints, "sprint")}`;
}

/**
 * The debt prompts with the page's numbers (lib/tech-debt/model): each
 * item's age in sprints of the team's cadence (calendar days ÷ the sprint
 * length), its score impact × 4 − effort + min(INTEREST_CAP, interest ×
 * age), with an interest that isn't estimated named as such (it adds
 * nothing, never a guess), whether it is on the backlog, in the page's
 * order (open first, then the highest score), and the page's verdict.
 */
export function generateTechDebtPrompts(data: DebtData): PromptDefinition[] {
  const { items, sprintLengthDays: len, today } = data;
  if (items.length === 0) return [];
  const s = debtSummary(items, len, today, data.stories);
  const ranked = rankedDebt(items, len, today);
  const table = formatTable(
    [
      "#",
      "Item",
      "Area",
      "Impact",
      "Effort",
      "Interest/sprint",
      "Age",
      "Score",
      "Status",
      "Description",
    ],
    ranked.slice(0, MAX_ROWS).map(({ item: t, ageSprints, score }, i) => {
      // Without the board's stories, any backlog link counts, as debtSummary counts it.
      const story = data.stories
        ? debtStoryOf(t, data.stories)
        : backlogLinkOf(t)
          ? { done: false }
          : null;
      const status = isOpenDebt(t)
        ? `Open${story ? (story.done ? ", its backlog story is done" : ", on the backlog") : ""}`
        : `Paid down ${(t.resolvedAt ?? "").slice(0, 10)}`;
      return [
        i + 1,
        t.title || "(untitled)",
        t.area?.trim() || "—",
        debtScale(t.impact),
        debtScale(t.effort),
        isInterestEstimated(t) ? fmt(interestOf(t)) : "Not estimated",
        ageText(ageSprints),
        `${fmt(score.total)} (${scoreSum(t, score)})`,
        status,
        (t.description ?? "").slice(0, 80) || "—",
      ];
    })
  );
  const more = items.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${items.length} items)` : "";
  const verdict = `Verdict: ${sanitizePromptCell(debtVerdict(items, len, today), 400)}\n\n`;
  // Titles, areas and descriptions are user-typed, and the verdict names a title.
  const body = wrapUserContent(`${verdict}${table}${more}`);

  const basis = data.defaultLength
    ? `${len}-day sprints (the default: the team hasn't set a sprint length)`
    : `${len}-day sprints (the team's cadence)`;
  const interest =
    s.open === 0
      ? ""
      : s.unestimated === s.open
        ? " None of the open debt has an interest estimate."
        : ` Interest on the open debt: about ${fmt(s.interestPerSprint)} score points a sprint${
            s.unestimated > 0 ? ` (${s.unestimated} not estimated)` : ""
          }.`;
  const oldest =
    s.oldestSprints === null ? "" : ` The oldest open item is ${ageText(s.oldestSprints)} old.`;
  const hotspot = s.hotspot
    ? ` Hotspot: ${sanitizePromptCell(s.hotspot.area, 60)} (${s.hotspot.impact} impact points open).`
    : "";
  const unassigned = s.openByArea[UNASSIGNED_AREA] ?? 0;
  const noArea = unassigned > 0 ? ` ${plural(unassigned, "open item")} with no area.` : "";
  const context = `Ages are in ${basis}; score = impact × 4 − effort + min(${INTEREST_CAP}, interest per sprint × age in sprints), with impact and effort 1–5. ${s.open} open, ${s.resolved} paid down, ${s.inBacklog} of the open on the backlog.${interest}${oldest}${hotspot}${noArea}`;

  return [
    {
      id: "debt-paydown",
      title: "Debt Paydown Plan",
      description: "Identify the highest-ROI items to pay down next sprint.",
      prompt:
        buildPreamble("Technical Debt Tracker", context) +
        `## Debt items, in the page's order\n\n${body}\n\n## Questions\n\n1. Which 3 items give the best paydown ROI this sprint?\n2. What allocation (e.g. 15% of capacity) is appropriate given the interest?\n3. Which items need an interest estimate before they can be compared, and which are better left alone (write-offs)?`,
    },
    {
      id: "debt-systemic",
      title: "Systemic Patterns",
      description: "Look for systemic causes behind debt accumulation.",
      prompt:
        buildPreamble(
          "Technical Debt Tracker",
          `${context} Recurring debt areas point to process or architectural issues.`
        ) +
        `## Debt items\n\n${body}\n\n## Questions\n\n1. What clusters do you see by area?\n2. Is the team accumulating debt faster than paying it down?\n3. Recommend 2-3 process changes to slow debt creation.`,
    },
  ];
}
