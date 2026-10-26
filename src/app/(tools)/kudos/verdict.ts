import { NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { localDay } from "@/lib/sprints/series";
import {
  fairnessHints,
  listNames,
  type RecipientTally,
  type RecognitionSummary,
} from "@/lib/kudos/recognition";

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

/** One bar or table row: someone who received kudos, or a teammate with none. */
export interface RecognitionRow {
  key: string;
  name: string;
  memberId?: string;
  onRoster: boolean;
  count: number;
  fromPeople: number;
  lastAt: string | null;
}

/** Everyone who received kudos (most first), then the roster's teammates with none. */
export function recognitionRows(summary: RecognitionSummary): RecognitionRow[] {
  const none: RecognitionRow[] = summary.rosterWithNone.map((m) => ({
    key: `member:${m.memberId}`,
    name: m.name,
    memberId: m.memberId,
    onRoster: true,
    count: 0,
    fromPeople: 0,
    lastAt: null,
  }));
  const received = summary.recipients.map((r: RecipientTally): RecognitionRow => ({ ...r }));
  return [...received, ...none];
}

/**
 * The one sentence above the chart: how far recognition reached in the
 * window, and the hint worth acting on. Shares need MIN_SAMPLE.distribution
 * kudos behind them; below that it only counts.
 */
export function recognitionVerdict(
  summary: RecognitionSummary,
  rosterSize: number,
  windowLabel: string
): string {
  const { total, recipients } = summary;
  if (total === 0) return `No kudos ${windowLabel} yet.`;
  if (!summary.enough) {
    return `${total} kudos ${windowLabel}, for ${people(recipients.length)}.`;
  }
  if (rosterSize >= 2) {
    const reached = rosterSize - summary.rosterWithNone.length;
    let sentence =
      reached === rosterSize
        ? `Recognition reached all ${rosterSize} teammates ${windowLabel}`
        : `Recognition reached ${reached} of ${rosterSize} teammates ${windowLabel}`;
    const hints = fairnessHints(summary, rosterSize, { windowLabel });
    const none = hints.find((h) => h.kind === "none-received");
    const concentrated = hints.find((h) => h.kind === "concentrated");
    if (none && none.names.length <= 2) {
      sentence += `; ${listNames(none.names)} ${none.names.length === 1 ? "has" : "have"} none yet`;
    } else if (concentrated) {
      sentence += `; ${recipients[0].name} received ${recipients[0].count} of ${total}`;
    }
    return `${sentence}.`;
  }
  const [top, next] = recipients;
  const lead =
    next && next.count === top.count ? "" : `; ${top.name} received the most (${top.count})`;
  return `${total} kudos ${windowLabel}, for ${people(recipients.length)}${lead}.`;
}

/** How many people the chart summary names before "and N more". */
const SUMMARY_NAMES = 5;

/**
 * The chart's text alternative: who received how many ("Kudos received in
 * Sprint 12: Priya 3, Sam 2 and Omar 0."), and a row per person.
 */
export function recognitionChartText(
  summary: RecognitionSummary,
  rosterSize: number,
  windowLabel: string
): ChartText {
  const rows = recognitionRows(summary);
  const named = rows.slice(0, SUMMARY_NAMES).map((r) => `${r.name} ${r.count}`);
  const more = rows.length - named.length;
  const list =
    more > 0
      ? `${named.join(", ")} and ${more} more`
      : named.length > 1
        ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`
        : (named[0] ?? "");
  return {
    summary:
      rows.length > 0 ? `Kudos received ${windowLabel}: ${list}.` : `No kudos ${windowLabel} yet.`,
    table: {
      columns: ["Person", "Kudos received", "From people", "Last kudos"],
      rows: rows.map((r) => [
        r.onRoster || rosterSize === 0 ? r.name : `${r.name} (not on the team)`,
        r.count,
        r.fromPeople,
        localDay(r.lastAt) ?? NO_VALUE,
      ]),
    },
  };
}
