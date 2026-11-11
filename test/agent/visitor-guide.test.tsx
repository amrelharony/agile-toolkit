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
  SHRUG_AFTER_MS,
  VisitorGuide,
  matchCountNote,
} from "@/components/agent/mascot/visitor-guide";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { searchTools } from "@/lib/search/tool-search";
import { JOBS } from "@/lib/constants/jobs";

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
      // The label is lettered: a section label, not an Amr balloon.
      const label = screen.getByText("What do you need to do?");
      expect(label.tagName).toBe("LABEL");
      expect(label).toHaveClass("font-display");
      expect(label.closest(".balloon")).toBeNull();
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

    it("Enter with no match asks Amr when his AI is on, the same as the Ask button", () => {
      const onAskAmr = vi.fn();
      const onNavigate = vi.fn();
      render(<VisitorGuide onAskAmr={onAskAmr} onNavigate={onNavigate} />);
      search().focus();
      type("zzqx");
      expect(fireEvent.submit(screen.getByRole("search"))).toBe(false);
      expect(onAskAmr).toHaveBeenCalledTimes(1);
      expect(onAskAmr).toHaveBeenCalledWith("zzqx");
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it("Enter with no match goes back to the chat when the search still holds its question", () => {
      const onAskAmr = vi.fn();
      render(
        <VisitorGuide onAskAmr={onAskAmr} resumeChat initialQuery="zzqx" resumeQuery="zzqx" />
      );
      expect(fireEvent.submit(screen.getByRole("search"))).toBe(false);
      expect(onAskAmr).toHaveBeenCalledWith("");
    });

    it("Enter with no match and no AI keeps focus in the box to try again", () => {
      render(<VisitorGuide />);
      search().focus();
      type("zzqx");
      expect(fireEvent.submit(screen.getByRole("search"))).toBe(false);
      expect(search()).toHaveFocus();
      expect(search()).toHaveValue("zzqx");
    });

    it("Enter on an empty search asks nobody", () => {
      const onAskAmr = vi.fn();
      render(<VisitorGuide onAskAmr={onAskAmr} />);
      search().focus();
      expect(fireEvent.submit(screen.getByRole("search"))).toBe(false);
      expect(onAskAmr).not.toHaveBeenCalled();
      expect(search()).toHaveFocus();
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

    it("gets no shrug from Amr for a search it opened with, only for one the visitor types", () => {
      vi.useFakeTimers();
      useMascotStore.setState({ reactionQueue: [] });
      render(<VisitorGuide initialQuery="zzqx" />);
      act(() => vi.advanceTimersByTime(SHRUG_AFTER_MS * 2));
      expect(useMascotStore.getState().reactionQueue).not.toContain("shrug");

      type("zzqxy");
      act(() => vi.advanceTimersByTime(SHRUG_AFTER_MS));
      expect(useMascotStore.getState().reactionQueue.filter((r) => r === "shrug")).toHaveLength(1);
      useMascotStore.setState({ reactionQueue: [] });
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

    it("gives a result's description two lines, and its text its own direction", () => {
      render(<VisitorGuide />);
      type("retrospective");
      const first = within(results()).getAllByRole("link")[0];
      const [title, subtitle] = Array.from(first.querySelectorAll("span[dir]"));
      expect(title).toHaveAttribute("dir", "auto");
      expect(subtitle).toHaveAttribute("dir", "auto");
      expect(subtitle).toHaveClass("line-clamp-2");
      // `block` sorts after the clamp in Tailwind and would undo it.
      expect(subtitle).not.toHaveClass("truncate");
      expect(subtitle).not.toHaveClass("block");
    });

    it("lets the search box take its own direction", () => {
      render(<VisitorGuide />);
      expect(search()).toHaveAttribute("dir", "auto");
    });

    it("keeps a typed search apart from the words around it", () => {
      render(<VisitorGuide onAskAmr={() => {}} />);
      type("زززز");
      expect(screen.getByText(/^No tools match/).querySelector("bdi")).toHaveTextContent("زززز");
      expect(
        screen.getByRole("button", { name: "Ask Amr about “زززز”" }).querySelector("bdi")
      ).not.toBeNull();
    });
  });

  describe("the Ask button (visitor AI on)", () => {
    it("is one primary button: Chat with Amr, then Ask Amr about the search", () => {
      const onAskAmr = vi.fn();
      render(<VisitorGuide onAskAmr={onAskAmr} />);
      const ask = screen.getByRole("button", { name: "Chat with Amr" });
      expect(ask).toHaveAttribute("data-variant", "default");
      // It wraps a long search inside itself and keeps 44 px on touch.
      expect(ask).toHaveClass(
        "h-auto",
        "max-w-full",
        "whitespace-normal",
        "pointer-coarse:min-h-11"
      );
      fireEvent.click(ask);
      expect(onAskAmr).toHaveBeenCalledWith("");

      type("  retro  ");
      expect(screen.getByRole("button", { name: "Ask Amr about “retro”" })).toBe(ask);
      expect(screen.getAllByRole("button", { name: /Amr/ })).toHaveLength(1);
      fireEvent.click(ask);
      expect(onAskAmr).toHaveBeenLastCalledWith("retro");
    });

    it("reads Back to chat when a chat is under way", () => {
      const onAskAmr = vi.fn();
      render(<VisitorGuide onAskAmr={onAskAmr} resumeChat />);
      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
      expect(onAskAmr).toHaveBeenCalledWith("");
      expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
      type("retro");
      expect(screen.getByRole("button", { name: "Ask Amr about “retro”" })).toBeInTheDocument();
    });

    it("goes back to the chat while the search still holds the question it opened with", () => {
      const onAskAmr = vi.fn();
      render(
        <VisitorGuide onAskAmr={onAskAmr} resumeChat initialQuery="retro" resumeQuery="retro" />
      );
      expect(search()).toHaveValue("retro");
      expect(results()).toBeInTheDocument();
      // That question was sent already: the button asks nothing again.
      expect(screen.queryByRole("button", { name: "Ask Amr about “retro”" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
      expect(onAskAmr).toHaveBeenLastCalledWith("");

      // A new search is asked as usual.
      type("retro board");
      fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro board”" }));
      expect(onAskAmr).toHaveBeenLastCalledWith("retro board");
      // The same question typed again goes back to the chat too.
      type(" retro ");
      expect(screen.getByRole("button", { name: "Back to chat" })).toBeInTheDocument();
    });

    it("asks a search it opened with when no chat is under way", () => {
      const onAskAmr = vi.fn();
      render(<VisitorGuide onAskAmr={onAskAmr} initialQuery="retro" resumeQuery="retro" />);
      fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro”" }));
      expect(onAskAmr).toHaveBeenCalledWith("retro");
    });

    it("is not there with the AI off", () => {
      render(<VisitorGuide />);
      type("zzqx");
      expect(screen.queryByRole("button", { name: /Amr/ })).toBeNull();
    });
  });

  describe("layout", () => {
    it("shows the popular tasks as tiles with a touch floor and no press yet", () => {
      render(<VisitorGuide />);
      const list = screen.getByRole("list", { name: "Popular tasks" });
      expect(list).toHaveClass("grid", "grid-cols-2");
      const tiles = within(list).getAllByRole("link");
      expect(tiles).toHaveLength(JOBS.length);
      expect(tiles).toHaveLength(8);
      for (const tile of tiles) {
        expect(tile).toHaveClass("min-touch-coarse");
        expect(tile).not.toHaveClass("active-press");
        expect(tile).not.toHaveClass("card-press");
      }
      // Its heading is an Eyebrow h3, named for the list.
      const heading = screen.getByRole("heading", { name: "Popular tasks", level: 3 });
      expect(heading).toHaveAttribute("id", "mascot-popular-tasks");
    });

    it("puts the current tool in a panel card with its steps in a closed disclosure", async () => {
      h.pathname = "/wsjf";
      render(<VisitorGuide />);
      const tool = screen.getByRole("region", { name: "This tool" });
      expect(tool).toHaveClass("panel");
      expect(within(tool).getByRole("heading", { level: 3 })).toHaveClass("font-display");
      const summary = await within(tool).findByText(/^How to run it \(\d+ steps?\)$/);
      expect(summary.tagName).toBe("SUMMARY");
      expect(summary).toHaveClass("flex", "items-center", "pointer-coarse:min-h-11");
      const details = summary.closest("details");
      expect(details).not.toHaveAttribute("open");
      const steps = within(details as HTMLElement).getAllByRole("listitem");
      expect(summary).toHaveTextContent(`How to run it (${steps.length} steps)`);
    });

    it("uses no uppercase lettering anywhere", async () => {
      h.pathname = "/wsjf";
      const { container } = render(<VisitorGuide onAskAmr={() => {}} />);
      await within(container).findByText(/^How to run it/);
      expect(container.querySelectorAll('[class~="uppercase"]')).toHaveLength(0);
      expect(container.innerHTML).not.toMatch(/\buppercase\b/);
    });

    it("keeps the own-key footer quiet and drops the owner sign-in", () => {
      render(<VisitorGuide />);
      const settings = screen.getByRole("button", { name: "AI settings" });
      expect(settings).toHaveAttribute("data-variant", "ghost");
      expect(settings).toHaveClass("pointer-coarse:min-h-11");
      expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
    });

    it("keeps its scrolling to itself", () => {
      render(<VisitorGuide />);
      expect(screen.getByTestId("mascot-visitor-guide")).toHaveClass(
        "overflow-y-auto",
        "overscroll-contain"
      );
    });
  });
});
