import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  THEME_BOOT_SCRIPT,
} from "@/lib/theme/theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

describe("theme", () => {
  it("resolves 'system' to the OS theme", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("hc", "light")).toBe("hc");
  });

  it("stores the preference and applies it to <html>", () => {
    setThemePreference("light");
    expect(getThemePreference()).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("keeps exactly one theme class", () => {
    applyTheme("dark");
    applyTheme("hc");
    const cls = document.documentElement.classList;
    expect([cls.contains("dark"), cls.contains("light"), cls.contains("hc")]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("boot script applies a stored theme before React runs", () => {
    localStorage.setItem("ae-theme", "hc");
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains("hc")).toBe(true);
  });

  it("boot script follows the OS when 'system' is chosen", () => {
    localStorage.setItem("ae-theme", "system");
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("light"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    vi.unstubAllGlobals();
  });

  it("stays dark when nothing is stored", () => {
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(getThemePreference()).toBe("dark");
  });
});
