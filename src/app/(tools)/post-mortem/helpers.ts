/**
 * Blameless Post-Mortem — local-date helpers. All parse YYYY-MM-DD as a *local*
 * date so incidents on quarter/day boundaries don't drift into the wrong bucket
 * via UTC. No React.
 */

import type { ActionItem } from "./types";

export function todayIso(): string {
  // Use LOCAL date components instead of toISOString().slice(0, 10).
  // After ~16:00 local in west-of-UTC zones, toISOString returns
  // tomorrow's date — defaulting a new incident's date to a future
  // day and bumping it into the wrong quarter at quarter boundaries.
  // Every other ceremony tool uses todayLocalISO(); we now match.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isThisQuarter(iso: string): boolean {
  // Parse YYYY-MM-DD as a *local* date so an incident on the first or last
  // day of a quarter doesn't get bumped into the wrong bucket by UTC drift.
  const d = parseLocalDate(iso);
  if (!d) return false;
  const now = new Date();
  const q = (m: number) => Math.floor(m / 3);
  return d.getFullYear() === now.getFullYear() && q(d.getMonth()) === q(now.getMonth());
}

export function isOverdue(a: ActionItem): boolean {
  if (a.status === "done" || !a.dueDate) return false;
  // `new Date("YYYY-MM-DD")` parses as UTC midnight, so in west-of-UTC
  // zones a due-today action would flip to "overdue" at the *previous*
  // local midnight (a full local-day early). Compare ISO-day strings
  // lexicographically against today's local ISO day instead — same
  // approach `one-on-one-client.tsx:291-301` uses for its overdue check.
  const today = todayIso();
  return a.dueDate < today;
}
