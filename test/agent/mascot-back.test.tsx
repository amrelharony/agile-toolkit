import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Links followed from Amr's phone sheet close it (design §1.3 item 9, PR 8;
 * audit critic2-1): a link in his answer, a tool in the tool finder and the
 * consent card's privacy link all close through the panel context, and while
 * the sheet's Back marker is the newest history entry (replaceOnNavigate)
 * their page replaces it.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));

import {
  AmrPanelContext,
  NO_AMR_PANEL,
  type AmrPanelLayout,
} from "@/components/agent/mascot/panel-context";
import { VisitorAiConsent } from "@/components/agent/mascot/visitor-ai-consent";
import { VisitorGuide } from "@/components/agent/mascot/visitor-guide";
import { Markdown } from "@/components/agent/markdown";
import { PRIVACY_TITLE } from "@/lib/site/owner";

// ── The browser around the panel ─────────────────────────────────────────

/** The app router a next/link navigates with. */
const router = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
};

function withRouter(ui: ReactNode) {
  return <AppRouterContext.Provider value={router}>{ui}</AppRouterContext.Provider>;
}

/** The tool finder's first popular task: a link to a tool's page. */
function firstTile(): HTMLAnchorElement {
  const list = screen.getByRole("list", { name: "Popular tasks" });
  return within(list).getAllByRole("link")[0] as HTMLAnchorElement;
}

beforeEach(() => {
  for (const fn of Object.values(router)) fn.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

// ── Links in the panel's views ───────────────────────────────────────────

describe("links close the sheet through the panel context", () => {
  function inPanel(layout: AmrPanelLayout, replaceOnNavigate: boolean, ui: ReactNode) {
    const onNavigate = vi.fn();
    render(
      withRouter(
        <AmrPanelContext.Provider
          value={{ ...NO_AMR_PANEL, layout, onNavigate, replaceOnNavigate }}
        >
          {ui}
        </AmrPanelContext.Provider>
      )
    );
    return onNavigate;
  }

  it("a link in Amr's answer, in the sheet with the marker on top: closes and replaces", () => {
    const onNavigate = inPanel("sheet", true, <Markdown source="Open [Retro](/retro) now." />);
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/retro", expect.anything());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a link in Amr's answer, in the sheet with a CloseWatcher: closes and pushes", () => {
    const onNavigate = inPanel("sheet", false, <Markdown source="Open [Retro](/retro) now." />);
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/retro", expect.anything());
  });

  it("a link in Amr's answer beside a floating panel: the chat stays open", () => {
    const onNavigate = inPanel("float", false, <Markdown source="Open [Retro](/retro) now." />);
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/retro", expect.anything());
  });

  it("the consent card's privacy link closes through the context and replaces the marker", () => {
    const onNavigate = inPanel(
      "sheet",
      true,
      <VisitorAiConsent question="" onAgree={() => {}} onDecline={() => {}} />
    );
    const link = screen.getByRole("link", { name: PRIVACY_TITLE });
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(link.getAttribute("href"), expect.anything());
  });

  it("a tool picked in the tool finder closes through the context and replaces the marker", () => {
    const onNavigate = inPanel("sheet", true, <VisitorGuide />);
    const tile = firstTile();
    fireEvent.click(tile);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(tile.getAttribute("href"), expect.anything());
    expect(router.push).not.toHaveBeenCalled();
  });
});
