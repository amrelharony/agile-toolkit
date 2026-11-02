import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  THEME_BOOT_SCRIPT,
  THEME_COLORS,
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

  it("comes up as the comic when nothing is stored", () => {
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(getThemePreference()).toBe("light");
  });

  it("keeps a stored choice for visitors who already made one", () => {
    localStorage.setItem("ae-theme", "dark");
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(getThemePreference()).toBe("dark");
  });

  it("boot script follows a dark OS only when 'system' is chosen", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("dark"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    localStorage.setItem("ae-theme", "system");
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    vi.unstubAllGlobals();
  });

  it("gives the browser chrome the same colour as each theme's paper", () => {
    const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
    const paper = (selector: string) => {
      const start = css.indexOf(selector);
      return css.slice(start).match(/--bg:\s*(#[0-9a-f]{6});/i)?.[1];
    };
    expect(THEME_COLORS.dark).toBe(paper(":root {"));
    expect(THEME_COLORS.light).toBe(paper('[data-theme="light"] {'));
    expect(THEME_COLORS.hc).toBe(paper('[data-theme="hc"] {'));
  });
});
