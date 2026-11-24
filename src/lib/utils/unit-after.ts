/**
 * How a free-text unit reads after a number. Only the metric tools (Product
 * Metrics, EBM and Improve, through the hypotheses and improve models) use
 * it, so it lives apart from lib/utils/formatters, which home and every page
 * load: there, its word list rode on every first load.
 */

/** Plural units people type, and how each reads after a 1 ("1 day", "up 1 team"). */
const SINGULAR_UNIT: Readonly<Record<string, string>> = {
  bugs: "bug",
  customers: "customer",
  days: "day",
  deploys: "deploy",
  hours: "hour",
  items: "item",
  minutes: "minute",
  months: "month",
  needs: "need",
  orders: "order",
  people: "person",
  points: "point",
  releases: "release",
  sessions: "session",
  "sign-ups": "sign-up",
  stories: "story",
  teams: "team",
  tests: "test",
  tickets: "ticket",
  users: "user",
  weeks: "week",
  years: "year",
};

/**
 * A free-text unit as it reads after `value`: the singular of a common
 * plural when the value is exactly 1 ("1 day", not "1 days"); any other
 * unit, or any other value, as typed.
 */
export function unitAfter(value: number, unit: string): string {
  if (Math.abs(value) !== 1) return unit;
  return SINGULAR_UNIT[unit] ?? unit;
}
