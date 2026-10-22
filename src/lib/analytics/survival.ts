export interface SurvivalObservation {
  duration: number;
  event: boolean;
}

export interface SurvivalCurvePoint {
  t: number;
  survival: number;
  atRisk: number;
  events: number;
}

export function kaplanMeier(observations: SurvivalObservation[]): SurvivalCurvePoint[] {
  if (observations.length === 0) return [];
  const sorted = observations.slice().sort((a, b) => a.duration - b.duration);
  const distinctTimes = Array.from(
    new Set(sorted.filter((o) => o.event).map((o) => o.duration))
  ).sort((a, b) => a - b);

  const points: SurvivalCurvePoint[] = [{ t: 0, survival: 1, atRisk: sorted.length, events: 0 }];
  let survival = 1;
  let atRisk = sorted.length;
  let idx = 0;

  for (const t of distinctTimes) {
    // Drop observations whose duration is strictly before t (already exited risk set).
    while (idx < sorted.length && sorted[idx].duration < t) {
      atRisk--;
      idx++;
    }
    // Count events and censored observations exactly at t. Iterate from idx so
    // this is O(n) total across the loop instead of O(n²) per distinct time.
    let events = 0;
    let censored = 0;
    let consumed = 0;
    while (idx + consumed < sorted.length && sorted[idx + consumed].duration === t) {
      if (sorted[idx + consumed].event) events++;
      else censored++;
      consumed++;
    }
    if (atRisk > 0) survival *= (atRisk - events) / atRisk;
    points.push({ t, survival, atRisk, events });
    // Now mark these observations as having exited the risk set; idx advances
    // past them so the next distinct-time iteration's `< t` loop won't double-decrement.
    atRisk -= events + censored;
    idx += consumed;
  }

  return points;
}

export function medianSurvivalTime(curve: SurvivalCurvePoint[]): number | null {
  for (const p of curve) {
    if (p.survival <= 0.5) return p.t;
  }
  return null;
}

export function survivalAt(curve: SurvivalCurvePoint[], t: number): number {
  let last = 1;
  for (const p of curve) {
    if (p.t <= t) last = p.survival;
    else break;
  }
  return last;
}

export function durationsFromTimeRanges(
  items: {
    raisedAt: string;
    resolvedAt?: string;
    /**
     * BUG-T7-risk-register-3: when present, the "event" flag is derived
     * from `status === "closed"` rather than just `Boolean(resolvedAt)`.
     * Reopened risks may still carry `resolvedAt` (preserved as the
     * historical close timestamp) but should be censored as still-open
     * observations in K-M analysis, not counted as closed events.
     */
    status?: string;
  }[],
  now: Date = new Date()
): SurvivalObservation[] {
  return (
    items
      .map((item) => {
        const start = new Date(item.raisedAt).getTime();
        // If status is provided, only treat the item as a "closed event"
        // when status is explicitly closed. Otherwise fall back to the
        // legacy `resolvedAt` heuristic.
        const event =
          item.status !== undefined ? item.status === "closed" : Boolean(item.resolvedAt);
        // A still-open item is censored at `now`, not at a preserved
        // `resolvedAt` from before it was reopened.
        const end = event && item.resolvedAt ? new Date(item.resolvedAt).getTime() : now.getTime();
        const rawDays = (end - start) / (1000 * 60 * 60 * 24);
        return { duration: Math.round(rawDays), event, rawDays };
      })
      // Drop observations where end is strictly before start — clamping to 0
      // would silently fold negative durations into the at-risk set at t=0,
      // which biases survival calculations. Better to exclude bad data.
      .filter((o) => Number.isFinite(o.duration) && o.rawDays >= 0)
      .map(({ duration, event }) => ({ duration, event }))
  );
}
