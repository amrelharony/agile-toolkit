import { describe, expect, it, vi } from "vitest";

/**
 * Regression: compute.worker.ts installs `self.onmessage` for the Worker code
 * path. The old guard `typeof self.onmessage !== "undefined"` was always true on
 * the browser main thread (self === window, window.onmessage === null, and
 * `typeof null === "object"`), so importing this module for the runFallback()
 * no-Worker path clobbered window.onmessage. The guard now requires a Worker
 * context (no `window`).
 */
describe("compute.worker main-thread import safety", () => {
  it("does not clobber window.onmessage when imported on the main thread", async () => {
    vi.resetModules(); // force the module top-level to re-run on import
    const sentinel = () => {};
    window.onmessage = sentinel as typeof window.onmessage;
    await import("@/lib/workers/compute.worker");
    expect(window.onmessage).toBe(sentinel);
    window.onmessage = null;
  });

  it("runFallback still computes a result without a Worker", async () => {
    const { runFallback } = await import("@/lib/workers/compute.worker");
    const res = await runFallback<{ series: number[]; k?: number; h?: number }, unknown>(
      "changepoint",
      { series: [1, 2, 3, 4, 10, 11, 12] }
    );
    expect(res).toBeDefined();
  });
});
