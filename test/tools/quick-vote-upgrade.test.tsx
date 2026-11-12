import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { registry } from "@/lib/actions/registry";
import { QUICK_VOTE_PRESETS } from "@/lib/quick-vote/presets";
import { QUICK_VOTE_INITIAL } from "@/lib/quick-vote/state";
import { draftFromPreset } from "@/lib/quick-vote/draft";
import { presetById } from "@/lib/quick-vote/presets";
import { hydrateQuickVote, useQuickVote } from "@/lib/quick-vote/store";
import { enterLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";

/**
 * Quick Vote (tools plan P1.4): sixteen formats one tap away, a form that
 * checks the round before it runs (never a default), Amr's option
 * suggestions only added when the host adds them, three ways to run it
 * (the vote kit's live room, a hand count, hold-up cards on phones), saved
 * results that keep totals only, with Undo on every delete, a guess's real
 * answer, value poker's value saved to its backlog item, hand-offs to the
 * Decision Log and the retro, the host's own formats, a read-only example,
 * and Amr's start_round showing on the page.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.push(args),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/quick-vote",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { QuickVoteClient } from "@/app/(tools)/quick-vote/quick-vote-client";
import { buildExample } from "@/app/(tools)/quick-vote/example";
import { validateFormatName } from "@/app/(tools)/quick-vote/save-format-form";
import { cardFace } from "@/app/(tools)/quick-vote/hold-up-cards";
import "@/lib/actions/tools/quick-vote";

/* ── Helpers ────────────────────────────────────────────────────────── */

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const ws = () => useWorkspaceStore.getState();
const qv = () => useQuickVote.getState();

async function renderPage() {
  const view = render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <QuickVoteClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
  await act(async () => {});
  return view;
}

const format = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const pickFormat = (name: string) => fireEvent.click(format(name));

/** Click Undo on the latest toast labelled `label`. */
function undo(label: string) {
  const call = [...toastSpy.mock.calls].reverse().find(([l]) => l === label) as
    | [string, { action: { onClick: () => void } }]
    | undefined;
  expect(call, `toast "${label}"`).toBeDefined();
  act(() => call?.[1].action.onClick());
}

function setDraftOf(id: Parameters<typeof presetById>[0], over: Record<string, unknown> = {}) {
  useQuickVote.setState({ draft: { ...draftFromPreset(presetById(id)!), ...over } });
}

/** Type the counts of the kit's count entry (scale rounds) and save. */
function tallyScale(counts: Record<string, string>) {
  for (const [label, n] of Object.entries(counts)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: n } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
  fireEvent.click(screen.getByRole("button", { name: "Save round" }));
}

/** Type Count hands' boxes (choice rounds) and save. */
function countHands(counts: Record<string, string>, people?: string) {
  for (const [text, n] of Object.entries(counts)) {
    fireEvent.change(
      screen.getByLabelText(new RegExp(`^(People who picked it|Dots on it): ${text}$`)),
      {
        target: { value: n },
      }
    );
  }
  if (people !== undefined) {
    fireEvent.change(screen.getByLabelText("People who answered"), { target: { value: people } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Save round" }));
}

beforeEach(async () => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  logs.length = 0;
  cheers.length = 0;
  vi.unstubAllEnvs();
  await hydrateQuickVote();
  useQuickVote.setState({ ...QUICK_VOTE_INITIAL });
  useWorkspaceStore.setState({ backlogItems: [], stories: [], retroBoards: [], decisions: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ── Formats and the form ───────────────────────────────────────────── */

describe("picking a format", () => {
  it("offers every format, with fist of five set up first and an empty results list", async () => {
    await renderPage();
    const group = screen.getByRole("group", { name: "Formats" });
    expect(within(group).getAllByRole("button")).toHaveLength(QUICK_VOTE_PRESETS.length);
    expect(format("Fist of five")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Set up: Fist of five" })).toBeInTheDocument();
    expect(screen.getByText(/No saved rounds yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    expect(screen.getByTestId("quick-vote-verdict")).toHaveTextContent("No results saved yet");
  });

  it("sets a format up in one tap, saved to the tool's store", async () => {
    await renderPage();
    pickFormat("Roman vote");
    expect(format("Roman vote")).toHaveAttribute("aria-pressed", "true");
    expect(format("Fist of five")).toHaveAttribute("aria-pressed", "false");
    expect(qv().draft).toMatchObject({ presetId: "roman", question: "Do we go ahead with this?" });
    // A format with its own answers shows them, with no options box.
    const answers = within(screen.getByRole("list", { name: "Answers" }));
    expect(answers.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Thumbs up",
      "Sideways",
      "Thumbs down",
    ]);
    expect(screen.queryByLabelText(/Options, one per line/)).toBeNull();
  });

  it("asks for the question instead of defaulting one, in the field and where it runs", async () => {
    await renderPage();
    const question = screen.getByLabelText(/^Question/);
    fireEvent.change(question, { target: { value: "  " } });
    fireEvent.blur(question);
    expect(screen.getByText("Type the question people answer.")).toBeInTheDocument();
    expect(
      screen.getByText("Finish setting up the round first: Type the question people answer.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show totals" })).toBeNull();
  });

  it("checks a poll's options, then offers the hand count with live rooms off", async () => {
    await renderPage();
    pickFormat("Poll");
    const box = screen.getByLabelText(/Options, one per line/);
    fireEvent.change(box, { target: { value: "Meeting room" } });
    fireEvent.blur(box);
    expect(screen.getAllByText(/Give at least 2 options, one per line\./).length).toBeGreaterThan(
      0
    );
    fireEvent.change(box, { target: { value: "- Meeting room\n- Cafe\n- Online" } });
    expect(screen.getByText(/Live rooms are off on this site/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Count hands: Which do you prefer?" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("People who picked it: Cafe")).toBeInTheDocument();
  });

  it("lets a poll take several picks, starting at two", async () => {
    await renderPage();
    pickFormat("Poll");
    fireEvent.click(screen.getByRole("radio", { name: "Several picks" }));
    expect(screen.getByLabelText(/^Most picks each/)).toHaveValue("2");
    expect(qv().draft).toMatchObject({ mode: "multi", limit: "2" });
  });

  it("fills a dot vote from the retro board or the backlog, with Undo", async () => {
    useWorkspaceStore.setState({
      backlogItems: [
        { id: "b1", name: "Search" },
        { id: "b2", name: "Exports" },
      ] as never,
      retroBoards: [
        {
          id: RETRO_CURRENT_ID,
          format: { id: "start-stop", columns: [] },
          phase: "vote",
          cards: [
            {
              id: "c1",
              columnKey: "x",
              text: "Flaky tests",
              votes: 1,
              groupedWith: null,
              isActionItem: false,
              assignee: "",
              discussing: false,
            },
            {
              id: "c2",
              columnKey: "x",
              text: "On-call",
              votes: 3,
              groupedWith: null,
              isActionItem: false,
              assignee: "",
              discussing: false,
            },
          ],
          userVotes: 0,
          timerSeconds: 0,
          timerRunning: false,
          discussingIndex: 0,
        },
      ] as never,
    });
    await renderPage();
    pickFormat("Dot voting");
    fireEvent.click(screen.getByRole("button", { name: "Use the retro board" }));
    expect(screen.getByLabelText(/Options, one per line/)).toHaveValue("On-call\nFlaky tests");
    undo("Filled the options from the retro board");
    expect(screen.getByLabelText(/Options, one per line/)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Use the backlog" }));
    expect(qv().draft?.optionsText).toBe("Search\nExports");
    expect(screen.getByLabelText(/^Dots each/)).toHaveValue("3");
  });

  it("suggests options without AI here, and adds only what the host adds, with Undo", async () => {
    await renderPage();
    pickFormat("Poll");
    fireEvent.change(screen.getByLabelText(/^Question/), {
      target: { value: "Should we keep the Friday demo?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    const list = within(screen.getByTestId("ai-suggestions"));
    expect(list.getByText("Suggested without AI. Check before you add.")).toBeInTheDocument();
    expect(qv().draft?.optionsText).toBe("");
    fireEvent.click(list.getByRole("button", { name: "Add: Yes" }));
    expect(qv().draft?.optionsText).toBe("Yes");
    fireEvent.click(list.getByRole("button", { name: "Add all 2" }));
    expect(qv().draft?.optionsText).toBe("Yes\nNo\nNot sure");
    undo("Added 2 options");
    expect(qv().draft?.optionsText).toBe("Yes");
  });

  it("asks for the question before it suggests options", async () => {
    await renderPage();
    pickFormat("Ranking");
    fireEvent.change(screen.getByLabelText(/^Question/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    expect(screen.getByText("Type the question first, then ask for options.")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-suggestions")).toBeNull();
  });

  it("edits a custom scale's labels and a guess's range, each checked", async () => {
    await renderPage();
    pickFormat("Custom scale");
    const labels = screen.getByLabelText(/Answers, lowest first/);
    expect(labels).toHaveValue("Low\nMedium\nHigh");
    fireEvent.change(labels, { target: { value: "Only one" } });
    fireEvent.blur(labels);
    expect(screen.getAllByText(/Give at least 2 answers/).length).toBeGreaterThan(0);
    pickFormat("Guess the number");
    fireEvent.change(screen.getByLabelText(/^Lowest answer/), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/^Highest answer/), { target: { value: "10" } });
    fireEvent.blur(screen.getByLabelText(/^Highest answer/));
    expect(
      screen.getAllByText(/The highest answer needs to be above the lowest\./).length
    ).toBeGreaterThan(0);
  });

  it("values a backlog item: the item sets the question", async () => {
    useWorkspaceStore.setState({ backlogItems: [{ id: "b1", name: "Search" }] as never });
    await renderPage();
    pickFormat("Value poker");
    fireEvent.change(screen.getByLabelText("Backlog item"), { target: { value: "b1" } });
    expect(qv().draft).toMatchObject({
      backlogItemId: "b1",
      question: "How much value does “Search” bring, compared with the others?",
    });
  });

  it("runs the feelings wheel in two steps", async () => {
    await renderPage();
    pickFormat("Feelings wheel");
    expect(
      within(screen.getByRole("list", { name: "Answers" })).getAllByRole("listitem")
    ).toHaveLength(6);
    fireEvent.click(screen.getByRole("radio", { name: "2. Worried" }));
    expect(screen.getByLabelText(/^Question/)).toHaveValue(
      "You picked worried: which word fits best?"
    );
    expect(
      within(screen.getByRole("list", { name: "Answers" })).getByText("Overwhelmed")
    ).toBeInTheDocument();
  });

  it("starts over from the format's own question and logs it", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText(/^Question/), { target: { value: "Something else?" } });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText(/^Question/)).toHaveValue("How much do you support this plan?");
    expect(logs.at(-1)).toEqual({ action: "round_reset", payload: { preset: "fist-of-five" } });
  });
});

/* ── Running and saving ─────────────────────────────────────────────── */

describe("running a round and saving its totals", () => {
  it("saves a fist of five counted by hand: totals only, logged, cheered, with Undo", async () => {
    await renderPage();
    tallyScale({ "3: I can go with it": "2", "4: I like it": "2", "5: Full support": "1" });
    const [saved] = qv().results;
    expect(saved).toMatchObject({
      presetId: "fist-of-five",
      result: { ballots: 5, source: "facilitator" },
    });
    expect(JSON.stringify(saved)).not.toMatch(/member|name|identity/i);
    expect(logs.at(-1)).toEqual({
      action: "result_saved",
      payload: { preset: "fist-of-five", kind: "scale", ballots: 5, source: "facilitator" },
    });
    expect(cheers).toEqual([["quick-vote", "agreed"]]);
    expect(screen.getByRole("list", { name: "Saved results, newest first" })).toHaveTextContent(
      "5 people answered. Average 3.8 of 5"
    );
    undo("Saved the round");
    expect(qv().results).toEqual([]);
  });

  it("doesn't cheer a vote with a concern in it", async () => {
    await renderPage();
    tallyScale({ "2: I have some concerns": "1", "4: I like it": "2" });
    expect(qv().results).toHaveLength(1);
    expect(cheers).toEqual([]);
  });

  it("counts hands for a Roman vote, refusing fewer than 3 people", async () => {
    await renderPage();
    pickFormat("Roman vote");
    countHands({ "Thumbs up": "1", Sideways: "1", "Thumbs down": "0" });
    expect(screen.getByRole("alert")).toHaveTextContent("Totals show from 3 people");
    expect(qv().results).toEqual([]);
    countHands({ "Thumbs up": "3", Sideways: "1", "Thumbs down": "0" });
    expect(qv().results[0]).toMatchObject({
      presetId: "roman",
      result: { kind: "choice", ballots: 4, source: "facilitator" },
    });
    expect(screen.getByText("Saved to the results below.")).toBeInTheDocument();
    undo("Saved the round");
    expect(qv().results).toEqual([]);
  });

  it("shows ESVP only from 5 people, like Psych Safety", async () => {
    await renderPage();
    pickFormat("ESVP");
    countHands({ Explorer: "2", Shopper: "1", Vacationer: "1", Prisoner: "0" });
    expect(screen.getByRole("alert")).toHaveTextContent("Totals show from 5 people");
    countHands({ Explorer: "2", Shopper: "1", Vacationer: "1", Prisoner: "1" });
    expect(qv().results[0].result.minN).toBe(5);
  });

  it("counts a dot vote against the people and their dots", async () => {
    setDraftOf("dots", { optionsText: "Tests\nDocs" });
    await renderPage();
    countHands({ Tests: "8", Docs: "2" }, "3");
    expect(screen.getByRole("alert")).toHaveTextContent("these add up to 10");
    countHands({ Tests: "6", Docs: "3" }, "3");
    expect(qv().results[0].result).toMatchObject({
      kind: "choice",
      mode: "dots",
      limit: 3,
      ballots: 3,
    });
  });

  it("won't hand a stricter format to a live room opened for 3 answers", async () => {
    await renderPage();
    let leave: () => void = () => {};
    act(() => {
      leave = enterLiveVisitorRoom();
    });
    pickFormat("ESVP");
    expect(
      screen.getByText(
        /ESVP shows results only from 5 answers, and the live room open in this browser shows them from 3/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("ESVP needs a live room of its own, one that shows results from 5 answers.")
    ).toBeInTheDocument();
    act(() => leave());
    expect(screen.queryByText(/ESVP shows results only from 5 answers/)).toBeNull();
  });
});

/* ── Hold-up cards ──────────────────────────────────────────────────── */

describe("hold-up cards", () => {
  it("shows the picked card face down, then big when tapped, and logs the round", async () => {
    await renderPage();
    pickFormat("Confidence vote");
    fireEvent.click(screen.getByRole("button", { name: "Open the cards" }));
    expect(logs.at(-1)).toEqual({
      action: "round_started",
      payload: { preset: "confidence", kind: "scale", mode: "cards" },
    });
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: /^4/ }));
    const card = dialog.getByRole("button", { name: "Your card, face down. Tap to show it." });
    expect(card).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(card);
    expect(
      dialog.getByRole("button", { name: "Your card: 4: Very. Tap to turn it face down." })
    ).toHaveTextContent("4Very");
    fireEvent.click(dialog.getByRole("button", { name: "Pick another card" }));
    expect(dialog.getByRole("group", { name: "Cards" })).toBeInTheDocument();
  });

  it("picks a feeling in two steps on the cards", async () => {
    await renderPage();
    pickFormat("Feelings wheel");
    fireEvent.click(screen.getByRole("button", { name: "Open the cards" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Calm" }));
    fireEvent.click(dialog.getByRole("button", { name: "Focused" }));
    fireEvent.click(dialog.getByRole("button", { name: "Your card, face down. Tap to show it." }));
    expect(dialog.getByRole("button", { name: /^Your card: Focused/ })).toBeInTheDocument();
  });

  it("isn't offered where each person needs their own answer", async () => {
    await renderPage();
    pickFormat("Ranking");
    expect(screen.queryByRole("button", { name: "Open the cards" })).toBeNull();
    expect(screen.getByText(/Ranking needs each person's own answer/)).toBeInTheDocument();
  });

  it("puts a scale's number big and its words under it", () => {
    expect(cardFace("3: I can go with it")).toEqual({ big: "3", small: "I can go with it" });
    expect(cardFace("Fist: I block this")).toEqual({ big: "Fist", small: "I block this" });
    expect(cardFace("Thumbs up")).toEqual({ big: "Thumbs up", small: null });
  });
});

/* ── Results ────────────────────────────────────────────────────────── */

const ex = buildExample(new Date("2026-11-12T12:00:00Z"));
const stored = ex.results.map((r, i) => ({ ...r, id: `qvr-${i}` }));

describe("saved results", () => {
  it("shows the totals on request, through the vote kit's own view", async () => {
    useQuickVote.setState({ results: stored });
    await renderPage();
    const toggle = screen.getAllByRole("button", { name: "Show the totals" })[0];
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("quick-vote-verdict")).toHaveTextContent("Latest, Fist of five");
  });

  it("deletes a result with Undo", async () => {
    useQuickVote.setState({ results: stored });
    await renderPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete the result “Which retro topics should we talk about first?”",
      })
    );
    expect(qv().results.map((r) => r.id)).toEqual(["qvr-0", "qvr-1", "qvr-3"]);
    undo("Deleted the result “Which retro topics should we talk about first?”");
    expect(qv().results.map((r) => r.id)).toEqual(["qvr-0", "qvr-1", "qvr-2", "qvr-3"]);
  });

  it("sends a result to the Decision Log as a proposed record, with its options in order", async () => {
    useQuickVote.setState({ results: [stored[2]] });
    await renderPage();
    const send = screen.getByRole("button", { name: /^Send to… Which retro topics/ });
    fireEvent.pointerDown(send, { button: 0, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Decision Log" }));
    const [decision] = ws().decisions;
    expect(decision).toMatchObject({
      title: "Which retro topics should we talk about first?: top: Flaky end-to-end tests (7)",
      status: "proposed",
      sourceRef: { tool: "quick-vote", id: "qvr-2" },
      recommendation: "Flaky end-to-end tests",
    });
    expect(qv().results[0].sentTo?.[0]).toMatchObject({ route: "decision", targetId: decision.id });
    expect(screen.getByRole("button", { name: /\(sent\)$/ })).toBeInTheDocument();
  });

  it("sends a result to the retro as a topic", async () => {
    useQuickVote.setState({ results: [stored[3]] });
    await renderPage();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /^Send to… How much was this Sprint Review/ }),
      {
        button: 0,
        pointerType: "mouse",
      }
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Retro topic" }));
    const board = (ws().retroBoards ?? []).find((b) => b.id === RETRO_CURRENT_ID);
    expect(board?.cards[0]).toMatchObject({
      text: "How much was this Sprint Review worth the time you gave it?: average 2.6 of 4",
      sourceRef: { tool: "quick-vote", id: "qvr-3" },
    });
  });

  it("adds a guess's real answer and says how close the guesses were", async () => {
    useQuickVote.setState({ results: [{ ...stored[1], realAnswer: undefined }] });
    await renderPage();
    const box = screen.getByLabelText("Real answer (days)");
    fireEvent.change(box, { target: { value: "lots" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the real answer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The real answer needs to be a number.");
    fireEvent.change(box, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the real answer" }));
    expect(qv().results[0].realAnswer).toBe(14);
    expect(screen.queryByRole("alert")).toBeNull();
    // Under the box, in the row's summary and in the page's latest line: 8 is 6 days under 14.
    expect(
      screen.getAllByText(/The real answer was 14 days: the median guess was 6 days low \(43%\)\./)
    ).toHaveLength(3);
  });

  it("saves value poker's value to its backlog item only on Save, with Undo", async () => {
    useWorkspaceStore.setState({
      backlogItems: [{ id: "b1", name: "Search", businessValue: 3 }] as never,
    });
    const vp = {
      id: "qvr-vp",
      presetId: "value-poker" as const,
      savedAt: "2026-11-12T10:00:00.000Z",
      backlogItemId: "b1",
      result: {
        kind: "choice" as const,
        roundId: "round-vp",
        tool: "quick-vote" as const,
        sheetId: "qv:value-poker:b1",
        title: "How much value does “Search” bring?",
        mode: "single" as const,
        limit: 1,
        closedAt: "2026-11-12T10:00:00.000Z",
        minN: 3,
        ballots: 4,
        source: "live" as const,
        options: [1, 2, 3, 5, 8, 13, 20].map((v, i) => ({
          id: `o${i + 1}`,
          text: String(v),
          total: v === 8 ? 3 : v === 5 ? 1 : 0,
          backers: null,
        })),
      },
    };
    useQuickVote.setState({ results: [vp] });
    await renderPage();
    expect(ws().backlogItems?.[0]?.businessValue).toBe(3);
    expect(screen.getByText(/Most picked: 8\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Business value for “Search”")).toHaveValue("8");
    fireEvent.click(screen.getByRole("button", { name: "Save the value" }));
    expect(ws().backlogItems?.[0]?.businessValue).toBe(8);
    expect(qv().results[0].valueSaved).toBe(8);
    undo("Set the business value of “Search” to 8");
    expect(ws().backlogItems?.[0]?.businessValue).toBe(3);
    expect(qv().results[0].valueSaved).toBeUndefined();
  });

  it("exports every saved round as Markdown", async () => {
    useQuickVote.setState({ results: stored });
    await renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toMatch(/^# Quick Vote results/);
    expect(md).toContain("## Dot voting: Which retro topics should we talk about first?");
    expect(md).toContain("Real answer: 11 days.");
  });
});

/* ── The host's formats, the example, Amr ───────────────────────────── */

describe("the host's own formats", () => {
  it("checks the name: not blank, not taken, and only a round that can run", () => {
    const ctxOk = { taken: ["Retro ROTI"], roundProblem: null, full: false };
    expect(validateFormatName({ name: " " }, ctxOk)).toEqual({
      ok: false,
      errors: { name: "Give the format a name." },
    });
    expect(validateFormatName({ name: "retro roti" }, ctxOk)).toEqual({
      ok: false,
      errors: { name: "You already have a format called “retro roti”." },
    });
    expect(
      validateFormatName({ name: "Mine" }, { ...ctxOk, roundProblem: "Type the question." })
    ).toEqual({
      ok: false,
      errors: { name: "Finish the round first: Type the question." },
    });
    expect(validateFormatName({ name: " Mine " }, ctxOk)).toEqual({
      ok: true,
      values: { name: "Mine" },
    });
  });

  it("saves the round as a format, starts it in one tap, and deletes it with Undo", async () => {
    await renderPage();
    pickFormat("ROTI");
    fireEvent.change(screen.getByLabelText(/^Question/), {
      target: { value: "Was the review worth it?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as my format" }));
    expect(screen.getByText("Give the format a name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Name for this format/), {
      target: { value: "Review ROTI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as my format" }));
    expect(qv().customPresets).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({ action: "poll_saved", payload: { preset: "roti" } });
    pickFormat("Poll");
    fireEvent.click(screen.getByRole("button", { name: /^Review ROTI/ }));
    expect(screen.getByLabelText(/^Question/)).toHaveValue("Was the review worth it?");
    fireEvent.click(screen.getByRole("button", { name: "Delete the format “Review ROTI”" }));
    expect(qv().customPresets).toEqual([]);
    expect(logs.at(-1)).toMatchObject({ action: "poll_removed" });
    undo("Deleted the format “Review ROTI”");
    expect(qv().customPresets).toHaveLength(1);
  });
});

describe("the example", () => {
  it("is a read-only preview that never reaches the store", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/a week of meetings' votes/)).toBeInTheDocument();
    expect(screen.getByTestId("quick-vote-verdict")).toHaveTextContent("Latest, Fist of five");
    expect(
      screen.getByText("Clear the example to run a round with your team.")
    ).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /^Delete the result/ }))
      expect(b).toBeDisabled();
    expect(qv().results).toEqual([]);
    expect(qv().customPresets).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.getByText(/No saved rounds yet/)).toBeInTheDocument();
  });
});

describe("Amr", () => {
  it("sets up a round the page shows at once", async () => {
    await renderPage();
    await act(async () => {
      await registry.get("tool.quick_vote.start_round")!.handler(
        {
          format: "dots",
          question: "What should we fix first?",
          options: ["Tests", "Docs", "CI"],
          dots: 2,
        },
        ctx()
      );
    });
    expect(format("Dot voting")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/^Question/)).toHaveValue("What should we fix first?");
    expect(screen.getByLabelText(/Options, one per line/)).toHaveValue("Tests\nDocs\nCI");
    expect(screen.getByLabelText(/^Dots each/)).toHaveValue("2");
  });

  it("picks up a round set up earlier when the page opens", async () => {
    setDraftOf("elmo");
    await renderPage();
    expect(format("ELMO and live signals")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/A standing round: open it as the conversation starts/)
    ).toBeInTheDocument();
  });
});
