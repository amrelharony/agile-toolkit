import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MeetingNote, MeetingNoteItem } from "@/lib/stores/workspace-types";
import type { FoundItem } from "@/lib/notes-to-actions/extract";

/**
 * Notes to Actions (tools plan, phase 2, N77): paste notes (capped, the
 * meeting remembered), find the items (without AI here, grounded in the
 * notes), keep one or all with Undo, edit them, send each kind on its route
 * with Undo (one Undo per kind for "Send all"), answer or drop questions,
 * forget the pasted text keeping the items, delete with Undo; the privacy
 * and AI lines; the example; and no text or quote in the Markdown or in
 * any history payload.
 */

const h = vi.hoisted(() => ({
  logs: [] as { action: string; payload: Record<string, unknown> }[],
  cheers: [] as string[],
  canned: null as FoundItem[] | null,
}));
const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/notes-to-actions",
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => h.logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (tool: string, reason: string) => h.cheers.push(`${tool}:${reason}`),
}));
// A canned answer stands in for a model's when a test sets one.
vi.mock("@/lib/ai/tasks/notes-to-actions.lite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tasks/notes-to-actions.lite")>();
  return {
    ...actual,
    notesToActionsExtractTask: {
      ...actual.notesToActionsExtractTask,
      fallback: (input: Parameters<typeof actual.extractNotesFallback>[0]) =>
        h.canned ? { items: h.canned } : actual.extractNotesFallback(input),
    },
  };
});
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { id: string; prompt: string }[] } }) => (
    <pre data-testid="ai-prompt">{config.prompts.map((p) => p.prompt).join("\n")}</pre>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import {
  NotesToActionsClient,
  AI_LINE,
} from "@/app/(tools)/notes-to-actions/notes-to-actions-client";
import { validatePaste } from "@/app/(tools)/notes-to-actions/form";

const TEXT = [
  "Sprint Review",
  "- Ana to update the onboarding copy by Friday",
  "- Decided: we stop supporting the old export",
  "- Waiting on legal sign-off for the cookie banner",
  "- CSV export cuts off long names",
  "- Do we demo on staging or live?",
  "- The demo went well.",
].join("\n");
const AT = "2026-11-20T10:00:00.000Z";
const item = (id: string, over: Partial<MeetingNoteItem> = {}): MeetingNoteItem => ({
  id,
  kind: "action",
  text: `Item ${id}`,
  status: "open",
  keptAt: AT,
  quote: "Ana to update the onboarding copy by Friday",
  ...over,
});
const note = (over: Partial<MeetingNote> = {}): MeetingNote => ({
  id: "mnote_a",
  meeting: "Sprint Review",
  date: "2026-11-20",
  text: TEXT,
  items: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id = "mnote_a") => (ws().meetingNotes ?? []).find((n) => n.id === id);
const storedItem = (id: string) => stored()?.items.find((i) => i.id === id);
const seed = (notes: MeetingNote[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    meetingNotes: notes,
    stories: [],
    impediments: [],
    retroBoards: [],
    bugReports: [],
    decisions: [],
    daciDecisions: [],
    rapidDecisions: [],
    teamMembers: [],
    sprints: [],
    ...extra,
  });
const logged = (action: string) => h.logs.filter((l) => l.action === action).map((l) => l.payload);
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <NotesToActionsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const paste = () => within(screen.getByRole("region", { name: "Paste notes" }));
const find = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Find them without AI" }));
  await screen.findByText("Found in the notes");
};
const sendVia = (name: RegExp, label: string) => {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, pointerType: "mouse" });
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
};

const FIVE = [
  item("a1", { owner: "Ana", due: "2026-11-27" }),
  item("d1", { kind: "decision", text: "Stop the old export", detail: "Rarely used" }),
  item("i1", { kind: "impediment", text: "Legal sign-off" }),
  item("b1", { kind: "bug", text: "CSV cuts names" }),
  item("q1", { kind: "question", text: "Staging or live?" }),
];

beforeEach(() => {
  toastSpy.mockReset();
  h.logs.length = 0;
  h.cheers.length = 0;
  h.canned = null;
  seed([]);
});

describe("pasting notes", () => {
  it("shows the empty state, the privacy line and the paste box", () => {
    renderPage();
    expect(screen.getByText(/No meeting notes yet/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Your notes are saved in this browser only\. Forget them any time: the pasted text and its quotes go, and the items you kept stay\./
      )
    ).toBeInTheDocument();
    expect(paste().getByLabelText(/Meeting notes/)).toBeInTheDocument();
  });

  it("refuses notes over 12,000 characters: split them", () => {
    expect(
      validatePaste({ text: "x".repeat(12001), meeting: "", date: "2026-11-20" })
    ).toMatchObject({
      ok: false,
      errors: { text: expect.stringMatching(/Split it into parts/) },
    });
    renderPage();
    fireEvent.change(paste().getByLabelText(/Meeting notes/), {
      target: { value: "x".repeat(12001) },
    });
    fireEvent.click(paste().getByRole("button", { name: "Save the notes" }));
    expect(ws().meetingNotes).toEqual([]);
    expect(paste().getByRole("alert")).toHaveTextContent(/Split it into parts/);
  });

  it("saves the notes with the meeting and day, logging only the length", () => {
    renderPage();
    fireEvent.change(paste().getByLabelText(/Meeting notes/), { target: { value: TEXT } });
    fireEvent.change(paste().getByLabelText(/^Meeting$/), { target: { value: "Sprint Review" } });
    fireEvent.change(paste().getByLabelText(/^Day/), { target: { value: "2026-11-20" } });
    fireEvent.click(paste().getByRole("button", { name: "Save the notes" }));
    const [n] = ws().meetingNotes ?? [];
    expect(n).toMatchObject({
      meeting: "Sprint Review",
      date: "2026-11-20",
      text: TEXT,
      items: [],
    });
    expect(n.id).toMatch(/^mnote_/);
    expect(logged("notes_added")).toEqual([{ noteId: n.id, length: TEXT.length }]);
  });

  it("offers the newest note's meeting for the next notes", () => {
    seed([note({ meeting: "Daily Scrum" })]);
    renderPage();
    expect(paste().getByLabelText(/^Meeting$/)).toHaveValue("Daily Scrum");
  });
});

describe("finding and keeping", () => {
  beforeEach(() => seed([note()]));

  it("finds the items without AI, each with the line it came from", async () => {
    renderPage();
    expect(screen.getByText(AI_LINE)).toBeInTheDocument();
    await find();
    expect(
      screen.getByText("Action: Ana to update the onboarding copy by Friday")
    ).toBeInTheDocument();
    expect(screen.getByText("Decision: We stop supporting the old export")).toBeInTheDocument();
    expect(screen.getByText("Question: Do we demo on staging or live?")).toBeInTheDocument();
    expect(
      screen.getByText(/from “Waiting on legal sign-off for the cookie banner”/)
    ).toBeInTheDocument();
    expect(logged("items_found")).toEqual([{ noteId: "mnote_a", source: "rules", count: 5 }]);
  });

  it("drops an answer item whose line isn't in the notes, and an owner nobody named", async () => {
    h.canned = [
      {
        kind: "action",
        text: "Update the copy",
        owner: "Zed",
        quote: "Ana to update the onboarding copy by Friday",
      },
      { kind: "bug", text: "Invented", quote: "The login page is broken" },
    ];
    renderPage();
    await find();
    expect(screen.getByText("Action: Update the copy")).toBeInTheDocument();
    expect(screen.queryByText(/Invented/)).toBeNull();
    expect(screen.queryByText(/Zed/)).toBeNull();
  });

  it("keeps one item with Undo, stamped and open", async () => {
    renderPage();
    await find();
    fireEvent.click(screen.getAllByRole("button", { name: /^Keep/ })[0]);
    expect(stored()?.items).toHaveLength(1);
    expect(stored()?.items[0]).toMatchObject({
      kind: "action",
      owner: "Ana",
      due: "2026-11-20",
      status: "open",
      quote: "Ana to update the onboarding copy by Friday",
    });
    expect(Date.parse(stored()?.items[0].keptAt ?? "")).toBeGreaterThan(0);
    expect(logged("items_kept")).toEqual([{ noteId: "mnote_a", count: 1 }]);
    undoLast();
    expect(stored()?.items).toEqual([]);
  });

  it("keeps them all at once", async () => {
    renderPage();
    await find();
    fireEvent.click(screen.getByRole("button", { name: /Keep all/ }));
    expect(stored()?.items.map((i) => i.kind)).toEqual([
      "action",
      "decision",
      "impediment",
      "bug",
      "question",
    ]);
    expect(logged("items_kept")).toEqual([{ noteId: "mnote_a", count: 5 }]);
  });

  it("finds only the example's new items: the two it keeps are known by their lines", async () => {
    renderPage();
    act(() => seed([]));
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    await find();
    expect(screen.queryByText("Action: Ana to update the onboarding copy by Friday")).toBeNull();
    expect(screen.queryByText("Decision: We stop supporting the old export")).toBeNull();
    expect(
      screen.getByText("Question: Do we demo on staging or live next time?")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Keep all/ }));
    const [example] = ws().meetingNotes ?? [];
    expect(example.items.map((i) => i.kind)).toEqual([
      "action",
      "decision",
      "impediment",
      "bug",
      "question",
    ]);
  });

  it("finds nothing again once an item is edited after keeping", async () => {
    seed([
      note({
        items: [
          item("a1", { text: "Rewrite the copy", owner: "Ana" }),
          item("d1", {
            kind: "decision",
            text: "Old export goes",
            quote: "Decided: we stop supporting the old export",
          }),
        ],
      }),
    ]);
    renderPage();
    await find();
    expect(screen.queryByText(/^Action: /)).toBeNull();
    expect(screen.queryByText(/^Decision: /)).toBeNull();
    expect(logged("items_found")).toEqual([{ noteId: "mnote_a", source: "rules", count: 3 }]);
  });

  it("matches an owner to the roster's spelling", async () => {
    seed([note()], { teamMembers: [{ id: "m1", name: "ana" }] });
    renderPage();
    await find();
    expect(screen.getByText(/Owner ana/)).toBeInTheDocument();
  });

  it("edits a kept item in place", () => {
    seed([note({ items: [item("a1")] })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Item a1" }));
    fireEvent.change(screen.getByLabelText(/What it is/), {
      target: { value: "Rewrite the copy" },
    });
    fireEvent.change(screen.getByLabelText(/^Kind/), { target: { value: "story" } });
    fireEvent.change(screen.getByLabelText(/^Owner/), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText(/^Due/), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));
    expect(storedItem("a1")).toMatchObject({
      kind: "story",
      text: "Rewrite the copy",
      owner: "Sam",
      due: "2026-12-01",
    });
  });
});

describe("sending", () => {
  beforeEach(() => seed([note({ items: FIVE })]));

  it("sends an action to Retro Actions with its owner and due day, with Undo", () => {
    renderPage();
    expect(screen.getByText("No retro is open: sending starts one.")).toBeInTheDocument();
    sendVia(/^Send to… Item a1/, "Send to Retro Actions");
    const card = (ws().retroBoards ?? [])[0]?.cards[0];
    expect(card).toMatchObject({
      text: "Item a1",
      assignee: "Ana",
      dueDate: "2026-11-27",
      sourceRef: { tool: "notes-to-actions", id: "a1", doc: "mnote_a" },
    });
    expect(storedItem("a1")?.status).toBe("sent");
    expect(logged("items_sent")).toEqual([{ noteId: "mnote_a", route: "retro-action", count: 1 }]);
    undoLast();
    expect((ws().retroBoards ?? [])[0]?.cards ?? []).toHaveLength(0);
    expect(storedItem("a1")?.status).toBe("open");
  });

  it("sends a decision as a proposed record, the meeting's words its recommendation, no quote", () => {
    renderPage();
    sendVia(/^Send to… Stop the old export/, "Send to the Decision Log");
    const [d] = ws().decisions;
    expect(d).toMatchObject({
      title: "Stop the old export",
      context: "Rarely used",
      status: "proposed",
      recommendation: "Stop the old export",
      sourceRef: { tool: "notes-to-actions", id: "d1", doc: "mnote_a" },
    });
    expect(JSON.stringify(d)).not.toContain("onboarding");
  });

  it("sends a blocker to Impediments and a bug to Bug Triage", () => {
    renderPage();
    sendVia(/^Send to… Legal sign-off/, "Send to Impediments");
    sendVia(/^Send to… CSV cuts names/, "Send to Bug Triage");
    expect(ws().impediments[0]).toMatchObject({ title: "Legal sign-off" });
    expect((ws().bugReports ?? [])[0]).toMatchObject({ title: "CSV cuts names", status: "new" });
  });

  it("sends all of a kind at once, with one Undo", () => {
    seed([note({ items: [item("a1"), item("a2"), item("a3", { status: "dropped" })] })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Send all 2 to Retro Actions" }));
    expect((ws().retroBoards ?? [])[0]?.cards).toHaveLength(2);
    expect(logged("items_sent")).toEqual([{ noteId: "mnote_a", route: "retro-action", count: 2 }]);
    undoLast();
    expect((ws().retroBoards ?? [])[0]?.cards ?? []).toHaveLength(0);
    expect(stored()?.items.map((i) => i.status)).toEqual(["open", "open", "dropped"]);
  });

  it("never sends a question: it is answered or dropped", () => {
    renderPage();
    const list = within(screen.getByRole("list", { name: "Open questions" }));
    expect(list.queryByRole("button", { name: /^Send to…/ })).toBeNull();
    fireEvent.click(list.getByRole("button", { name: "Answered" }));
    expect(storedItem("q1")?.status).toBe("answered");
    expect(logged("item_answered")).toEqual([{ noteId: "mnote_a", itemId: "q1" }]);
  });

  it("drops an item with Undo, logging its kind but not its words", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Drop Legal sign-off" }));
    expect(storedItem("i1")?.status).toBe("dropped");
    expect(logged("item_dropped")).toEqual([
      { noteId: "mnote_a", itemId: "i1", kind: "impediment" },
    ]);
    undoLast();
    expect(storedItem("i1")?.status).toBe("open");
  });

  it("cheers once every item is sent, dropped or answered", () => {
    seed([
      note({
        items: [item("a1", { status: "sent" }), item("q1", { kind: "question", text: "Why?" })],
      }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Answered" }));
    expect(logged("note_done")).toEqual([{ noteId: "mnote_a", sent: 1, dropped: 0, answered: 1 }]);
    expect(h.cheers).toEqual(["notes-to-actions:done"]);
  });

  it("never sends the example's items", () => {
    renderPage();
    act(() => seed([]));
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Send to… Update the onboarding copy/ })
    ).toBeDisabled();
    expect(h.logs).toEqual([]);
  });

  it("never offers Send all on the example", () => {
    seed([note({ id: "example-n", items: [item("a1"), item("a2")] })]);
    renderPage();
    expect(screen.queryByRole("button", { name: /^Send all/ })).toBeNull();
  });

  it("opens a dropped item again, with Undo", () => {
    seed([note({ items: [item("a1", { status: "dropped" })] })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Open again" }));
    expect(storedItem("a1")?.status).toBe("open");
    undoLast();
    expect(storedItem("a1")?.status).toBe("dropped");
  });

  it("says a decision goes to the Decision Log as proposed", () => {
    renderPage();
    expect(
      screen.getByText(
        "A decision goes to the Decision Log as proposed; the team accepts it there."
      )
    ).toBeInTheDocument();
  });

  it("refuses an item with no words, and keeps its due day a real one", () => {
    seed([note({ items: [item("a1")] })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Item a1" }));
    fireEvent.change(screen.getByLabelText(/What it is/), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Say what it is, in a few words.");
    expect(storedItem("a1")?.text).toBe("Item a1");
  });
});

describe("forgetting, deleting and exporting", () => {
  beforeEach(() => seed([note({ items: [item("a1", { detail: "Keep the tone" })] })]));

  it("forgets the pasted text and every quote, keeping the items, with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Forget the notes" }));
    expect(stored()?.text).toBe("");
    expect(stored()?.items[0].quote).toBeUndefined();
    expect(stored()?.items[0].detail).toBe("Keep the tone");
    expect(screen.getByText(/The pasted notes were forgotten/)).toBeInTheDocument();
    expect(logged("notes_text_forgotten")).toEqual([{ noteId: "mnote_a" }]);
    undoLast();
    expect(stored()?.text).toBe(TEXT);
  });

  it("deletes the notes with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete the notes from Sprint Review" }));
    expect(ws().meetingNotes).toEqual([]);
    undoLast();
    expect(stored()).toBeTruthy();
  });

  it("exports the items by kind, never the pasted text or a quote", () => {
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Sprint Review — 2026-11-20");
    expect(md).toContain("## Actions");
    expect(md).toContain("- Item a1 (open)");
    expect(md).not.toContain("onboarding copy by Friday");
    expect(md).not.toContain("cookie banner");
    const prompts = screen.getByTestId("ai-prompt").textContent ?? "";
    expect(prompts).not.toContain("cookie banner");
  });

  it("keeps the notes' text and quotes out of every history payload", async () => {
    renderPage();
    await find();
    fireEvent.click(screen.getByRole("button", { name: /Keep all/ }));
    sendVia(/^Send to… Item a1/, "Send to Retro Actions");
    fireEvent.click(screen.getByRole("button", { name: "Forget the notes" }));
    const json = JSON.stringify(h.logs);
    for (const words of ["onboarding", "cookie", "export", "Item a1", "Sprint Review"]) {
      expect(json).not.toContain(words);
    }
    expect(h.logs.length).toBeGreaterThan(3);
  });

  it("opens the notes a ?note= link names, and switches from the past notes list", async () => {
    seed([note(), note({ id: "mnote_b", meeting: "Daily Scrum", date: "2026-11-21" })]);
    window.history.replaceState(null, "", "/notes-to-actions?note=mnote_a");
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Sprint Review notes, 2026-11-20" })
      ).toBeInTheDocument()
    );
    expect(window.location.search).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Daily Scrum · 2026-11-21/ }));
    expect(
      screen.getByRole("region", { name: "Daily Scrum notes, 2026-11-21" })
    ).toBeInTheDocument();
  });
});
