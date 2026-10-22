import "@testing-library/jest-dom/vitest";
import { afterAll, vi } from "vitest";

/**
 * Global test setup.
 *
 * jsdom doesn't implement window.matchMedia; several components and
 * hooks (next-themes, tsparticles, useMediaQuery) call it during import.
 * Stub it with a sensible default so module loads don't blow up.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

/**
 * Loading workspace-store in a browser-like environment starts a
 * fire-and-forget import of the sync registry. A quick test file can finish
 * before that import does, and Vitest then fails the whole run with an
 * EnvironmentTeardownError ("Cannot load ... after the environment was torn
 * down") although every test passed. Let in-flight imports finish first.
 *
 * The registry pulls in the whole sync layer, so under a full parallel run
 * the transform can outlast the default 10 s hook timeout and fail a file
 * whose tests all passed. Give the wait a minute.
 */
afterAll(async () => {
  await vi.dynamicImportSettled();
}, 60_000);
