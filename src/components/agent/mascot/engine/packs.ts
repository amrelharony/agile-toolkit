/**
 * Loads Amr's lazy packs (mascot-packs.ts) the first time a clip needs one, or
 * ahead of time when the page is idle. Sharp screens get the 2x cells; each pack
 * is fetched once. A pack that fails to load leaves its clips showing the
 * live-sheet pose that stands in for them; the next time one is asked for, at
 * least RETRY_MS later, it is fetched again, up to MAX_TRIES in all.
 */

import { PACKS, PACK_COLUMNS, type PackId } from "../mascot-packs";

/** Use the 2x cells when the 1x ones would be blown up by more than this. */
const SHARP_ABOVE = 1.25;
/** How long a loaded pack waits for decode() before it counts as ready anyway. */
export const DECODE_WAIT_MS = 1000;
/** A pack that failed may be fetched again this long after, when it's next asked for. */
export const RETRY_MS = 30_000;
/** Fetches of one pack in all, the first included. */
export const MAX_TRIES = 3;

export interface PackLoader {
  /** Start loading these packs (no-op for ones loading, loaded or failed). */
  ensure(packs: readonly PackId[]): void;
  isReady(pack: PackId): boolean;
  /** The URL to paint a pack's cells from. */
  url(pack: PackId): string;
  /** How many rows of cells the pack has. */
  rows(pack: PackId): number;
  dispose(): void;
}

/** Whether a figure `width` css px wide (on a 192-px cell) wants the 2x cells. */
export function wantsSharp(width: number, devicePixelRatio: number): boolean {
  return (width * (devicePixelRatio || 1)) / 192 > SHARP_ABOVE;
}

export function createPackLoader(
  sharp: boolean,
  onReady: (pack: PackId) => void,
  now: () => number = () => Date.now()
): PackLoader {
  const state = new Map<PackId, "loading" | "ready" | "failed">();
  const images = new Map<PackId, HTMLImageElement>();
  const tries = new Map<PackId, { n: number; failedAt: number }>();
  let disposed = false;
  const url = (pack: PackId) => (sharp ? PACKS[pack].src2x : PACKS[pack].src);
  const mayRetry = (pack: PackId) => {
    const t = tries.get(pack);
    return !!t && t.n < MAX_TRIES && now() - t.failedAt >= RETRY_MS;
  };

  return {
    ensure(packs) {
      for (const pack of packs) {
        if (disposed) continue;
        const was = state.get(pack);
        if (was && !(was === "failed" && mayRetry(pack))) continue;
        state.set(pack, "loading");
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          if (disposed) return;
          // Decode before the first frame paints, so the swap never flashes. A
          // page that isn't being drawn can leave decode() pending for good, so
          // after a moment the loaded pack counts as ready anyway.
          let settled = false;
          const done = () => {
            if (disposed || settled) return;
            settled = true;
            clearTimeout(fallback);
            state.set(pack, "ready");
            onReady(pack);
          };
          const fallback = setTimeout(done, DECODE_WAIT_MS);
          if (typeof img.decode === "function") img.decode().then(done, done);
          else done();
        };
        img.onerror = () => {
          if (disposed) return;
          state.set(pack, "failed");
          tries.set(pack, { n: (tries.get(pack)?.n ?? 0) + 1, failedAt: now() });
        };
        img.src = url(pack);
        images.set(pack, img);
      }
    },
    isReady: (pack) => state.get(pack) === "ready",
    url,
    rows: (pack) => Math.ceil(PACKS[pack].frames / PACK_COLUMNS),
    dispose() {
      disposed = true;
      images.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    },
  };
}
