import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

/**
 * Retro Actions' recurring themes: what came up in three or more of the
 * past retros, flagged when it came back after its action was done; "not
 * enough retros yet" below three; Ask Amr names the themes by meaning, read
 * back through short card ids and kept only across three retros; the
 * export lists them.
 */

vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/app/(tools)/retro-actions/charts", () => ({ FollowThroughChart: () => null }));

import { RetroActionsTracker } from "@/app/(tools)/retro-actions/tracker";
import { themesToMarkdown } from "@/app/(tools)/retro-actions/markdown";
import { recurringThemes } from "@/lib/retro/recurring-themes";

const card = (id: string, text: string, over: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text,
  votes: 0,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...over,
});
const past = (id: string, day: string, cards: RetroCard[]): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  archivedAt: `${day}T10:00:00.000Z`,
});

const BOARDS = [
  past("retro:1", "2026-09-01", [
    card("a1", "Staging was down for a day"),
    card("a2", "Fix staging data", {
      isActionItem: true,
      done: true,
      doneAt: "2026-09-10T09:00:00.000Z",
    }),
  ]),
  past("retro:2", "2026-09-15", [card("b1", "Staging data out of date")]),
  past("retro:3", "2026-09-29", [
    card("c1", "Waited two days for staging"),
    card("c2", "Lunch was great"),
  ]),
];

const panel = () => screen.getByRole("region", { name: "Recurring themes" });
const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <RetroActionsTracker />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

beforeEach(() => {
  exported.markdown = "";
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  useWorkspaceStore.setState({
    retroBoards: BOARDS,
    impediments: [],
    kanbanBoards: [],
    sprints: [],
    teamMembers: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
  useWorkspaceStore.setState({ retroBoards: [] });
});

describe("recurring themes", () => {
  it("waits for three past retros", () => {
    useWorkspaceStore.setState({ retroBoards: BOARDS.slice(0, 2) });
    renderPage();
    expect(
      within(panel()).getByText("Hold 1 more past retro to see the themes that keep coming up.")
    ).toBeInTheDocument();
  });

  it("lists what three retros raised, and what came back after its action was done", () => {
    renderPage();
    const list = within(panel());
    expect(list.getByText("staging")).toBeInTheDocument();
    expect(list.getByText(/· 3 retros · 4 cards/)).toBeInTheDocument();
    expect(
      list.getByText(/Came back after done: “Fix staging data” was done on 10 Sep/)
    ).toBeInTheDocument();
    expect(list.getByText(/1 came back after an action on it was marked done/)).toBeInTheDocument();
    expect(list.queryByText(/Lunch/)).toBeNull();
    expect(list.getByText("Waited two days for staging", { exact: false })).toBeInTheDocument();
  });

  it("puts the themes in the export", () => {
    renderPage();
    expect(exported.markdown).toContain("## Recurring themes");
    expect(exported.markdown).toContain("came back after “Fix staging data” was done");
  });

  it("finds themes without AI when Amr isn't on", () => {
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Find themes without AI" }));
    expect(within(panel()).getByText(/Amr wasn't available/)).toBeInTheDocument();
    expect(within(panel()).getByText("staging")).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Show the shared words instead" }));
    expect(within(panel()).getByRole("button", { name: "Show Amr's themes" })).toBeInTheDocument();
  });

  it("reads Amr's themes back through the short ids, keeping only those across three retros", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        task: string;
        input: { cards: { id: string; r: number; text: string }[] };
      };
      expect(body.task).toBe("retro-actions.themes");
      // Text and retro numbers only: never the board's own ids.
      expect(JSON.stringify(body.input)).not.toContain("retro:1");
      expect(body.input.cards.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
      return new Response(
        JSON.stringify({
          ok: true,
          source: "ai",
          data: {
            themes: [
              { name: "Staging we can't trust", cardIds: ["c1", "c3", "c4"], count: 3 },
              { name: "Two retros only", cardIds: ["c2", "c5"], count: 2 },
              { name: "Made up", cardIds: ["c99"], count: 1 },
            ],
          },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Ask Amr to name the themes" }));
    await waitFor(() =>
      expect(within(panel()).getByText("Staging we can't trust")).toBeInTheDocument()
    );
    expect(
      within(panel()).getByText(/Grouped by Amr across your last 3 retros/)
    ).toBeInTheDocument();
    expect(within(panel()).queryByText("Two retros only")).toBeNull();
    expect(within(panel()).queryByText("Made up")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writes each theme as a line of Markdown", () => {
    const lines = themesToMarkdown(recurringThemes(BOARDS), (id) => id.replace("retro:", "Retro "));
    expect(lines[0]).toBe("## Recurring themes");
    expect(lines[2]).toBe(
      "- **staging**: 3 retros (Retro 1, Retro 2, Retro 3), 4 cards — came back after “Fix staging data” was done"
    );
    expect(themesToMarkdown([], () => "")).toEqual([]);
  });
});
