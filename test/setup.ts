import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Global test setup.
 *
 * jsdom doesn't implement window.matchMedia; several components and
 * hooks (next-themes, tsparticles, useMediaQuery) call it during import.
 * Stub it with a sensible default so module loads don't blow up.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  );
}
