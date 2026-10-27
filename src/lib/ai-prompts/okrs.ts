import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { KeyResult, Okr } from "../stores/workspace-types";
import {
  CONFIDENCE_BAND_LABEL,
  confidenceBand,
  daysSinceCheckIn,
  isConfidence,
  krBaseline,
  krDirection,
  krPercent,
  lastCheckIn,
  objectivePercent,
  okrVerdict,
} from "@/lib/okrs/progress";
import { fmt } from "@/lib/charts/chart-text";
import { todayLocalISO } from "@/lib/utils/formatters";
import { quarterKey } from "@/app/(tools)/okrs/view";

/**
 * The objectives as the OKR page shows them: the ones in the quarter on
 * screen, the page's verdict over them, and the day they are read on
 * (each objective's pace through its quarter, the days since a check-in).
 */
interface OkrsData {
  okrs: readonly Okr[];
  verdict?: string;
  now?: Date;
}

/** The table lists this many key results. */
const MAX_ROWS = 40;

/** "18%" or "40 sign-ups": a key result's number with its unit. */
function withUnit(kr: KeyResult, n: number): string {
  const unit = kr.unit?.trim() ?? "";
  if (unit === "%") return `${fmt(n, 4)}%`;
  return unit ? `${fmt(n, 4)} ${unit}` : fmt(n, 4);
}

/** "from 22% down to 15%", "from 0 up to 60", or "up to 60 (no baseline)" for a row from before baselines. */
function spanText(kr: KeyResult): string {
  const way = krDirection(kr) === "decrease" ? "down" : "up";
  const base = krBaseline(kr);
  const target = withUnit(kr, kr.target);
  return base === null
    ? `${way} to ${target} (no baseline)`
    : `from ${withUnit(kr, base)} ${way} to ${target}`;
}

/** "6/10 (At risk)", or "Not scored" while it is unset: never read as 0 or 5. */
function confidenceText(kr: KeyResult): string {
  if (!isConfidence(kr.confidence)) return "Not scored";
  const band = confidenceBand(kr.confidence);
  return `${fmt(kr.confidence)}/10${band ? ` (${CONFIDENCE_BAND_LABEL[band]})` : ""}`;
}

/** "2026-10-03 (24 days ago)", or "None yet". */
function checkInText(kr: KeyResult, today: string): string {
  const last = lastCheckIn(kr);
  if (!last) return "None yet";
  const days = daysSinceCheckIn(kr, today);
  const ago =
    days === null ? "" : days === 0 ? " (today)" : ` (${days} ${days === 1 ? "day" : "days"} ago)`;
  return `${last.date}${ago}`;
}

/**
 * The OKR prompts over the objectives on the page, with the page's numbers
 * (lib/okrs/progress, the one formula): each key result's start → target
 * and which way it should move, its value now, its progress from the
 * baseline, its confidence on the 0–10 scale ("Not scored" while unset)
 * and its last check-in; each objective's owner, progress and verdict.
 */
export function generateOkrsPrompts(data: OkrsData): PromptDefinition[] {
  const { okrs } = data;
  if (okrs.length === 0) return [];
  const now = data.now ?? new Date();
  const today = todayLocalISO(now);

  const rows: (string | number)[][] = [];
  for (const o of okrs) {
    for (const kr of o.keyResults ?? []) {
      rows.push([
        quarterKey(o.quarter),
        o.objective.slice(0, 60) || "Untitled objective",
        kr.title.slice(0, 60) || "Untitled key result",
        spanText(kr),
        withUnit(kr, kr.current),
        `${krPercent(kr)}%`,
        confidenceText(kr),
        checkInText(kr, today),
        (kr.description ?? "—").slice(0, 80) || "—",
      ]);
    }
  }
  const table =
    rows.length === 0
      ? "No key results yet."
      : formatTable(
          [
            "Quarter",
            "Objective",
            "Key result",
            "Start → target",
            "Now",
            "Progress",
            "Confidence (0–10)",
            "Last check-in",
            "Notes",
          ],
          rows.slice(0, MAX_ROWS)
        );
  const more =
    rows.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${rows.length} key results)` : "";

  const objectives = okrs
    .map((o) => {
      const name = sanitizePromptCell(o.objective, 120) || "Untitled objective";
      const owner = o.owner?.trim() ? `, owner ${sanitizePromptCell(o.owner, 60)}` : "";
      const reading =
        (o.keyResults ?? []).length > 0 ? `${objectivePercent(o)}%` : "not measured yet";
      const description = o.description?.trim()
        ? ` About it: ${sanitizePromptCell(o.description, 200)}`
        : "";
      return `- “${name}” (${quarterKey(o.quarter)}${owner}), ${reading}: ${okrVerdict(o, now)}${description}`;
    })
    .join("\n");
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";
  // Objectives, key results, owners and notes are user-typed.
  const body = wrapUserContent(
    `${verdict}## Objectives\n\n${objectives}\n\n## Key results\n\n${table}${more}`
  );
  const context =
    "Objectives are qualitative goals; Key Results are measurable outcomes. Progress runs from a key result's baseline to its target, up or down (a key result can be meant to fall); confidence is the team's 0–10 score (3 or less off track, 4–6 at risk, 7 or more on track), and an unscored one says so.";

  return [
    {
      id: "okr-health",
      title: "OKR Health Check",
      description: "Evaluate whether your OKRs are ambitious, measurable, and on track.",
      prompt:
        buildPreamble("OKR Tracker", context) +
        `${body}\n\n## Questions\n\n1. Are these objectives genuinely ambitious (stretch) or too easy?\n2. Are the Key Results measurable and outcome-based (not activities)? Is each one's baseline and direction right?\n3. Where is confidence low, or not scored, and why? Which key results haven't been checked in on lately?\n4. Which OKRs likely need mid-quarter reset?`,
    },
    {
      id: "okr-focus",
      title: "OKR Focus & Alignment",
      description: "Surface conflicts and prioritize focus.",
      prompt:
        buildPreamble("OKR Tracker", `${context} Teams with too many objectives have none.`) +
        `${body}\n\n## Questions\n\n1. Are there too many objectives for the team to meaningfully invest in?\n2. Which KRs conflict or compete for the same capacity?\n3. Recommend the top 3 focus OKRs for this quarter.`,
    },
  ];
}
