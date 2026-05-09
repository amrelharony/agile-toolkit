import type { DetectionResult, HolidayId, HolidayTheme, HolidayWindow } from "./types";
import { getGregorianHolidays, todayInCairo } from "./calendars/gregorian";
import { getIslamicHolidays } from "./calendars/islamic";
import { getCopticHolidays } from "./calendars/coptic";

/** Priority table — higher wins on overlap. */
export const HOLIDAY_PRIORITY: Record<HolidayId, number> = {
  "eid-fitr": 100,
  "eid-adha": 100,
  "hijri-new-year": 90,
  "jan-25": 80,
  "jun-30": 80,
  "jul-23": 80,
  "sinai-liberation": 80,
  ramadan: 70,
  "coptic-christmas": 60,
  "coptic-easter": 60,
  "sham-el-nessim": 60,
  "mothers-day": 50,
  "new-year": 45,
  mawlid: 40,
  halloween: 40,
  "labour-day": 40,
  "earth-day": 40,
};

function isWithinWindow(iso: string, window: HolidayWindow): boolean {
  return iso >= window.startISO && iso <= window.endISO;
}

/**
 * Returns the top-priority active holiday (if any) plus the list of other
 * active but suppressed ones.  Evaluated against the Africa/Cairo clock.
 *
 * Theme metadata (name, accent, CSS, particles) is loaded lazily by the
 * HolidayEngine — this function only identifies which holiday is active.
 */
export function getActiveHolidayIds(
  date: Date = new Date(),
): { active: { id: HolidayId; window: HolidayWindow } | null; suppressed: Array<{ id: HolidayId; window: HolidayWindow }> } {
  const { y, iso } = todayInCairo(date);

  // Collect candidates from all three calendars
  const all: Array<{ id: HolidayId; window: HolidayWindow }> = [
    ...getGregorianHolidays(y),
    ...getIslamicHolidays(date),
    ...getCopticHolidays(y),
  ];

  // Also check last year / next year edge windows so the detection handles
  // themes whose Gregorian window crosses a year boundary (e.g. late-Dec New
  // Year Eve from last year's table).
  const edge = [
    ...getGregorianHolidays(y - 1),
    ...getGregorianHolidays(y + 1),
    ...getCopticHolidays(y - 1),
    ...getCopticHolidays(y + 1),
  ];

  const active = [...all, ...edge].filter((h) => isWithinWindow(iso, h.window));
  if (active.length === 0) return { active: null, suppressed: [] };

  active.sort((a, b) => HOLIDAY_PRIORITY[b.id] - HOLIDAY_PRIORITY[a.id]);
  return { active: active[0], suppressed: active.slice(1) };
}

export function windowKey(id: HolidayId, window: HolidayWindow): string {
  return `${id}::${window.startISO}`;
}

/**
 * Given a theme module and detection result, assemble the display-ready theme.
 * The module is expected to `export default` a HolidayTheme.
 */
export function assembleTheme(
  theme: HolidayTheme,
  window: HolidayWindow,
): HolidayTheme & { window: HolidayWindow } {
  return { ...theme, window };
}

export type { DetectionResult };
