import type { StatusBadge, WeatherSnapshot } from "./types";

const TIMEZONE = "Africa/Cairo";

interface CairoClock {
  hour: number;
  /** 0 = Sunday, 1 = Monday, ... 6 = Saturday (JS Date convention). */
  day: number;
  /** 0..59 minutes. */
  minute: number;
}

function cairoClock(now: Date = new Date()): CairoClock {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  // Some Chrome versions historically rendered midnight as "24:00" for
  // hour12: false; normalise with `% 24` so boundary buckets behave correctly.
  const hour = (Number(parts.find((p) => p.type === "hour")?.value ?? 0) || 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0) || 0;
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const day = dayMap[weekdayName] ?? 1;
  return { hour, day, minute };
}

/**
 * Compute the status badge shown next to the brand in the header.  The rules
 * below are driven by Cairo time:
 *   • Fri/Sat       → "WEEKEND MODE"
 *   • Sun           → "SPRINT RETRO"  (Egypt work week starts Sunday)
 *   • Mon-Thu 9-17  → "BUILDING FINTECH"
 *   • Mon-Thu 17-22 → "DEEP WORK"
 *   • Mon-Thu 22-6  → "NIGHT CYCLES"
 *   • Mon-Thu 6-9   → "MORNING STAND-UP"
 *
 * If a weather snapshot is available, thunderstorms bump the badge to
 * "STORM FRONT" as an easter egg regardless of time of day.
 */
export function computeStatusBadge(
  now: Date = new Date(),
  weather?: WeatherSnapshot | null,
): StatusBadge {
  const { hour, day } = cairoClock(now);

  // Weather easter eggs win first — storms and extreme heat are conversation-starters
  if (weather) {
    if (weather.code >= 95) {
      return {
        text: "STORM FRONT",
        color: "#a855f7",
        live: true,
        description: `Thunderstorm in Cairo (${Math.round(weather.temperatureC)}°C) — inspiration weather.`,
      };
    }
    if (weather.temperatureC >= 38) {
      return {
        text: "HEAT WAVE",
        color: "#ef4444",
        live: true,
        description: `It's ${Math.round(weather.temperatureC)}°C in Cairo — the author is in survival mode.`,
      };
    }
  }

  // Weekend — Friday & Saturday in Egypt
  if (day === 5 || day === 6) {
    return {
      text: "WEEKEND MODE",
      color: "#a78bfa",
      live: false,
      description: "Off the clock in Cairo — replies may be slower.",
    };
  }

  // Sunday — start of the Egyptian work week
  if (day === 0) {
    return {
      text: "SPRINT RETRO",
      color: "#f472b6",
      live: true,
      description: "Sunday — new sprint kicking off in Cairo.",
    };
  }

  // Weekday hour buckets
  if (hour >= 9 && hour < 17) {
    return {
      text: "BUILDING FINTECH",
      color: "#00e1ff",
      live: true,
      description: "Business hours in Cairo — heads-down on product work.",
    };
  }
  if (hour >= 17 && hour < 22) {
    return {
      text: "DEEP WORK",
      color: "#10b981",
      live: true,
      description: "Evening focus block in Cairo.",
    };
  }
  if (hour >= 6 && hour < 9) {
    return {
      text: "MORNING STAND-UP",
      color: "#fbbf24",
      live: true,
      description: "Morning in Cairo — coffee in one hand, Jira in the other.",
    };
  }
  return {
    text: "NIGHT CYCLES",
    color: "#6366f1",
    live: false,
    description: "Late-night hours in Cairo — reply latency may spike.",
  };
}

/** Return how many minutes until the badge should recompute (next boundary). */
export function minutesUntilNextBoundary(now: Date = new Date()): number {
  const { hour, minute } = cairoClock(now);
  const boundaries = [6, 9, 17, 22];
  // Any crossover inside today changes the badge
  for (const b of boundaries) {
    if (hour < b) return (b - hour) * 60 - minute;
  }
  // Next boundary is 6am the next day
  return (24 - hour) * 60 - minute + 6 * 60;
}
