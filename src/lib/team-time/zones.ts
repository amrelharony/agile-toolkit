/**
 * Time zones, by their IANA names ("Africa/Cairo"): what the browser's (or
 * the server's) Intl knows. Pure and server-safe; the Team Time CRUD and the
 * page check zones with the same rule. The tool may extend it.
 */

/** Whether `zone` is a time zone Intl knows. */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone's canonical spelling, as Intl resolves it (any case in, the
 * IANA name out); null when it isn't a zone Intl knows.
 */
export function canonicalZone(zone: string): string | null {
  if (!isTimeZone(zone)) return null;
  return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
}
