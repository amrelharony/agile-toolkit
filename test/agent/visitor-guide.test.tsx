import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pathname: "/",
  announce: vi.fn(),
  realAnnouncer: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
}));
// The app's one announcer, unless a test asks for the real provider.
vi.mock("@/components/a11y/live-announcer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/a11y/live-announcer")>();
  return {
    ...real,
    useAnnounce: () => (h.realAnnouncer ? real.useAnnounce() : h.announce),
  };
});

import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import {
  RESULTS_CAP,
  RESULTS_CAP_WITH_AI,
  SEARCH_ANNOUNCE_MS,
  VisitorGuide,
  matchCountNote,
} from "@/components/agent/mascot/visitor-guide";
import { searchTools } from "@/lib/search/tool-search";

const search = () => screen.getByLabelText("What do you need to do?") as HTMLInputElement;
const type = (value: string) => fireEvent.change(search(), { target: { value } });
const results = () => screen.getByRole("list", { name: "Matching tools" });

describe("VisitorGuide", () => {
  beforeEach(() => {
    h.pathname = "/";
    h.announce.mockClear();
    h.realAnnouncer = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the search", () => {
    it("is a labelled search form whose field says Search on a phone keyboard", () => {
      render(<VisitorGuide />);
      const form = screen.getByRole("search", { name: "Find a tool" });
      expect(form.tagName).toBe("FORM");
      expect(form).toContainElement(search());
      expect(search()).toHaveAttribute("type", "search");
      expect(search()).toHaveAttribute("enterkeyhint", "search");
    });

    it("Enter moves focus to the first result", () => {
      render(<VisitorGuide />);
      search().focus();
      type("retrospective");
      const submitted = fireEvent.submit(screen.getByRole("search"));
      // The page never reloads.
      expect(submitted).toBe(false);
      const first = within(results()).getAllByRole("link")[0];
      expect(first).toHaveAttribute("href", "/retro");
      expect(first).toHaveFocus();
    });

    it("Enter with no match keeps focus in the box and asks nobody", () => {
      const onAskAmr = vi.fn();
      const onNavigate = vi.fn();
      render(<VisitorGuide onAskAmr={onAskAmr} onNavigate={onNavigate} />);
      search().focus();
      type("zzqx");
      expect(fireEvent.submit(screen.getByRole("search"))).toBe(false);
      expect(search()).toHaveFocus();
      expect(search()).toHaveValue("zzqx");
      expect(onAskAmr).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it("Enter on an empty search does nothing", () => {
      render(<VisitorGuide />);
      search().focus();
      expect(fireEvent.submit(screen.getByRole("search"))).toBe(false);
      expect(search()).toHaveFocus();
    });

    it("reads the count out once typing has stopped for 450 ms", () => {
      vi.useFakeTimers();
      render(<VisitorGuide />);
      type("retro");
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS - 100));
      // Still typing: the wait starts again.
      type("retrospective");
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS - 1));
      expect(h.announce).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      const count = within(results()).getAllByRole("link").length;
      expect(h.announce).toHaveBeenCalledTimes(1);
      expect(h.announce).toHaveBeenCalledWith(matchCountNote(count, "retrospective"));
      expect(matchCountNote(count, "retrospective")).toBe(`${count} tools match`);
    });

    it("reads out a search with no match, and shows it without a live region", () => {
      vi.useFakeTimers();
      render(<VisitorGuide />);
      type("zzqx");
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS));
      expect(h.announce).toHaveBeenCalledWith("No tools match “zzqx”");
      const shown = screen.getByText(/^No tools match/);
      expect(shown).toHaveTextContent("No tools match “zzqx”. Try a task like");
      expect(shown).not.toHaveAttribute("role");
      expect(shown).not.toHaveAttribute("aria-live");
    });

    it("says one tool and many tools in plain words", () => {
      expect(matchCountNote(1, "x")).toBe("1 tool matches");
      expect(matchCountNote(4, "x")).toBe("4 tools match");
      expect(matchCountNote(0, "okr board")).toBe("No tools match “okr board”");
      for (const n of [0, 1, 4]) expect(matchCountNote(n, "x")).not.toMatch(/[—–]/);
    });

    it("has a single live channel: the app's announcer", () => {
      vi.useFakeTimers();
      h.realAnnouncer = true;
      render(
        <LiveAnnouncerProvider>
          <VisitorGuide onAskAmr={() => {}} />
        </LiveAnnouncerProvider>
      );
      const guide = screen.getByTestId("mascot-visitor-guide");
      const live = '[role="status"], [role="alert"], [role="log"], [aria-live]';
      expect(guide.querySelectorAll(live)).toHaveLength(0);

      type("zzqx");
      expect(guide.querySelectorAll(live)).toHaveLength(0);
      // The announcer's own 50 ms clear-then-say comes after the wait.
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS + 50));
      expect(screen.getByTestId("live-polite")).toHaveTextContent("No tools match “zzqx”");
      expect(guide.querySelectorAll(live)).toHaveLength(0);
    });
  });

  describe("Escape", () => {
    it("clears a search first and keeps the key, then lets an empty search's Escape through", () => {
      render(<VisitorGuide />);
      type("retro");
      // fireEvent returns false when the handler called preventDefault: the
      // panel's own Escape skips a key a field has used.
      expect(fireEvent.keyDown(search(), { key: "Escape" })).toBe(false);
      expect(search()).toHaveValue("");
      expect(screen.queryByRole("list", { name: "Matching tools" })).toBeNull();

      expect(fireEvent.keyDown(search(), { key: "Escape" })).toBe(true);
      expect(search()).toHaveValue("");
    });

    it("clears a search of spaces too", () => {
      render(<VisitorGuide />);
      type("   ");
      expect(fireEvent.keyDown(search(), { key: "Escape" })).toBe(false);
      expect(search()).toHaveValue("");
    });

    it("leaves an input method's Escape alone", () => {
      render(<VisitorGuide />);
      type("retro");
      expect(fireEvent.keyDown(search(), { key: "Escape", isComposing: true })).toBe(true);
      expect(search()).toHaveValue("retro");
      // Older browsers say "composing" with keyCode 229 instead.
      expect(fireEvent.keyDown(search(), { key: "Escape", keyCode: 229 })).toBe(true);
      expect(search()).toHaveValue("retro");
    });
  });

  describe("initialQuery", () => {
    it("starts with the search a visitor came back with, and does not read it out again", () => {
      vi.useFakeTimers();
      render(<VisitorGuide initialQuery="retrospective" />);
      expect(search()).toHaveValue("retrospective");
      expect(within(results()).getAllByRole("link")[0]).toHaveAttribute("href", "/retro");
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS * 2));
      expect(h.announce).not.toHaveBeenCalled();
      // Typing again is read out as usual.
      type("retro");
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS));
      expect(h.announce).toHaveBeenCalledTimes(1);
    });
  });

  describe("results", () => {
    // "sprint" matches more tools than either cap.
    it("shows at most 6 results, or 5 with Amr's AI on", () => {
      expect(searchTools("sprint", 10).length).toBeGreaterThan(RESULTS_CAP);
      const { unmount } = render(<VisitorGuide />);
      type("sprint");
      expect(within(results()).getAllByRole("link")).toHaveLength(RESULTS_CAP);
      unmount();

      render(<VisitorGuide onAskAmr={() => {}} />);
      type("sprint");
      expect(within(results()).getAllByRole("link")).toHaveLength(RESULTS_CAP_WITH_AI);
      expect(RESULTS_CAP_WITH_AI).toBe(5);
      expect(RESULTS_CAP).toBe(6);
    });

    it("lets the search box take its own direction", () => {
      render(<VisitorGuide />);
      expect(search()).toHaveAttribute("dir", "auto");
    });
  });
});
