/**
 * The comparison in one sentence: how the newest compared sprint moved
 * against the one before it, or, with one sprint, its strongest and weakest
 * dimension. From the same scores as the radar.
 */

import { DIMENSIONS, type CompareRow, type Dimension } from "./view";

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`);

type Scored = { dim: Dimension; value: number };

function scored(row: Pick<CompareRow, "scores">): Scored[] {
  return DIMENSIONS.flatMap((dim) => {
    const v = row.scores[dim].value;
    return v === null ? [] : [{ dim, value: v }];
  });
}

/** `rows` oldest first, as the comparison shows them. */
export function compareVerdict(rows: readonly Pick<CompareRow, "name" | "scores">[]): string {
  const withScores = rows.filter((r) => scored(r).length > 0);
  if (rows.length === 0) return "Pin a sprint to compare it.";
  if (withScores.length === 0) {
    return "Nothing scored yet: close a sprint with its points, or answer whether it met its goal, and its scores appear here.";
  }
  if (withScores.length === 1) {
    const [only] = withScores;
    const list = scored(only).sort((a, b) => b.value - a.value);
    const best = list[0];
    const worst = list[list.length - 1];
    if (list.length === 1 || best.value === worst.value) {
      return `${only.name} scores ${fmt(best.value)} on ${list.length === 1 ? best.dim : "every scored dimension"}.`;
    }
    return `${only.name} is strongest on ${best.dim} (${fmt(best.value)}) and weakest on ${worst.dim} (${fmt(worst.value)}).`;
  }

  const [prev, last] = withScores.slice(-2);
  const before = new Map(scored(prev).map((s) => [s.dim, s.value]));
  const moves = scored(last).flatMap((s) => {
    const was = before.get(s.dim);
    return was === undefined ? [] : [{ dim: s.dim, delta: Math.round((s.value - was) * 10) / 10 }];
  });
  if (moves.length === 0) {
    return `${last.name} and ${prev.name} have no dimension scored in both yet.`;
  }
  const up = [...moves].sort((a, b) => b.delta - a.delta)[0];
  const down = [...moves].sort((a, b) => a.delta - b.delta)[0];
  const parts: string[] = [];
  if (up.delta > 0) parts.push(`improved most on ${up.dim} (${signed(up.delta)})`);
  if (down.delta < 0) parts.push(`slipped most on ${down.dim} (${signed(down.delta)})`);
  if (parts.length === 0)
    return `${last.name} scored the same as ${prev.name} on every shared dimension.`;
  return `Against ${prev.name}, ${last.name} ${parts.join(" and ")}.`;
}

/** The newest compared sprint's lowest score, for "Take it to the retro". */
export function weakestDimension(
  rows: readonly Pick<CompareRow, "name" | "scores">[]
): { sprint: string; dim: Dimension; value: number } | null {
  const last = [...rows].reverse().find((r) => scored(r).length > 0);
  if (!last) return null;
  const [lowest] = scored(last).sort((a, b) => a.value - b.value);
  return { sprint: last.name, ...lowest };
}
