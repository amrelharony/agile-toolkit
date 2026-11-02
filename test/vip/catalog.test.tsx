/**
 * VIP tools in the catalog: listed only with the hint, and nowhere that would
 * recommend them. No other tool is locked, and the home page's numbers don't move
 * for a visitor.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  pathname: "/",
  favorites: [] as string[],
  recent: [] as { id: string; usedAt: number }[],
  recordUse: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/tools/tool-prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/tool-prefs")>();
  return {
    ...actual,
    useToolPrefs: () => ({
      favorites: h.favorites,
      recent: h.recent,
      showAllTools: false,
      setShowAllTools: () => {},
      isFavorite: (id: string) => h.favorites.includes(id),
      toggleFavorite: () => {},
      recordUse: h.recordUse,
    }),
  };
});
vi.mock("@/components/shared/mood-reveal", () => ({
  MoodReveal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitUiEvent: () => {} }));

import sitemap from "@/app/sitemap";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { ContinueSection } from "@/components/home/continue-section";
import { JOBS } from "@/lib/constants/jobs";
import { SECTIONS } from "@/lib/constants/sections";
import { getToolById, tools } from "@/lib/constants/tools";
import { HANDOFF_ROUTES, SOURCE_TOOLS } from "@/lib/handoffs/registry";
import { resetToolSearchIndex, searchTools, TOOL_KEYWORDS } from "@/lib/search/tool-search";
import {
  getShelfTools,
  getVipTools,
  getVisibleCategories,
  getVisibleTools,
  getVisibleToolsByCategory,
  isVipHidden,
  isVipOnly,
} from "@/lib/tools/catalog";
import { useToolVisibility } from "@/lib/tools/use-visible-tools";
import { clearVipHint, readVipHint, setVipHint } from "@/lib/vip/hint";
import { clearLocalWorkspaceData } from "@/lib/utils/clear-local-data";

const VIP_IDS = ["squad-session", "meet-the-cast", "which-colleague"];
const vipPaths = VIP_IDS.map((id) => `/${id}`);

function clearCookie() {
  document.cookie = "agile-toolkit:vip-hint=; path=/; max-age=0";
}

beforeEach(() => {
  clearCookie();
  resetToolSearchIndex();
  h.pathname = "/";
  h.favorites = [];
  h.recent = [];
  h.recordUse.mockClear();
});
afterEach(() => {
  clearCookie();
  cleanup();
});

describe("the registry", () => {
  it("adds exactly the three VIP tools, and locks nothing else", () => {
    expect(tools.filter(isVipOnly).map((t) => t.id)).toEqual(VIP_IDS);
    for (const id of VIP_IDS) expect(getToolById(id)?.path).toBe(`/${id}`);
  });

  it("leaves no bible wording in what every browser receives", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/constants/tools.ts"), "utf8");
    expect(src).not.toMatch(/human_want|overused|Dependable Beaver|Zombie Backlog/);
  });
});

describe("a visitor without the hint", () => {
  it("sees the same tool counts as before VIP", () => {
    const interactive = getVisibleTools().filter((t) => t.kind !== "reading");
    expect(interactive).toHaveLength(82);
    expect(getVisibleTools().filter(isVipOnly)).toEqual([]);
    expect(getShelfTools()).toHaveLength(32);
    expect(getShelfTools().filter(isVipOnly)).toEqual([]);
  });

  it("gets no VIP tool from any listing, Show all tools included", () => {
    for (const showAll of [false, true]) {
      expect(getVisibleTools(showAll).filter(isVipOnly)).toEqual([]);
      expect(getVisibleToolsByCategory("Library", showAll).map((t) => t.id)).toEqual([
        "comics",
        "book",
      ]);
    }
    expect(getVisibleCategories()).toContain("Library");
  });

  it("gets the same from the reactive hook", () => {
    const { result } = renderHook(() => useToolVisibility());
    expect(result.current.tools.filter(isVipOnly)).toEqual([]);
    expect(result.current.isVisible("squad-session")).toBe(false);
    expect(result.current.tools.filter((t) => t.kind !== "reading")).toHaveLength(82);
  });

  it("doesn't get the VIP section in the home grid's data", () => {
    const { result } = renderHook(() => useToolVisibility());
    const vip = SECTIONS.find((s) => s.id === "vip")!;
    expect(vip.toolIds.flatMap((id) => result.current.byId.get(id) ?? [])).toEqual([]);
  });
});

describe("a browser with the hint", () => {
  it("lists the released VIP tools, and the hook follows the cookie", () => {
    const { result } = renderHook(() => useToolVisibility());
    expect(result.current.isVisible("meet-the-cast")).toBe(false);
    act(() => setVipHint());
    expect(readVipHint()).toBe(true);
    expect(result.current.isVisible("meet-the-cast")).toBe(true);
    expect(result.current.isVisible("squad-session")).toBe(true);
    act(() => clearVipHint());
    expect(result.current.isVisible("meet-the-cast")).toBe(false);
  });

  it("only reads an exact hint", () => {
    expect(readVipHint("agile-toolkit:vip-hint=1")).toBe(true);
    expect(readVipHint("a=b; agile-toolkit:vip-hint=1; c=d")).toBe(true);
    expect(readVipHint("agile-toolkit:vip-hint=0")).toBe(false);
    expect(readVipHint("x-agile-toolkit:vip-hint=1")).toBe(false);
    expect(readVipHint("")).toBe(false);
  });

  it("is forgotten by Clear data on this browser", () => {
    setVipHint();
    expect(readVipHint()).toBe(true);
    clearLocalWorkspaceData({ broadcast: false });
    expect(readVipHint()).toBe(false);
  });
});

describe("what never recommends a VIP tool", () => {
  it("search, for any query, hint or no hint", () => {
    setVipHint();
    resetToolSearchIndex();
    for (const q of [
      "squad session",
      "squad session kit",
      "meet the cast",
      "cast",
      "which colleague",
      "colleague",
      "vip",
    ]) {
      expect(searchTools(q, 12).filter(isVipOnly), q).toEqual([]);
    }
    for (const id of VIP_IDS) expect(TOOL_KEYWORDS[id]).toBeUndefined();
  });

  it("search still finds shelved tools", () => {
    expect(searchTools("model card", 3).some((t) => t.id === "model-card")).toBe(true);
  });

  it("the sitemap", () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    for (const p of vipPaths) expect(urls).not.toContain(p);
    expect(urls).toContain("/comics");
  });

  it("the home job launcher and the mascot's starters", () => {
    for (const job of JOBS) {
      expect(VIP_IDS).not.toContain(job.primaryToolId);
      for (const alt of job.alternatives) expect(VIP_IDS).not.toContain(alt.toolId);
    }
  });

  it("hand-off routes, which only ever target public tools", () => {
    for (const route of Object.values(HANDOFF_ROUTES)) {
      expect(VIP_IDS).not.toContain(route.targetToolId);
    }
    expect(SOURCE_TOOLS["squad-session"].href).toBe("/squad-session");
  });

  it("next-step rules, which never link to one", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/tools/next-steps.ts"), "utf8");
    for (const p of vipPaths) expect(src).not.toContain(`"${p}`);
    for (const p of vipPaths) expect(src).not.toContain(`\`${p}`);
  });

  it("related tools, in either direction, even with the hint", () => {
    setVipHint();
    const { container } = render(<RelatedTools toolId="squad-session" />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    render(<RelatedTools toolId="comics" />);
    expect(screen.queryByRole("link", { name: /Squad Session Kit|Meet the Cast/ })).toBeNull();
    cleanup();
    render(<RelatedTools toolId="six-hats" />);
    for (const link of screen.getAllByRole("link")) {
      expect(vipPaths).not.toContain(link.getAttribute("href"));
    }
  });

  it("home favourites and recents, once the hint has gone", () => {
    h.favorites = ["meet-the-cast", "wsjf"];
    h.recent = [{ id: "squad-session", usedAt: Date.now() }];
    const tool = getToolById("meet-the-cast")!;
    expect(isVipHidden(tool, false)).toBe(true);
    expect(isVipHidden(tool, true)).toBe(false);
    expect(isVipHidden(getToolById("retro")!, false)).toBe(false);
    render(<ContinueSection />);
    expect(screen.queryByRole("link", { name: /Meet the Cast/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Squad Session Kit/ })).toBeNull();
    expect(screen.getByRole("link", { name: /WSJF Calculator/ })).toBeInTheDocument();
    cleanup();
    setVipHint();
    render(<ContinueSection />);
    expect(screen.getByRole("link", { name: /Meet the Cast/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Squad Session Kit/ })).toBeInTheDocument();
  });
});

describe("the hub's list", () => {
  it("is the VIP tools that aren't waiting on approval", () => {
    expect(getVipTools().every(isVipOnly)).toBe(true);
    expect(getVipTools().map((t) => t.id)).toEqual(
      expect.arrayContaining(["squad-session", "meet-the-cast"])
    );
  });
});
