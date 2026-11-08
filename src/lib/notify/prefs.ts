/**
 * Notification preferences: their shape, defaults, persisted-payload
 * migration and the pure time checks built on them.
 *
 * Kept free of React and of the zustand store (`lib/stores/
 * notification-prefs-store.ts`, a "use client" module) so the quiet-state
 * logic and server-side code can import it.
 */

/**
 * How celebrations reach the user.
 * - `quiet`: Activity inbox only.
 * - `balanced`: inbox, plus a short moment with Amr for rare items.
 * - `lively`: a moment for every unlock, at least 2 minutes apart.
 */
export type CelebrationLevel = "quiet" | "balanced" | "lively";

export const CELEBRATION_LEVELS: readonly CelebrationLevel[] = ["quiet", "balanced", "lively"];

/**
 * `celebrationLevel` as stored: normally a `CelebrationLevel`, but a newer
 * build may have saved one this build doesn't know (say "off"). It is kept
 * as-is so a rollback doesn't overwrite it; read it through
 * `effectiveCelebrationLevel`.
 */
export type StoredCelebrationLevel = CelebrationLevel | string;

export interface QuietHours {
  enabled: boolean;
  /**
   * Local time "HH:MM" quiet hours start. A string this build can't parse
   * (a newer build's format) is kept; checks go through `effectiveQuietHours`.
   */
  start: string;
  /** Local time "HH:MM" quiet hours end. Before `start` means overnight. */
  end: string;
}

export interface NotificationPrefs {
  celebrationLevel: StoredCelebrationLevel;
  /** Off hides XP and badges and pauses awarding them; totals are kept. */
  gamificationEnabled: boolean;
  /** Show the XP bar on larger screens. */
  showXpBar: boolean;
  /** Show "Copied" / "Exported" as pop-ups instead of inline. */
  confirmationsAsToasts: boolean;
  /** Focus ends at this epoch ms. `null` = off; FOCUS_UNTIL_OFF = until turned off. */
  focusUntil: number | null;
  quietHours: QuietHours;
  /** "Pause celebrations" ends at this epoch ms; `null` = not paused. */
  celebrationsPausedUntil: number | null;
  /** Toast keys the user dismissed often enough to stop seeing them. */
  mutedKeys: string[];
  /** The legacy gamification silent mode has been mapped to `celebrationLevel`. */
  silentModeAdopted: boolean;
}

/** Persisted schema version of `agile-toolkit:notification-prefs`. */
export const NOTIFICATION_PREFS_VERSION = 1;

/** `focusUntil` value for Focus that lasts until the user turns it off. */
export const FOCUS_UNTIL_OFF = Number.MAX_SAFE_INTEGER;

/** Learned muting keeps at most this many keys (oldest go first). */
export const MUTED_KEYS_CAP = 100;

export const DEFAULT_CELEBRATION_LEVEL: CelebrationLevel = "balanced";

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, start: "22:00", end: "08:00" };

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  celebrationLevel: DEFAULT_CELEBRATION_LEVEL,
  gamificationEnabled: true,
  showXpBar: true,
  confirmationsAsToasts: false,
  focusUntil: null,
  quietHours: DEFAULT_QUIET_HOURS,
  celebrationsPausedUntil: null,
  mutedKeys: [],
  silentModeAdopted: false,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a 24-hour "HH:MM" string. */
export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/** Minutes since midnight for "HH:MM", or null when malformed. */
export function parseTime(value: string): number | null {
  const m = TIME_RE.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function timestampOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Last `MUTED_KEYS_CAP` distinct non-empty string keys, order kept. */
export function capMutedKeys(keys: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const k of keys) {
    if (typeof k !== "string" || !k) continue;
    seen.delete(k); // re-adding moves it to the newest end
    seen.add(k);
  }
  return Array.from(seen).slice(-MUTED_KEYS_CAP);
}

/** The stored level when this build knows it, else the default. */
export function effectiveCelebrationLevel(
  prefs: Pick<NotificationPrefs, "celebrationLevel">
): CelebrationLevel {
  return CELEBRATION_LEVELS.includes(prefs.celebrationLevel as CelebrationLevel)
    ? (prefs.celebrationLevel as CelebrationLevel)
    : DEFAULT_CELEBRATION_LEVEL;
}

/** Quiet hours with any time this build can't parse replaced by its default. */
export function effectiveQuietHours(quietHours: QuietHours): QuietHours {
  return {
    ...quietHours,
    start: isValidTime(quietHours.start) ? quietHours.start : DEFAULT_QUIET_HOURS.start,
    end: isValidTime(quietHours.end) ? quietHours.end : DEFAULT_QUIET_HOURS.end,
  };
}

/**
 * Bring any stored payload to the current shape.
 *
 * Idempotent and tolerant: unknown fields are kept, and a known field only
 * falls back to its default when its JSON type is wrong. A value of the
 * right type that this build doesn't understand (a newer build's
 * `celebrationLevel` or time format) is kept too: zustand writes the result
 * straight back, so normalising it here would lose it for good on a
 * rollback. Readers normalise instead (`effectiveCelebrationLevel`,
 * `effectiveQuietHours`). A non-object payload yields the defaults. It
 * never trusts the version, because a rolled-back build re-stamps payloads
 * it writes.
 */
export function migrateNotificationPrefs(persisted: unknown): NotificationPrefs {
  if (!isPlainObject(persisted)) return { ...DEFAULT_NOTIFICATION_PREFS };
  const p = persisted;
  const d = DEFAULT_NOTIFICATION_PREFS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const qh = isPlainObject(p.quietHours) ? p.quietHours : {};
  return {
    ...p,
    celebrationLevel:
      typeof p.celebrationLevel === "string" && p.celebrationLevel
        ? p.celebrationLevel
        : d.celebrationLevel,
    gamificationEnabled: bool(p.gamificationEnabled, d.gamificationEnabled),
    showXpBar: bool(p.showXpBar, d.showXpBar),
    confirmationsAsToasts: bool(p.confirmationsAsToasts, d.confirmationsAsToasts),
    focusUntil: timestampOrNull(p.focusUntil),
    quietHours: {
      ...qh,
      enabled: bool(qh.enabled, d.quietHours.enabled),
      start: typeof qh.start === "string" ? qh.start : d.quietHours.start,
      end: typeof qh.end === "string" ? qh.end : d.quietHours.end,
    },
    celebrationsPausedUntil: timestampOrNull(p.celebrationsPausedUntil),
    mutedKeys: Array.isArray(p.mutedKeys) ? capMutedKeys(p.mutedKeys) : [],
    silentModeAdopted: bool(p.silentModeAdopted, d.silentModeAdopted),
  };
}

/** Focus is on at `now` (epoch ms). */
export function isFocusActive(prefs: Pick<NotificationPrefs, "focusUntil">, now: number): boolean {
  return prefs.focusUntil !== null && now < prefs.focusUntil;
}

/** "Pause celebrations" is on at `now` (epoch ms). */
export function areCelebrationsPaused(
  prefs: Pick<NotificationPrefs, "celebrationsPausedUntil">,
  now: number
): boolean {
  return prefs.celebrationsPausedUntil !== null && now < prefs.celebrationsPausedUntil;
}

/**
 * Whether `now` falls inside the quiet hours, in local time. The start
 * minute is inside, the end minute is not. A range whose end is before its
 * start wraps past midnight (22:00–08:00). Equal start and end is empty.
 * A time this build can't parse counts as its default.
 */
export function isWithinQuietHours(quietHours: QuietHours, now: Date): boolean {
  if (!quietHours.enabled) return false;
  const effective = effectiveQuietHours(quietHours);
  const start = parseTime(effective.start);
  const end = parseTime(effective.end);
  if (start === null || end === null || start === end) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
