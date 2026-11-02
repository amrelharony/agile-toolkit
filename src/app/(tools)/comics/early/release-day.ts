/** "Out Monday 9 November". UTC, the zone the weekly slot is set in, so server and browser agree. */
export function releaseDayLabel(releaseAt: string): string {
  const day = new Date(releaseAt).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `Out ${day.replace(",", "")}`;
}
