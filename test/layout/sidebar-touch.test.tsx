/**
 * The sidebar on landscape iPhones (mobile audit 2026-11-08): from md the
 * rail dropped the left safe area, so a landscape iPhone's notch sat over its
 * icons. jsdom has no layout, so these pin the classes; the boxes are checked
 * on phone emulation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const prefs = vi.hoisted(() => ({
  favorites: ["retro"] as string[],
  recent: [{ id: "planning-poker", usedAt: 1 }] as { id: string; usedAt: number }[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: prefs.favorites,
    recent: prefs.recent,
    showAllTools: false,
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
    setShowAllTools: () => {},
  }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));

import { Sidebar } from "@/components/layout/sidebar";

const classesOf = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("the rail from md", () => {
  const aside = () => screen.getByRole("complementary", { name: "Primary navigation" });

  it("keeps the left safe area and grows by it, collapsed", () => {
    render(<Sidebar />);
    const cls = classesOf(aside());
    expect(cls).toContain("pl-safe");
    expect(cls).not.toContain("md:pl-0");
    expect(cls).toContain("md:w-[calc(4rem+env(safe-area-inset-left))]");
    expect(cls).not.toContain("md:w-16");
  });

  it("and pinned open", () => {
    window.localStorage.setItem("agile-toolkit:sidebar:collapsed:v2", "false");
    render(<Sidebar />);
    const cls = classesOf(aside());
    expect(cls).toContain("pl-safe");
    expect(cls).not.toContain("md:pl-0");
    expect(cls).toContain("md:w-[calc(16rem+env(safe-area-inset-left))]");
    expect(cls).not.toContain("md:w-64");
  });
});
