/**
 * The browser's side of /api/comics/taps: send one answer, or read the totals
 * back. Either gives null on any failure: the story reads the same without
 * them, so a reader never sees an error for a count.
 */

import type { TapKind } from "./guess";

export interface TapResult {
  counts: number[];
  /** Whole percentages, or null while too few readers have answered. */
  shares: number[] | null;
}

const isCounts = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0);

function toResult(body: unknown, size: number): TapResult | null {
  const b = body as { counts?: unknown; shares?: unknown } | null;
  if (!b || !isCounts(b.counts) || b.counts.length !== size) return null;
  const shares = isCounts(b.shares) && b.shares.length === size ? b.shares : null;
  return { counts: b.counts, shares };
}

async function settle(request: Promise<Response>, size: number): Promise<TapResult | null> {
  try {
    const res = await request;
    if (!res.ok) return null;
    return toResult(await res.json(), size);
  } catch {
    return null;
  }
}

export function sendTap(
  ep: number,
  kind: TapKind,
  choice: number,
  size: number
): Promise<TapResult | null> {
  return settle(
    fetch("/api/comics/taps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ep, kind, choice }),
    }),
    size
  );
}

export function readTaps(ep: number, kind: TapKind, size: number): Promise<TapResult | null> {
  return settle(fetch(`/api/comics/taps?ep=${ep}&kind=${kind}`), size);
}
