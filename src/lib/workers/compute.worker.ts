/**
 * Shared compute worker. Handles heavy stats so the main thread stays
 * responsive. Routed by `task` field; each branch is a thin wrapper over
 * an analytics module.
 *
 * Also exports `runFallback` for the SSR / no-Worker code path.
 */
import { bootstrapCI } from "../analytics/bootstrap";
import { cusum } from "../analytics/changepoint";
import { kMeansAuto } from "../analytics/clustering";
import { runMonteCarlo } from "../analytics/monte-carlo";

type IncomingMessage = { id: number; task: string; input: unknown };

export async function runFallback<I, O>(task: string, input: I): Promise<O> {
  return dispatch(task, input) as O;
}

function dispatch(task: string, input: unknown): unknown {
  switch (task) {
    case "monte-carlo": {
      const i = input as Parameters<typeof runMonteCarlo>[0];
      return runMonteCarlo(i);
    }
    case "bootstrap": {
      const i = input as {
        series: number[];
        statistic: "mean" | "p50" | "p85";
        iterations?: number;
      };
      const fn =
        i.statistic === "mean"
          ? (s: number[]) => s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)
          : i.statistic === "p50"
            ? (s: number[]) =>
                quantile(
                  s.slice().sort((a, b) => a - b),
                  0.5
                )
            : (s: number[]) =>
                quantile(
                  s.slice().sort((a, b) => a - b),
                  0.85
                );
      return bootstrapCI(i.series, fn, i.iterations ?? 1000);
    }
    case "changepoint": {
      const i = input as { series: number[]; k?: number; h?: number };
      return cusum(i.series, i.k, i.h);
    }
    case "kmeans": {
      const i = input as { points: number[][]; maxK?: number };
      return kMeansAuto(i.points, i.maxK);
    }
    default:
      throw new Error(`Unknown worker task: ${task}`);
  }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sorted.length) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

// Worker code path. The `self` reference is only valid inside a Worker
// context; the import above is plain TS so `runFallback` can also be
// called from the main thread.
declare const self: {
  onmessage: ((e: MessageEvent<IncomingMessage>) => void) | null;
  postMessage: (data: unknown) => void;
};

// Install the message handler ONLY inside a real Worker. `self` also exists on
// the browser main thread (self === window), where `window.onmessage` is `null`
// — and `typeof null === "object"`, so the old `typeof self.onmessage !==
// "undefined"` check passed on the window and clobbered `window.onmessage` when
// this module was imported for the `runFallback` path (no-Worker environments).
// Workers (including module workers) have no `window`; the main thread does.
if (typeof self !== "undefined" && typeof window === "undefined") {
  self.onmessage = (e: MessageEvent<IncomingMessage>) => {
    const { id, task, input } = e.data ?? ({} as IncomingMessage);
    try {
      const value = dispatch(task, input);
      self.postMessage({ id, ok: true, value });
    } catch (err) {
      self.postMessage({ id, ok: false, error: (err as Error).message });
    }
  };
}
