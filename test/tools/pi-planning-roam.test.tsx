import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * PI Planning's ROAM board, confidence vote and predictability (P2.6b):
 * risks sorted by a status picker and by suggestions (with Undo); owned and
 * mitigated risks logged in the Risk Register, rated first, with Undo; a
 * confidence round saved as totals only (Undo, a withheld round, a team's
 * scope), through a stubbed VoteRoundPanel; votes kept when their team
 * goes; actual values, the band, and closing a PI with Undo and a cheer.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
const logs = vi.hoisted(() => ({ calls: [] as [string, Record<string, unknown> | undefined][] }));
const cheers = vi.hoisted(() => ({ cheer: vi.fn() }));
type Asked = { id: string; title: string; questions: { id: string; text: string }[] };
const panel = vi.hoisted(() => ({
  props: null as null | {
    tool: string;
    kind?: string;
    toolName: string;
    questionnaire: Asked | null;
    minN?: number;
    onSave: (r: unknown) => false | void | (() => void);
    onLiveChange?: unknown;
  },
  undo: null as null | (() => void),
  /** A closed round of `q`, as the kit hands it to onSave. */
  resultOf: (q: Asked | null, distribution: number[] | null, ballots: number, minN = 3) => ({
    roundId: "round-1",
    tool: "quick-vote",
    questionnaireId: q?.id ?? "qv:confidence",
    title: q?.title ?? "",
    scale: { id: "qv:scale", points: [] },
    closedAt: "2026-11-23T09:00:00.000Z",
    minN,
    ballots,
    source: "live",
    questions: [{ id: "q1", text: q?.title ?? "", responses: ballots, distribution }],
  }),
}));

vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.calls.push([action, payload]),
  }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: cheers.cheer }));
vi.mock("@/components/collab/vote-room", () => ({
  VoteRoundPanel: (props: NonNullable<typeof panel.props>) => {
    panel.props = props;
    const result = (distribution: number[] | null, ballots: number) =>
      panel.resultOf(props.questionnaire, distribution, ballots, props.minN ?? 3);
    const save = (r: unknown) => {
      const out = props.onSave(r);
      panel.undo = typeof out === "function" ? out : null;
    };
    return (
      <div>
        <p>Asks: {props.questionnaire?.title ?? "nothing"}</p>
        <button type="button" onClick={() => save(result([0, 1, 3, 5, 2], 11))}>
          Save counted round
        </button>
        <button type="button" onClick={() => save(result(null, 2))}>
          Save withheld round
        </button>
      </div>
    );
  },
}));

import { PiPlanningClient } from "@/app/(tools)/pi-planning/pi-planning-client";
import {
  PI_STORAGE_KEY,
  normalizePiState,
  type PiItem,
  type PiState,
} from "@/app/(tools)/pi-planning/store";
import { toMarkdown } from "@/app/(tools)/pi-planning/markdown";
import { buildExample, withoutExample } from "@/app/(tools)/pi-planning/example";
import { validatePiSettings } from "@/app/(tools)/pi-planning/predictability-section";
import { validateRiskRatings, validateRoamDetails } from "@/app/(tools)/pi-planning/roam-section";
import { PI_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import { QUESTION_MAX } from "@/lib/quick-vote/draft";

const stored = (): PiState => normalizePiState(JSON.parse(localStorage.getItem(PI_STORAGE_KEY)!));
const seedBoard = (s: unknown) => localStorage.setItem(PI_STORAGE_KEY, JSON.stringify(s));

const risk = (id: string, extra: Partial<PiItem> = {}): PiItem => ({
  id,
  title: id,
  teamId: "t1",
  iteration: 0,
  kind: "risk",
  ...extra,
});
const board = (over: Partial<PiState> = {}): PiState => ({
  teams: [
    { id: "t1", name: "Checkout", velocity: 10 },
    { id: "t2", name: "Payments", velocity: 8 },
  ],
  items: [],
  iterations: 3,
  objectives: [],
  ...over,
});

const renderBoard = () =>
  render(
    <TooltipProvider>
      <PiPlanningClient />
    </TooltipProvider>
  );
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());
/** A SectionCard of the page, by its title. */
const section = (name: string) =>
  screen.getByRole("heading", { name }).closest(".panel") as HTMLElement;
const logged = (action: string) => logs.calls.filter(([a]) => a === action).map(([, p]) => p);

beforeEach(() => {
  toastSpy.mockReset();
  cheers.cheer.mockReset();
  logs.calls = [];
  panel.props = null;
  panel.undo = null;
  localStorage.clear();
  useWorkspaceStore.setState({ dependencyMaps: [], teamMembers: [], sosEntries: [], risks: [] });
});

/* ── ROAM ─────────────────────────────────────────────────────────────── */

describe("Risks: ROAM", () => {
  it("groups the risks, sorts one from a status picker, and badges it on the board", () => {
    seedBoard(
      board({
        items: [
          risk("PCI audit could slip"),
          risk("Vendor late", { roam: "owned", roamOwner: "Sam", teamId: "t2" }),
        ],
      })
    );
    renderBoard();
    const roam = section("Risks: ROAM");
    expect(within(roam).getByText("2 risks: 1 owned; 1 still to sort.")).toBeInTheDocument();
    expect(within(roam).getByRole("heading", { name: "To sort (1)" })).toBeInTheDocument();
    expect(within(roam).getByRole("heading", { name: "Owned (1)" })).toBeInTheDocument();
    expect(screen.getByText("ROAM: To sort")).toBeInTheDocument();

    fireEvent.change(within(roam).getByLabelText("ROAM status for PCI audit could slip"), {
      target: { value: "accepted" },
    });
    expect(stored().items[0].roam).toBe("accepted");
    expect(screen.getByText("ROAM: Accepted")).toBeInTheDocument();
    expect(logged(PI_PLANNING_ACTIONS.RISK_ROAMED)).toEqual([
      { riskId: "PCI audit could slip", roam: "accepted" },
    ]);

    // Back to sort clears the status.
    fireEvent.change(within(roam).getByLabelText("ROAM status for PCI audit could slip"), {
      target: { value: "" },
    });
    expect(stored().items[0]).not.toHaveProperty("roam");
  });

  it("keeps an owner and a note on a risk", () => {
    seedBoard(board({ items: [risk("Audit", { roam: "owned" })] }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Owner and note for Audit" }));
    const form = screen.getByRole("button", { name: "Save owner and note" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Owner/), { target: { value: " Priya " } });
    fireEvent.change(within(form).getByLabelText(/^Note/), {
      target: { value: "Book the auditor early" },
    });
    fireEvent.submit(form);
    expect(stored().items[0]).toMatchObject({
      roamOwner: "Priya",
      roamNote: "Book the auditor early",
    });
    expect(screen.getByText("Book the auditor early")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Owner and note for Audit" })).toHaveFocus();
  });

  it("never stores half an emoji in a risk's owner", () => {
    seedBoard(board({ items: [risk("Audit", { roam: "owned" })] }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Owner and note for Audit" }));
    const form = screen.getByRole("button", { name: "Save owner and note" }).closest("form")!;
    // The emoji straddles the 120-unit cap: a plain slice would keep its first half.
    fireEvent.change(within(form).getByLabelText(/^Owner/), {
      target: { value: `${"a".repeat(119)}😀` },
    });
    fireEvent.submit(form);
    expect(stored().items[0].roamOwner).toBe("a".repeat(119));
    expect(localStorage.getItem(PI_STORAGE_KEY)).not.toContain("\\ud83d");
  });

  it("logs an owned risk in the Risk Register once it's rated, with Undo", () => {
    seedBoard(
      board({
        items: [risk("Audit", { roam: "owned", roamOwner: "Priya", roamNote: "Book early" })],
      })
    );
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Log Audit in the Risk Register" }));
    const form = screen.getByRole("button", { name: "Add to the Risk Register" }).closest("form")!;
    fireEvent.submit(form);
    expect(within(form).getByText("Rate how likely it is.")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().risks ?? []).toEqual([]);

    const pick = (group: string, value: string) =>
      fireEvent.click(
        within(within(form).getByRole("radiogroup", { name: group })).getByRole("radio", {
          name: value,
        })
      );
    pick("Likelihood", "4");
    pick("Impact", "3");
    fireEvent.submit(form);

    const risks = useWorkspaceStore.getState().risks ?? [];
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({
      title: "Audit",
      probability: 4,
      impact: 3,
      owner: "Priya",
      mitigation: "Book early",
      sourceRef: { tool: "pi-planning", id: "Audit" },
    });
    expect(stored().items[0].sentTo).toEqual([
      expect.objectContaining({ route: "risk", targetId: risks[0].id }),
    ]);
    expect(screen.getByRole("link", { name: "In the Risk Register" })).toHaveAttribute(
      "href",
      "/risk-register"
    );

    undoLast();
    expect(useWorkspaceStore.getState().risks ?? []).toEqual([]);
    expect(stored().items[0]).not.toHaveProperty("sentTo");
    expect(
      screen.getByRole("button", { name: "Log Audit in the Risk Register" })
    ).toBeInTheDocument();
  });

  it("offers the Risk Register for owned and mitigated risks only, never the example's", () => {
    seedBoard(
      board({
        items: [
          risk("A", { roam: "mitigated" }),
          risk("B", { roam: "accepted" }),
          risk("C", { roam: "resolved" }),
          risk("D"),
          risk("example-pi-x", { title: "Example risk", roam: "owned" }),
        ],
      })
    );
    renderBoard();
    expect(screen.getByRole("button", { name: "Log A in the Risk Register" })).toBeInTheDocument();
    for (const name of ["B", "C", "D", "Example risk"]) {
      expect(
        screen.queryByRole("button", { name: `Log ${name} in the Risk Register` })
      ).not.toBeInTheDocument();
    }
  });

  it("suggests ROAM by keywords for the risks to sort, accepted one at a time with Undo", async () => {
    seedBoard(
      board({
        items: [
          risk("Vendor contract needs legal sign-off"),
          risk("Search might be slower"),
          risk("Done one", { roam: "resolved" }),
        ],
      })
    );
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Suggest from keywords" }));
    const list = await screen.findByRole("region", { name: "ROAM to check" });
    expect(
      within(list).getByText("Vendor contract needs legal sign-off: Owned")
    ).toBeInTheDocument();
    expect(within(list).getByText("Search might be slower: Accepted")).toBeInTheDocument();
    expect(within(list).queryByText(/Done one/)).not.toBeInTheDocument();

    fireEvent.click(
      within(list).getByRole("button", { name: "Set: Search might be slower: Accepted" })
    );
    expect(stored().items[1].roam).toBe("accepted");
    expect(logged(PI_PLANNING_ACTIONS.RISK_ROAMED)).toEqual([
      { riskId: "Search might be slower", roam: "accepted", suggested: true },
    ]);
    undoLast();
    expect(stored().items[1]).not.toHaveProperty("roam");
  });

  it("says how to start when the board has no risks", () => {
    seedBoard(board());
    renderBoard();
    expect(
      within(section("Risks: ROAM")).getByText(/No risks on the board yet/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suggest from keywords" })).not.toBeInTheDocument();
  });
});

/* ── Confidence vote ──────────────────────────────────────────────────── */

describe("Confidence vote", () => {
  it("runs on Quick Vote's room with the confidence format, and never tells Quick Vote", async () => {
    seedBoard(board());
    renderBoard();
    await screen.findByRole("button", { name: "Save counted round" });
    expect(panel.props).toMatchObject({
      tool: "quick-vote",
      kind: "scale",
      toolName: "PI Planning",
      minN: 3,
    });
    expect(panel.props?.questionnaire?.title).toBe(
      "How confident are you that we'll meet this PI's objectives?"
    );
    expect(panel.props?.onLiveChange).toBeUndefined();
  });

  it("saves the totals only, shows the average and the rule, and Undo takes it back", async () => {
    seedBoard(board());
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Save counted round" }));
    expect(stored().confidence).toEqual([
      {
        id: expect.any(String),
        at: "2026-11-23T09:00:00.000Z",
        scope: "train",
        scopeName: "Whole train",
        counts: [0, 1, 3, 5, 2],
        ballots: 11,
        source: "live",
      },
    ]);
    const card = section("Confidence vote");
    expect(
      within(card).getByText(/Whole train · .* · 11 votes · average 3\.7 of 5/)
    ).toBeInTheDocument();
    expect(
      within(card).getByText("1 vote under 3: talk it through before you commit.")
    ).toBeInTheDocument();
    expect(logged(PI_PLANNING_ACTIONS.CONFIDENCE_SAVED)).toEqual([
      { voteId: expect.any(String), scope: "train", votes: 11, average: 3.7 },
    ]);

    act(() => panel.undo?.());
    expect(stored().confidence).toEqual([]);
  });

  it("saves a 21st vote over the cap, and Undo brings back the one the cap dropped", async () => {
    const kept = Array.from({ length: 20 }, (_, i) => ({
      id: `v${i + 1}`,
      at: `2026-11-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`,
      scope: "train",
      scopeName: "Whole train",
      counts: [0, 0, 1, 2, 1],
      ballots: 4,
      source: "facilitator" as const,
    }));
    seedBoard(board({ confidence: kept }));
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Save counted round" }));
    const after = stored().confidence ?? [];
    expect(after).toHaveLength(20);
    expect(after[0].id).toBe("v2");
    expect(after[19].counts).toEqual([0, 1, 3, 5, 2]);

    act(() => panel.undo?.());
    expect(stored().confidence?.map((v) => v.id)).toEqual(kept.map((v) => v.id));
  });

  it("stores nothing for a withheld round, and says why", async () => {
    seedBoard(board());
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Save withheld round" }));
    expect(panel.undo).toBeNull();
    expect(stored().confidence ?? []).toEqual([]);
    expect(
      screen.getByText(
        "Fewer than 3 people answered, so the totals stay hidden and nothing was saved."
      )
    ).toHaveAttribute("role", "status");
  });

  it("asks one team, and files the vote under it", async () => {
    seedBoard(board());
    renderBoard();
    await screen.findByRole("button", { name: "Save counted round" });
    fireEvent.change(screen.getByLabelText(/^Who votes/), { target: { value: "t2" } });
    expect(
      screen.getByText("Asks: How confident are you that Payments will meet its PI objectives?")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save counted round" }));
    expect(stored().confidence?.[0]).toMatchObject({ scope: "t2", scopeName: "Payments" });
  });

  it("fits a long team name into the question, and files a round under the team it asked", async () => {
    // 64 characters in common: both questions shorten to the same words.
    const long = "Platform engineering and developer experience for the payments a";
    seedBoard(
      board({
        teams: [
          { id: "t1", name: `${long}rea one` },
          { id: "t2", name: `${long}rea two` },
        ],
      })
    );
    renderBoard();
    await screen.findByRole("button", { name: "Save counted round" });
    fireEvent.change(screen.getByLabelText(/^Who votes/), { target: { value: "t1" } });
    const asked = panel.props!.questionnaire!;
    expect(asked.title).toMatch(
      /^How confident are you that Platform engineering .*… will meet its PI objectives\?$/
    );
    expect(Array.from(asked.title).length).toBeLessThanOrEqual(QUESTION_MAX);
    expect(asked.id).toBe("qv:confidence:pi-t1");

    // The host picks the other team while that round is still open: it reads the same.
    fireEvent.change(screen.getByLabelText(/^Who votes/), { target: { value: "t2" } });
    expect(panel.props!.questionnaire!.title).toBe(asked.title);
    act(() => {
      panel.props!.onSave(panel.resultOf(asked, [0, 0, 1, 2, 1], 4));
    });
    expect(stored().confidence?.[0]).toMatchObject({ scope: "t1", scopeName: `${long}rea one` });
    fireEvent.click(screen.getByRole("button", { name: "Save counted round" }));
    expect(stored().confidence?.[1]).toMatchObject({ scope: "t2", scopeName: `${long}rea two` });
  });

  it("keeps a team's votes when the team goes, under the name they were saved with", async () => {
    seedBoard(
      board({
        items: [risk("r1", { roam: "owned" })],
        objectives: [{ id: "o1", teamId: "t1", title: "Guest checkout", committed: true }],
        confidence: [
          {
            id: "v1",
            at: "2026-11-20T09:00:00.000Z",
            scope: "t1",
            scopeName: "Checkout",
            counts: [0, 0, 1, 2, 1],
            ballots: 4,
            source: "facilitator",
          },
        ],
        history: [
          {
            id: "h1",
            name: "PI 2026.2",
            closedAt: "2026-08-01",
            teams: [{ teamId: "t1", name: "Checkout", plannedBv: 10, actualBv: 9 }],
          },
        ],
      })
    );
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Remove team Checkout" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Its 1 item and 1 objective go with it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove team" }));
    expect(stored().teams.map((t) => t.id)).toEqual(["t2"]);
    expect(stored().items).toEqual([]);
    expect(stored().confidence?.map((v) => v.id)).toEqual(["v1"]);
    expect(stored().history?.map((r) => r.id)).toEqual(["h1"]);
    expect(await screen.findByText(/^Checkout · .* · 4 votes/)).toBeInTheDocument();
  });

  it("still shows, exports and deletes the kept votes and closed PIs once the last team goes", async () => {
    seedBoard(
      board({
        teams: [{ id: "t1", name: "Checkout", velocity: 10 }],
        confidence: [
          {
            id: "v1",
            at: "2026-11-20T09:00:00.000Z",
            scope: "t1",
            scopeName: "Checkout",
            counts: [0, 0, 1, 2, 1],
            ballots: 4,
            source: "facilitator",
          },
        ],
        history: [
          {
            id: "h1",
            name: "PI 2026.2",
            closedAt: "2026-08-01",
            teams: [{ teamId: "t1", name: "Checkout", plannedBv: 10, actualBv: 9 }],
          },
        ],
      })
    );
    renderBoard();
    // A team with no items or objectives goes at once, with Undo.
    fireEvent.click(screen.getByRole("button", { name: "Remove team Checkout" }));
    expect(stored().teams).toEqual([]);
    expect(screen.getByText(/^No teams on the board yet/)).toBeInTheDocument();
    expect(await screen.findByText(/^Checkout · .* · 4 votes/)).toBeInTheDocument();
    expect(
      within(section("Predictability")).getByRole("list", { name: "Closed PIs" })
    ).toHaveTextContent("PI 2026.2");

    const md = toMarkdown(stored(), { nodes: [], edges: [] }, "2026-11-23");
    expect(md).toContain("No teams on the board yet.");
    expect(md).toContain("## Confidence vote");
    expect(md).toContain("| Checkout | 4 |");
    expect(md).toContain("### Closed PIs");
    expect(md).toContain("| PI 2026.2 |");
    expect(md).not.toContain("## Predictability\n\nNo teams");

    fireEvent.click(
      within(section("Predictability")).getByRole("button", {
        name: "Delete PI 2026.2 from the history",
      })
    );
    expect(stored().history).toEqual([]);
    undoLast();
    expect(stored().history?.map((r) => r.id)).toEqual(["h1"]);
    fireEvent.click(screen.getByRole("button", { name: /^Delete the Checkout vote/ }));
    expect(stored().confidence).toEqual([]);
    undoLast();
    expect(stored().confidence?.map((v) => v.id)).toEqual(["v1"]);
  });

  it("deletes a saved vote with Undo", async () => {
    seedBoard(
      board({
        confidence: [
          {
            id: "v1",
            at: "2026-11-20T09:00:00.000Z",
            scope: "train",
            scopeName: "Whole train",
            counts: [0, 0, 1, 2, 1],
            ballots: 4,
            source: "facilitator",
          },
        ],
      })
    );
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete the Whole train vote/ }));
    expect(stored().confidence).toEqual([]);
    undoLast();
    expect(stored().confidence?.map((v) => v.id)).toEqual(["v1"]);
  });
});

/* ── Predictability ───────────────────────────────────────────────────── */

describe("Predictability", () => {
  const scoredBoard = () =>
    board({
      name: "PI 2026.4",
      objectives: [
        { id: "o1", teamId: "t1", title: "Guests check out", committed: true, businessValue: 10 },
        { id: "o2", teamId: "t2", title: "Refunds", committed: true, businessValue: 8 },
      ],
    });

  it("scores an objective's actual value, and reads the team against the band", () => {
    seedBoard(scoredBoard());
    renderBoard();
    const card = section("Predictability");
    expect(within(card).getByRole("button", { name: "Close this PI" })).toBeDisabled();
    fireEvent.change(within(card).getByLabelText("Actual value of Guests check out"), {
      target: { value: "9" },
    });
    expect(stored().objectives?.[0].actualBusinessValue).toBe(9);
    expect(logged(PI_PLANNING_ACTIONS.OBJECTIVE_SCORED)).toEqual([
      { objectiveId: "o1", planned: 10, actual: 9 },
    ]);
    expect(
      within(card).getByText(
        "Checkout 90% against an aim of 80–100%. Payments has 1 objective to score."
      )
    ).toBeInTheDocument();
    // Not scored again.
    fireEvent.change(within(card).getByLabelText("Actual value of Guests check out"), {
      target: { value: "" },
    });
    expect(stored().objectives?.[0]).not.toHaveProperty("actualBusinessValue");
  });

  it("closes the PI into the history with a cheer, keeps the board, and Undo takes it back", () => {
    const s = scoredBoard();
    s.objectives![0].actualBusinessValue = 9;
    seedBoard(s);
    renderBoard();
    const card = section("Predictability");
    fireEvent.click(within(card).getByRole("button", { name: "Close this PI" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("It keeps Checkout (90%) in the history below.");
    expect(dialog).toHaveTextContent("Payments isn't scored yet, so it's left out.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close this PI" }));

    expect(stored().history).toEqual([
      {
        id: expect.any(String),
        name: "PI 2026.4",
        closedAt: expect.any(String),
        teams: [{ teamId: "t1", name: "Checkout", plannedBv: 10, actualBv: 9 }],
      },
    ]);
    // The board stays as it was.
    expect(stored().objectives?.[0].actualBusinessValue).toBe(9);
    expect(cheers.cheer).toHaveBeenCalledWith("pi-planning", "milestone");
    expect(logged(PI_PLANNING_ACTIONS.PI_CLOSED)).toEqual([
      { recordId: expect.any(String), predictability: 90, teams: 1 },
    ]);
    expect(within(card).getByRole("list", { name: "Closed PIs" })).toHaveTextContent("PI 2026.4");
    expect(within(card).getByText("The average shows once 3 PIs are closed.")).toBeInTheDocument();

    undoLast();
    expect(stored().history).toEqual([]);
  });

  it("warns before closing an unchanged PI a second time", () => {
    const s = scoredBoard();
    s.objectives![0].actualBusinessValue = 9;
    seedBoard(s);
    renderBoard();
    const card = section("Predictability");
    const openClose = () =>
      fireEvent.click(within(card).getByRole("button", { name: "Close this PI" }));
    openClose();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("already in the history");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close this PI" })
    );
    expect(stored().history).toHaveLength(1);

    // The board stays as it was, so closing again would only repeat it.
    openClose();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "PI 2026.4 is already in the history with these numbers. Closing it again keeps a second copy, which counts twice in the average."
    );
    expect(within(dialog).getByRole("button", { name: "Close it again" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(stored().history).toHaveLength(1);

    // A changed score is something new to keep: no warning.
    fireEvent.change(within(card).getByLabelText("Actual value of Guests check out"), {
      target: { value: "10" },
    });
    openClose();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("already in the history");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close this PI" })
    );
    expect(stored().history?.map((r) => r.teams[0].actualBv)).toEqual([9, 10]);
  });

  it("closes a 13th PI over the cap, and Undo brings back the one the cap dropped", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      id: `h${i + 1}`,
      name: `PI h${i + 1}`,
      closedAt: "2026-06-01",
      teams: [{ teamId: "t1", name: "Checkout", plannedBv: 10, actualBv: 8 }],
    }));
    const s = { ...scoredBoard(), history: twelve };
    s.objectives![0].actualBusinessValue = 9;
    seedBoard(s);
    renderBoard();
    fireEvent.click(
      within(section("Predictability")).getByRole("button", { name: "Close this PI" })
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close this PI" })
    );
    const after = stored().history ?? [];
    expect(after).toHaveLength(12);
    expect(after[0].id).toBe("h2");
    expect(after[11].name).toBe("PI 2026.4");

    undoLast();
    expect(stored().history?.map((r) => r.id)).toEqual(twelve.map((r) => r.id));
  });

  it("saves the PI's name and the train's own band, and refuses a band the wrong way round", () => {
    seedBoard(scoredBoard());
    renderBoard();
    const form = screen.getByRole("button", { name: "Save name and aim" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Aim from/), { target: { value: "95" } });
    fireEvent.change(within(form).getByLabelText(/^Aim to/), { target: { value: "90" } });
    fireEvent.submit(form);
    expect(
      within(form).getByText("The upper end can't be below the lower one.")
    ).toBeInTheDocument();
    expect(stored()).not.toHaveProperty("band");
    fireEvent.change(within(form).getByLabelText(/^Aim from/), { target: { value: "70" } });
    fireEvent.change(within(form).getByLabelText(/^PI name/), { target: { value: "PI 2027.1" } });
    fireEvent.submit(form);
    expect(stored()).toMatchObject({ name: "PI 2027.1", band: { low: 70, high: 90 } });
  });

  it("keeps focus in the name and aim form when it saves, and says it saved", () => {
    seedBoard(scoredBoard());
    renderBoard();
    const form = screen.getByRole("button", { name: "Save name and aim" }).closest("form")!;
    const name = within(form).getByLabelText(/^PI name/);
    name.focus();
    fireEvent.change(name, { target: { value: " PI 2027.1 " } });
    fireEvent.submit(form);
    expect(stored().name).toBe("PI 2027.1");
    // The same field, still focused (the form isn't remounted), showing what was kept.
    expect(name).toBeInTheDocument();
    expect(name).toHaveFocus();
    expect(name).toHaveValue("PI 2027.1");
    const status = within(form).getByRole("status");
    expect(status).toHaveTextContent("Saved the PI's name and aim.");
    fireEvent.change(name, { target: { value: "PI 2027.2" } });
    expect(status).toHaveTextContent("");

    // A cleared band saves as the common aim, and the fields say so.
    fireEvent.change(within(form).getByLabelText(/^Aim from/), { target: { value: "" } });
    fireEvent.change(within(form).getByLabelText(/^Aim to/), { target: { value: "" } });
    fireEvent.submit(form);
    expect(stored()).not.toHaveProperty("band");
    expect(within(form).getByLabelText(/^Aim from/)).toHaveValue(80);
    expect(within(form).getByLabelText(/^Aim to/)).toHaveValue(100);
  });

  it("deletes a closed PI with Undo, and averages from three", () => {
    const rec = (id: string, actual: number) => ({
      id,
      name: `PI ${id}`,
      closedAt: "2026-06-01",
      teams: [{ teamId: "t1", name: "Checkout", plannedBv: 10, actualBv: actual }],
    });
    seedBoard(board({ history: [rec("a", 8), rec("b", 9), rec("c", 10)] }));
    renderBoard();
    const card = section("Predictability");
    expect(within(card).getByText("Average over 3 closed PIs: 90%.")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Delete PI b from the history" }));
    expect(stored().history?.map((r) => r.id)).toEqual(["a", "c"]);
    expect(within(card).getByText("The average shows once 3 PIs are closed.")).toBeInTheDocument();
    undoLast();
    expect(stored().history?.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

/* ── Validation, example and Markdown ─────────────────────────────────── */

describe("forms", () => {
  it("need both ratings before a risk goes to the Risk Register", () => {
    expect(validateRiskRatings({ likelihood: null, impact: 3 })).toEqual({
      ok: false,
      errors: { likelihood: "Rate how likely it is." },
    });
    expect(validateRiskRatings({ likelihood: 2, impact: 3 })).toEqual({
      ok: true,
      values: { likelihood: 2, impact: 3 },
    });
  });

  it("cut the owner, note and PI name to their caps without splitting a character", () => {
    const emoji = "😀"; // two UTF-16 units, straddling each cap below
    expect(
      validateRoamDetails({
        owner: ` ${"a".repeat(119)}${emoji}`,
        note: `${"b".repeat(999)}${emoji}`,
      })
    ).toEqual({ ok: true, values: { owner: "a".repeat(119), note: "b".repeat(999) } });
    expect(validateRoamDetails({ owner: "  ", note: "" })).toEqual({ ok: true, values: {} });
    expect(validatePiSettings({ name: `${"c".repeat(79)}${emoji}`, low: "", high: "" })).toEqual({
      ok: true,
      values: { name: "c".repeat(79) },
    });
  });

  it("take a band of whole percentages, or both ends blank for the common aim", () => {
    expect(validatePiSettings({ name: "", low: "", high: "" })).toEqual({ ok: true, values: {} });
    expect(validatePiSettings({ name: " PI 1 ", low: "80", high: "100" })).toEqual({
      ok: true,
      values: { name: "PI 1", band: { low: 80, high: 100 } },
    });
    const bad = validatePiSettings({ name: "", low: "80.5", high: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["high", "low"]);
    expect(validatePiSettings({ name: "", low: "0", high: "201" }).ok).toBe(false);
  });
});

describe("example and Markdown", () => {
  it("owns the PCI risk, carries a vote and a closed PI, and clears them with the example", () => {
    const { state } = buildExample(new Date(2026, 10, 23));
    const pci = state.items.find((i) => i.title === "PCI audit could slip the release");
    expect(pci).toMatchObject({ roam: "owned", roamOwner: expect.any(String) });
    expect(state.confidence?.[0].counts).toEqual([0, 1, 3, 5, 2]);
    expect(state.history).toHaveLength(1);
    expect(state.objectives?.some((o) => o.actualBusinessValue !== undefined)).toBe(true);

    const mine = {
      id: "mine",
      at: "2026-11-22T00:00:00Z",
      scope: "train",
      scopeName: "Whole train",
      counts: [0, 0, 1, 0, 0],
      ballots: 1,
      source: "facilitator" as const,
    };
    const onExampleTeam = { ...mine, id: "theirs", scope: state.teams[0].id };
    const cleared = withoutExample({
      ...state,
      confidence: [...(state.confidence ?? []), mine, onExampleTeam],
      history: [
        ...(state.history ?? []),
        { id: "kept", name: "Mine", closedAt: "2026-01-01", teams: [] },
      ],
    });
    expect(cleared.confidence?.map((v) => v.id)).toEqual(["mine"]);
    expect(cleared.history?.map((r) => r.id)).toEqual(["kept"]);
    // A board that never had the lists doesn't gain them.
    expect(withoutExample({ teams: [], items: [], iterations: 5 })).not.toHaveProperty(
      "confidence"
    );
  });

  /** A vote or closed PI kept from a team the user removed. */
  const keptVote = (i: number) => ({
    id: `v${i}`,
    at: `2026-10-${String(i).padStart(2, "0")}T09:00:00.000Z`,
    scope: "gone",
    scopeName: "Old team",
    counts: [0, 0, 1, 2, 1],
    ballots: 4,
    source: "facilitator" as const,
  });
  const keptPi = (i: number) => ({
    id: `h${i}`,
    name: `PI h${i}`,
    closedAt: "2026-06-01",
    teams: [{ teamId: "gone", name: "Old team", plannedBv: 10, actualBv: 8 }],
  });

  it("loads the example behind full lists of the user's own, so the cap drops the example's", () => {
    const votes = Array.from({ length: 20 }, (_, i) => keptVote(i + 1));
    const closed = Array.from({ length: 12 }, (_, i) => keptPi(i + 1));
    seedBoard(board({ teams: [], confidence: votes, history: closed }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored().teams).toHaveLength(3);
    expect(stored().confidence?.map((v) => v.id)).toEqual(votes.map((v) => v.id));
    expect(stored().history?.map((r) => r.id)).toEqual(closed.map((r) => r.id));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().confidence?.map((v) => v.id)).toEqual(votes.map((v) => v.id));
    expect(stored().history?.map((r) => r.id)).toEqual(closed.map((r) => r.id));
  });

  it("keeps the user's own vote the latest when the example loads beside it", async () => {
    seedBoard(board({ teams: [], confidence: [keptVote(1)], history: [keptPi(1)] }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored().confidence?.map((v) => v.id)).toEqual([expect.any(String), "v1"]);
    expect(stored().history?.map((r) => r.id)).toEqual([expect.any(String), "h1"]);
    const latest = (await screen.findByRole("heading", { name: "Latest vote" })).parentElement!;
    expect(latest).toHaveTextContent(/^Latest voteOld team · /);
  });

  it("exports ROAM, the vote and predictability, leaving the objectives table as it was", () => {
    const { state } = buildExample(new Date(2026, 9, 23));
    const md = toMarkdown(state, { nodes: [], edges: [] }, "2026-10-23");
    expect(md).toContain(
      "| Payments | Finance sees payouts without a spreadsheet | Not scored | Committed |"
    );
    expect(md).toContain("## Risks (ROAM)");
    expect(md).toContain(
      "| Owned | PCI audit could slip the release | Checkout | Checkout's tech lead |"
    );
    expect(md).toContain("## Confidence vote");
    expect(md).toContain(
      "| Whole train | 11 | 3.7 | 0 | 1 | 3 | 5 | 2 | 1 vote under 3: talk it through before you commit. |"
    );
    expect(md).toContain("## Predictability");
    expect(md).toContain(
      "Checkout 94% and Payments 75% against an aim of 80–100%; the train 88%. Mobile has 1 objective to score."
    );
    expect(md).toContain("| Train | 24 | 21 | 88% |");
    expect(md).toContain("| PI 2026.2 |");
    // Sections come only when there's something to say.
    const bare = toMarkdown(board(), { nodes: [], edges: [] }, "2026-10-23");
    expect(bare).not.toContain("## Risks (ROAM)");
    expect(bare).not.toContain("## Confidence vote");
    expect(bare).not.toContain("## Predictability");
  });
});
