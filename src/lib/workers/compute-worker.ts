"use client";

import { useEffect, useRef, useState } from "react";

export type WorkerTask = "monte-carlo" | "bootstrap" | "changepoint" | "kmeans";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (workerInstance) return workerInstance;
  try {
    // Use Webpack 5 / Next.js native worker support.
    workerInstance = new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module" });
    workerInstance.onmessage = (e: MessageEvent) => {
      const { id, ok, value, error } = e.data ?? {};
      const req = pending.get(id);
      if (!req) return;
      pending.delete(id);
      if (ok) req.resolve(value);
      else req.reject(new Error(String(error ?? "worker error")));
    };
    workerInstance.onerror = (e) => {
      // Reject all pending requests on a fatal worker error.
      pending.forEach((req) => req.reject(new Error(e.message)));
      pending.clear();
    };
  } catch {
    workerInstance = null;
  }
  return workerInstance;
}

/**
 * Run a heavy compute in the shared worker. Falls back to synchronous
 * execution when Worker is unavailable (SSR, tests, sandboxed iframes).
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
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setError(null);
    runInWorker<I, O>(task, input)
      .then((result) => {
        if (cancelledRef.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelledRef.current) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
