/**
 * Health Dashboard — cycle-time localStorage extractor.
 *
 * The velocity / health-check / impediments / standup cards now read the SYNCED
 * workspace entities (see ./synced-kpis.ts) so they reflect agent + cross-device
 * writes. Cycle-time is the lone exception: it has no synced entity (Story
 * carries no start/end timestamps) and no agent write path, so it still reads
 * the Cycle Time Analyzer's own per-device zustand blob.
 */

function readStore<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // zustand persist wraps state in { state: {...}, version: N }
    const result = parsed?.state ?? parsed;
    // If `parsed.state` is null (legit zustand-persist shape on first write, or
    // a bad blob), the cast would lie and every downstream `data.foo` crashes.
    // Return null instead so callers get the obvious "no data yet" branch.
    if (result === null || typeof result !== "object") return null;
    return result as T;
  } catch {
    return null;
  }
}

interface WorkItem {
  id: string;
  startDate: string;
  endDate: string;
}

export function extractCycleTimeKPIs(): { p85: number | null } {
  const data = readStore<{ items: WorkItem[] }>("agile-toolkit:cycle-time");
  if (!data?.items?.length) return { p85: null };

  const cycleTimes: number[] = data.items
    .map((item) => {
      if (!item.startDate || !item.endDate) return null;
      const s = new Date(item.startDate).getTime();
      const e = new Date(item.endDate).getTime();
      // Number.isFinite excludes both NaN and ±Infinity (the latter can appear
      // when a hand-edited payload contains a stringified `Infinity`).
      if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
      return Math.round((e - s) / (1000 * 60 * 60 * 24));
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  if (cycleTimes.length === 0) return { p85: null };

  const idx = Math.ceil((cycleTimes.length * 85) / 100) - 1;
  const p85 = cycleTimes[Math.max(0, Math.min(idx, cycleTimes.length - 1))];

  return { p85 };
}
