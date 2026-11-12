/**
 * The quota headers (VISITOR_HEADERS) for one meter answer, shared by the two
 * routes that meter visitors: Amr's chat (/api/agent/visitor) and the tools'
 * Ask Amr buttons (/api/ai/tool/visitor). Both count against the same daily
 * allowance, so the chat panel's count stays right whichever was used last.
 */

import { VISITOR_HEADERS } from "./contract";
import type { MeterResult } from "./meter";

/** The quota headers for one meter answer. */
export function quotaHeaders(m: MeterResult): Record<string, string> {
  const headers: Record<string, string> = {
    [VISITOR_HEADERS.remaining]: String(Math.max(0, m.turnsMax - m.turnsUsed)),
    [VISITOR_HEADERS.limit]: String(m.turnsMax),
    [VISITOR_HEADERS.peak]: m.peak ? "1" : "0",
    [VISITOR_HEADERS.peakLimit]: String(m.peakTurnsMax),
  };
  if (m.peak) {
    headers[VISITOR_HEADERS.peakRemaining] = String(Math.max(0, m.peakTurnsMax - m.peakTurnsUsed));
    if (m.peakEndsAt) headers[VISITOR_HEADERS.peakEnds] = m.peakEndsAt;
  }
  return headers;
}
