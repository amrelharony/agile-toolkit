"use client";

import { useEffect, useState } from "react";

export type WorkerTask = "monte-carlo" | "bootstrap" | "changepoint" | "kmeans";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

// Per-request hard ceiling. The worker shouldn't be holding requests for
// 30s in normal operation; if it is, something has wedged and we'd rather
// reject than leak the pending entry forever.
const TIMEOUT_MS = 30_000;

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (workerInstance) return workerInstance;
  try {
    // Use Webpack 5 / Next.js native worker support.
    workerInstance = new Worker(new URL("./compute.worker.ts", import.meta.url), {
      type: "module",
    });
    workerInstance.onmessage = (e: MessageEvent) => {
      const { id, ok, value, error } = e.data ?? {};
      const req = pending.get(id);
      if (!req) return;
      pending.delete(id);
      if (ok) req.resolve(value);
      else req.reject(new Error(String(error ?? "worker error")));
    };
    workerInstance.onerror = (e) => {
      // A worker `error` event leaves the worker in an indeterminate state.
      // The previous behaviour rejected ALL in-flight requests, killing
      // healthy jobs that just happened to overlap with one bad input.
      // Instead: log, null the instance so the next call respawns a fresh
      // worker, and reject pending entries so they don't dangle. New calls
      // get a new worker and proceed normally.
      try {
        // eslint-disable-next-line no-console
        console.warn("[compute-worker] worker error; respawning on next call", e.message);
      } catch {
        // no-op
      }
      const failed = Array.from(pending.values());
      pending.clear();
      workerInstance = null;
      const err = new Error(e.message || "worker error");
      for (const req of failed) req.reject(err);
    };
  } catch {
    workerInstance = null;
  }
  return workerInstance;
}

/**
 * Run a heavy compute in the shared worker. Falls back to synchronous
 * execution when Worker is unavailable (SSR, tests, sandboxed iframes).
 *
 * Each request is bounded by a 30-second timeout — exceeding it rejects
 * with `worker compute timeout` and frees the pending slot so a stuck
 * task can never permanently leak the bookkeeping map.
 */
export async function runInWorker<I, O>(task: WorkerTask, input: I): Promise<O> {
  const w = getWorker();
  if (!w) {
    // Sync fallback so tests and SSR don't break. Each task type defines
    // its own fallback in compute.worker.ts.
    const { runFallback } = await import("./compute.worker");
    return runFallback<I, O>(task, input);
  }
  return new Promise<O>((resolve, reject) => {
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      // Drop the entry first so the wrapped resolve/reject below become
      // no-ops if the worker eventually responds after the timer fired.
      pending.delete(id);
      reject(new Error("worker compute timeout"));
    }, TIMEOUT_MS);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        (resolve as (v: unknown) => void)(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    w.postMessage({ id, task, input });
  });
}

/**
 * React hook wrapping the worker call. Cancels stale results if `deps` change.
 */
export function useWorkerCompute<I, O>(
  task: WorkerTask,
  input: I,
  deps: unknown[]
): { data: O | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<O | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // BUG-L1: per-effect-run cancellation flag, captured by both the
  // promise callbacks and the cleanup. The prior implementation used a
  // single hook-wide ref that was reset to false on every effect run,
  // so the cleanup→re-effect sequence raced against in-flight promises:
  //   1. Effect A: ref=false; promise A pending.
  //   2. deps change → cleanup A: ref=true.
  //   3. Effect B: ref=false again.
  //   4. Promise A resolves → reads ref===false → applies STALE data.
  // Captured-per-effect-run `cancelled` closes the window.

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runInWorker<I, O>(task, input)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
