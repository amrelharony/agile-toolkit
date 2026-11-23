/**
 * A round's due day as people read it: "Fri 28 Nov", with the year when it
 * isn't this year ("Tue 5 Jan 2027"), so a round due next year never reads
 * as this month. The host's card and the estimator's page both use it.
 */
export function dueDayLabel(day: string, now: Date = new Date()): string {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}
