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
 */
afterAll(async () => {
  await vi.dynamicImportSettled();
});
