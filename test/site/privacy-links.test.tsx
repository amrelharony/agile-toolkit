/**
 * The privacy page (/privacy) is reachable from the three places a visitor
 * asks "where does my work go?": the sidebar under "Built by", the home
 * page's trust badge and the "Your data" dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pathname: "/retro",
  auth: null as { status: string; user: { id: string } | null } | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    showAllTools: false,
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
    setShowAllTools: () => {},
  }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/app/(tools)/sprint/cockpit", () => ({ SprintCockpit: () => null }));
vi.mock("@/components/shared/insights-engine", () => ({ InsightsEngine: () => null }));
vi.mock("@/components/home/home-search", () => ({ HomeSearch: () => null }));
vi.mock("@/components/home/job-launcher", () => ({ JobLauncher: () => null }));
vi.mock("@/components/home/continue-section", () => ({ ContinueSection: () => null }));
vi.mock("@/components/home/tool-sections", () => ({ ToolSections: () => null }));
vi.mock("@/lib/team/use-team-roster", () => ({ useWorkspaceHydrated: () => true }));

import { YourDataDialog } from "@/components/data/your-data-dialog";
import { HomePage } from "@/components/home/home-page";
import { Sidebar } from "@/components/layout/sidebar";
import { TOUCH_LINK } from "@/components/ui/touch-target";
import { PRIVACY_PATH, PRIVACY_TITLE } from "@/lib/site/owner";

beforeEach(() => {
  window.localStorage.clear();
  h.pathname = "/retro";
  h.auth = null;
});
afterEach(() => {
  cleanup();
});

describe("the sidebar", () => {
  const open = () => window.localStorage.setItem("agile-toolkit:sidebar:collapsed:v2", "false");

  it("links the page under Built by, with a touch-sized target", () => {
    open();
    render(<Sidebar />);
    const aside = screen.getByRole("complementary", { name: "Primary navigation" });
    const link = within(aside).getByRole("link", { name: PRIVACY_TITLE });
    expect(link).toHaveAttribute("href", PRIVACY_PATH);
    for (const cls of TOUCH_LINK.split(" ")) expect(link.className).toContain(cls);
    // Right under the owner's name.
    const builtBy = within(aside).getByText(/Built by/);
    expect(builtBy.parentElement).toBe(link.closest("p")!.parentElement);
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("marks it as the page you're on, on the page", () => {
    open();
    h.pathname = PRIVACY_PATH;
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: PRIVACY_TITLE })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});

describe("the home page's trust badge", () => {
  it("opens the page, keeping its words as the start of the link's name", () => {
    render(<HomePage />);
    const badge = screen.getByRole("link", {
      name: /^Free · No sign-up · Saved only in your browser/,
    });
    expect(badge).toHaveAttribute("href", PRIVACY_PATH);
    expect(badge).toHaveAccessibleName(
      `Free · No sign-up · Saved only in your browser. ${PRIVACY_TITLE}`
    );
    expect(badge.className).toContain("pointer-coarse:min-h-11");
  });
});

describe("the Your data dialog", () => {
  it("links the page beside what it says, and closes when it is followed", () => {
    const onOpenChange = vi.fn();
    render(<YourDataDialog open onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole("dialog", { name: "Your data" });
    const link = within(dialog).getByRole("link", { name: PRIVACY_TITLE });
    expect(link).toHaveAttribute("href", PRIVACY_PATH);
    expect(link.closest("p")).toHaveTextContent(
      `Every part of the site, and who to ask: ${PRIVACY_TITLE}.`
    );
    // Not part of the description a screen reader reads with the title.
    const described = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(described).not.toContainElement(link);
    // jsdom can't follow a link to another page, so the click stops short of it.
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener("click", stay);
    fireEvent.click(link);
    document.removeEventListener("click", stay);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the link to the owner too", () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    render(<YourDataDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("link", { name: PRIVACY_TITLE })).toHaveAttribute("href", PRIVACY_PATH);
  });
});
