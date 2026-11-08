/**
 * The browser's side of /api/comics/stats. `beaconStats` hands events to the
 * browser to deliver even as the page closes, and reads no answer; `sendStats`
 * waits for the story's fresh totals (the heart's count). Both swallow every
 * failure: a story reads the same without its counts, so a reader never sees an
 * error for one.
 */

import { readStatsAnswer, type StatEvent, type StatsAnswer } from "./stats";

const ENDPOINT = "/api/comics/stats";

const bodyOf = (ep: number, events: readonly StatEvent[]) => JSON.stringify({ ep, events });

/** Send without waiting. Returns whether the browser took it. */
export function beaconStats(ep: number, events: readonly StatEvent[]): boolean {
  if (events.length === 0) return false;
  const body = bodyOf(ep, events);
  try {
    if (typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Send and read the story's net loves and readers back, or null. */
export async function sendStats(
  ep: number,
  events: readonly StatEvent[]
): Promise<StatsAnswer | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyOf(ep, events),
    });
    if (res.status !== 200) return null;
    return readStatsAnswer(await res.json());
  } catch {
    return null;
  }
}
