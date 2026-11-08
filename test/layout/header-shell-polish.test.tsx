/**
 * The app shell's header on phones (mobile audit 2026-11-08): the safe areas
 * around it and around the page below it.
 * jsdom has no layout, so the sizes are pinned as classes and the CSS token;
 * the real boxes are checked on phone emulation (375x812 with a simulated
 * 47 px top inset, 812x375 with 47 px side insets).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => ({ pathname: "/", owner: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/auth/use-is-owner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/use-is-owner")>()),
  useIsOwner: () => h.owner,
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuth: () => ({ status: "anonymous", error: null }),
}));
vi.mock("@/components/gamification/xp-bar", () => ({ XpBar: () => null }));
vi.mock("@/components/shared/sonification-toggle", () => ({ SonificationToggle: () => null }));
vi.mock("@/components/ai/llm-status-chip", () => ({ LlmStatusChip: () => null }));
vi.mock("@/lib/weather/widget", () => ({ WeatherWidget: () => null }));
vi.mock("@/components/auth/user-menu", () => ({
  UserMenu: () => <button type="button" aria-label="Visitor menu" />,
}));
vi.mock("@/components/auth/visitor-data-merge-dialog", () => ({
  VisitorDataMergeDialog: () => null,
}));
vi.mock("@/lib/kudos/beacon/header-beacon", () => ({ KudosHeaderBeacon: () => null }));

import { Header } from "@/components/layout/header";

const ROOT = path.resolve(__dirname, "../..");
const classesOf = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

beforeEach(() => {
  h.pathname = "/";
  h.owner = false;
});

afterEach(() => {
  cleanup();
});

describe("the header's box", () => {
  const header = () => {
    const { container } = render(<Header onOpenSearch={() => {}} />);
    const el = container.querySelector("header[data-chrome='header']");
    expect(el).not.toBeNull();
    return classesOf(el);
  };

  it("adds the top safe area to a 56 px row instead of taking it out of the row", () => {
    const cls = header();
    expect(cls).toEqual(expect.arrayContaining(["min-h-[var(--header-h)]", "pt-safe"]));
    // A fixed height with pt-safe (border-box) squeezed the row to 9 px
    // under a 47 px inset.
    expect(cls.filter((c) => /^([\w-]+:)*h-/.test(c))).toEqual([]);
  });

  it("keeps a gutter on both sides that never drops below the safe area", () => {
    const cls = header();
    expect(cls).toEqual(
      expect.arrayContaining([
        "pl-[max(0.75rem,env(safe-area-inset-left))]",
        "sm:pl-[max(1rem,env(safe-area-inset-left))]",
        "md:pl-6",
        "pr-[max(0.75rem,env(safe-area-inset-right))]",
        "sm:pr-[max(1rem,env(safe-area-inset-right))]",
        "md:pr-[max(1.5rem,env(safe-area-inset-right))]",
      ])
    );
    // A bare pr-safe (0 on most phones) beat px-3, and md:px-6 beat it on a
    // landscape iPhone: neither may come back.
    expect(cls).not.toContain("pr-safe");
    expect(cls.filter((c) => /^([\w-]+:)*px-/.test(c))).toEqual([]);
  });
});

describe("--header-h", () => {
  const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

  it("is the 56 px row plus the top safe area, so Amr's top corner clears the taller bar", () => {
    const decls = Array.from(css.matchAll(/--header-h:\s*([^;]+);/g), (m) => m[1].trim());
    expect(decls).toEqual(["calc(3.5rem + env(safe-area-inset-top, 0px))"]);
  });
});

describe("the main element's side safe areas", () => {
  const source = readFileSync(path.join(ROOT, "src/components/layout/app-shell.tsx"), "utf8");
  const mainClass = source.match(/<main[^>]*id="main-content"[^>]*className="([^"]+)"/)?.[1] ?? "";
  const cls = mainClass.split(/\s+/);

  it("keeps the right inset from md, where landscape iPhones are", () => {
    expect(cls).toEqual(expect.arrayContaining(["pl-safe", "pr-safe"]));
    expect(cls).not.toContain("md:pr-0");
  });

  it("leaves the left inset to the rail from md", () => {
    expect(cls).toContain("md:pl-0");
  });
});
