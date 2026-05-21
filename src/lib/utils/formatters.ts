export function formatDuration(totalSeconds: number): string {
  // Guard against NaN, Infinity, and negative input — naive code produced
  // strings like "NaN:NaN:NaN" or "00:00:-1" which leaked into timer UIs.
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatPoints(n: number): string {
  if (!Number.isFinite(n)) return "0 points";
  return n === 1 ? "1 point" : `${n} points`;
}

/**
 * Format a Date or ISO string for display. Accepts plain `YYYY-MM-DD`
 * strings and parses them as local-time (consistent with `todayLocalISO`)
 * so an export like `2026-05-20` doesn't display as "May 19" for users in
 * negative UTC offsets.
 */
export function formatDate(date: Date | string): string {
  let d: Date;
  if (typeof date === "string") {
    // Plain calendar-date strings get local-time interpretation; everything
    // else flows through the standard Date parser (which handles full ISO
    // datetimes, RFC 2822, etc.).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (m) {
      d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }
  if (isNaN(d.getTime())) return typeof date === "string" ? date : "Invalid date";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatPercentage(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(decimals)}%`;
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0 hours";
  // Round first, then choose plural form against the rounded value. The
  // previous order made `formatHours(0.99)` round to 1 and emit
  // "1 hours" because the singular check happened before rounding.
  const rounded = Math.round(hours * 10) / 10;
  if (rounded === 1) return "1 hour";
  const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${display} hours`;
}

/**
 * Today as `YYYY-MM-DD` in the user's *local* timezone. Replaces the
 * `new Date().toISOString().slice(0,10)` pattern, which records UTC and so
 * stamps "tomorrow" for users west of UTC after their local evening.
 */
export function todayLocalISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
