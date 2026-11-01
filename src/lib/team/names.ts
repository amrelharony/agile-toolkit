/**
 * Matching people across tools by name. Pure and server-safe, so agent
 * actions, next-step rules and shared libs (kudos recognition, consent,
 * skills coverage) use the same rule as the pages; the browser hooks in
 * use-team-roster.ts re-export both.
 */

/** Name key for matching people across tools: trimmed, case-insensitive. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/** The roster member with this name (trimmed, case-insensitive), if any. */
export function findRosterMember<T extends { name: string }>(
  roster: readonly T[],
  name: string | null | undefined
): T | undefined {
  const key = nameKey(name);
  return key ? roster.find((m) => nameKey(m.name) === key) : undefined;
}
