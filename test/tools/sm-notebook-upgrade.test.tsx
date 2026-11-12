import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { isExampleId } from "@/lib/utils/example-id";
import { SUMMARY_TAG, formatDay, shiftDay, weekStartOf } from "@/lib/notebook/model";
import { getToolById } from "@/lib/constants/tools";

/**
 * Scrum Master Notebook (tools plan, phase 1, N76): fast capture with
 * templates, tags, an event and a linked tool; tags suggested by Amr (or
 * without AI) that only reach the form; search, tag and event filters over a
 * timeline by week; edit, delete with Undo, and a note sent on as an
 * impediment; the week's counts and Amr's read of it, kept as a note only
 * when the person chooses, with only real tools linked; the privacy line;
 * an example, a Markdown export and the history kept free of note text.
 */

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  logs: [] as { action: string; payload: Record<string, unknown> }[],
}));
const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => h.logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { id: string }[] } }) => (
    <pre data-testid="ai-prompt">{config.prompts.map((p) => p.id).join(",")}</pre>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, csvData }: { markdown?: string; csvData?: unknown }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <pre data-testid="export-csv">{JSON.stringify(csvData)}</pre>
    </>
  ),
}));

import { SmNotebookClient } from "@/app/(tools)/sm-notebook/sm-notebook-client";
import { buildExample } from "@/app/(tools)/sm-notebook/example";
import { notebookToMarkdown } from "@/app/(tools)/sm-notebook/markdown";
import {
  applyNoteValues,
  draftWithTemplate,
  emptyNoteDraft,
  noteChanged,
  noteDraftFrom,
  validateNote,
} from "@/app/(tools)/sm-notebook/form";
import { validateSummary } from "@/app/(tools)/sm-notebook/week-view";
import { NOTE_TEMPLATES } from "@/lib/notebook/templates";

const TODAY = todayLocalISO();
const MONDAY = weekStartOf(TODAY);
const LAST_MONDAY = shiftDay(MONDAY, -7);
const AT = "2026-11-01T09:00:00.000Z";

const note = (id: string, date: string, over: Partial<NotebookEntry> = {}): NotebookEntry => ({
  id,
  date,
  body: `Note ${id}`,
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().notebookEntries ?? [];
const one = (id: string) => stored().find((e) => e.id === id);
const seed = (list: NotebookEntry[]) =>
  useWorkspaceStore.setState({ notebookEntries: list, impediments: [] });
const logged = (action: string) => h.logs.filter((l) => l.action === action).map((l) => l.payload);

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <SmNotebookClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const newNote = () => within(screen.getByRole("region", { name: "New note" }));
const type = (label: string, value: string, scope = newNote()) =>
  fireEvent.change(
    scope.getByLabelText(label, { exact: false, selector: "input,textarea,select" }),
    {
      target: { value },
    }
  );
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const openWeek = () =>
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Week" }), { button: 0 });

const THREE: NotebookEntry[] = [
  note("a", MONDAY, {
    title: "Quiet standup",
    body: "Two people didn't speak at the Daily Scrum.",
    tags: ["participation"],
    event: "daily-scrum",
  }),
  note("b", MONDAY, {
    body: "The payments story is blocked on sandbox access.",
    tags: ["blockers"],
    event: "daily-scrum",
    linkedTool: "impediments",
    createdAt: "2026-11-01T10:00:00.000Z",
  }),
  note("c", LAST_MONDAY, {
    title: "Retro experiment",
    body: "Silent writing first gave twice the cards.",
    tags: ["experiment", "participation"],
    event: "retro",
    linkedTool: "made-up-tool",
  }),
];

beforeEach(() => {
  toastSpy.mockReset();
  h.logs.length = 0;
  h.auth = null;
  seed([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── The form's checks ─────────────────────────────────────────────── */

describe("the note form's checks", () => {
  it("needs the note's text and a day that has happened", () => {
    expect(validateNote(emptyNoteDraft(TODAY), TODAY)).toMatchObject({
      ok: false,
      errors: { body: "Write what you saw or tried." },
    });
    expect(
      validateNote({ ...emptyNoteDraft(TODAY), body: "x", date: shiftDay(TODAY, 1) }, TODAY)
    ).toMatchObject({ ok: false, errors: { date: expect.stringMatching(/hasn't happened/) } });
    expect(
      validateNote(
        {
          ...emptyNoteDraft(TODAY),
          body: " Seen. ",
          title: "  ",
          tags: "A, a , B",
          event: "retro",
        },
        TODAY
      )
    ).toEqual({
      ok: true,
      values: {
        date: TODAY,
        title: undefined,
        body: "Seen.",
        tags: ["a", "b"],
        event: "retro",
        linkedTool: undefined,
      },
    });
  });

  it("holds the workspace caps on tags, and keeps what an agent saved", () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`).join(", ");
    expect(validateNote({ ...emptyNoteDraft(TODAY), body: "x", tags: many }, TODAY)).toMatchObject({
      ok: false,
      errors: { tags: "Keep it to 20 tags or fewer." },
    });
    const long = "x".repeat(201);
    expect(validateNote({ ...emptyNoteDraft(TODAY), body: "x", tags: long }, TODAY).ok).toBe(false);
    const saved = note("n", shiftDay(TODAY, 1), { tags: [long] });
    expect(validateNote(noteDraftFrom(saved), TODAY, saved).ok).toBe(true);
  });

  it("links only a tool the registry knows", () => {
    expect(
      validateNote({ ...emptyNoteDraft(TODAY), body: "x", linkedTool: "nope" }, TODAY)
    ).toMatchObject({ ok: false, errors: { linkedTool: "Pick a tool from the list." } });
    expect(noteDraftFrom(note("n", TODAY, { linkedTool: "made-up" })).linkedTool).toBe("");
    expect(noteDraftFrom(note("n", TODAY, { linkedTool: "kanban" })).linkedTool).toBe("kanban");
  });

  it("saves a cleared field as gone, and knows when nothing changed", () => {
    const saved = note("n", TODAY, { title: "Old", event: "retro", sentTo: [] });
    const v = validateNote({ ...noteDraftFrom(saved), title: "", event: "" }, TODAY, saved);
    if (!v.ok) throw new Error("should pass");
    const next = applyNoteValues(saved, v.values, "2026-11-12T00:00:00.000Z");
    expect(next).not.toHaveProperty("title");
    expect(next).not.toHaveProperty("event");
    expect(next).toMatchObject({
      createdAt: AT,
      updatedAt: "2026-11-12T00:00:00.000Z",
      sentTo: [],
    });
    const same = validateNote(noteDraftFrom(saved), TODAY, saved);
    if (!same.ok) throw new Error("should pass");
    expect(noteChanged(saved, same.values)).toBe(false);
  });

  it("drops a template's prompts in and merges its tags, keeping an event already picked", () => {
    const t = NOTE_TEMPLATES.find((x) => x.id === "one-on-one")!;
    const d = draftWithTemplate(
      { ...emptyNoteDraft(TODAY), body: "Started.", tags: "Coaching", event: "retro" },
      t
    );
    expect(d.body).toBe(`Started.\n\n${t.body}`);
    expect(d.tags).toBe("coaching, 1:1");
    expect(d.event).toBe("retro");
  });

  it("needs a summary's text before keeping it", () => {
    expect(validateSummary("  ", [])).toMatchObject({ ok: false });
    expect(validateSummary(" Calm. ", ["a"])).toEqual({
      ok: true,
      values: { summary: "Calm.", patterns: ["a"] },
    });
  });
});

/* ── The example and the export ────────────────────────────────────── */

describe("the example and the export", () => {
  it("is two weeks of real-looking notes, all example ids, none in the future", () => {
    const list = buildExample(TODAY);
    expect(list.length).toBeGreaterThanOrEqual(8);
    for (const e of list) {
      expect(isExampleId(e.id), e.id).toBe(true);
      expect(e.date <= TODAY).toBe(true);
      expect(e.tags).toEqual(e.tags.map((t) => t.trim().toLowerCase()));
      if (e.linkedTool) expect(getToolById(e.linkedTool), e.linkedTool).toBeDefined();
    }
    expect(list.filter((e) => e.tags.includes("blockers"))).toHaveLength(3);
  });

  it("exports Markdown by week with each note's day, title, event, tags and tool", () => {
    const md = notebookToMarkdown([
      note("x", "2026-11-12", {
        title: "Quiet *standup*",
        body: "Two people didn't speak.",
        tags: ["participation"],
        event: "daily-scrum",
        linkedTool: "impediments",
      }),
      note("y", "2026-11-03", { body: "Last week." }),
    ]);
    expect(md).toBe(
      [
        "# Scrum Master Notebook",
        "",
        "2 notes.",
        "",
        "Tags used most: participation (1).",
        "",
        "## Week of 9 Nov 2026",
        "",
        "### Thu 12 Nov · Quiet \\*standup\\*",
        "",
        "_Daily Scrum · tags: participation · about: Impediment Tracker_",
        "",
        "Two people didn't speak.",
        "",
        "## Week of 2 Nov 2026",
        "",
        "### Tue 3 Nov",
        "",
        "Last week.",
        "",
      ].join("\n")
    );
    expect(notebookToMarkdown([])).toBe("# Scrum Master Notebook\n\nNo notes yet.\n");
  });
});

/* ── The page ──────────────────────────────────────────────────────── */

describe("the page", () => {
  // The file's first render warms the page's modules up: slow on a loaded runner.
  it(
    "starts empty with an example to load, and says where notes are kept",
    { timeout: 15_000 },
    () => {
      renderPage();
      expect(screen.getByText(/No notes yet\./)).toBeInTheDocument();
      expect(
        screen.getByText(/saved in this browser only\. They never go to a live room\./)
      ).toBeInTheDocument();
      // Every way they leave, the AI prompts run with a personal key included.
      expect(
        screen.getByText(
          /ask Amr's AI about them, or run one of the AI prompts with your own AI key\./
        )
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
      expect(stored().length).toBeGreaterThanOrEqual(8);
      expect(screen.getByText(/Example data\./)).toBeInTheDocument();
      expect(screen.getByTestId("export-markdown").textContent).toMatch(/^# Scrum Master Notebook/);
      expect(screen.getByTestId("ai-prompt").textContent).toContain("notebook-patterns");
    }
  );

  it("clears only the example's notes", () => {
    seed([...buildExample(TODAY), note("mine", TODAY)]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((e) => e.id)).toEqual(["mine"]);
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
  });

  it("tells a signed-in owner the notes sync to their own account", () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    renderPage();
    expect(
      screen.getByText(/saved in this browser and synced to your own account\./)
    ).toBeInTheDocument();
  });

  it("saves nothing without the note's text, and says what's missing", () => {
    renderPage();
    fireEvent.click(newNote().getByRole("button", { name: "Save note" }));
    expect(stored()).toEqual([]);
    expect(newNote().getByRole("alert")).toHaveTextContent("Write what you saw or tried.");
  });

  it("captures a note with its tags, event and tool, stamped, and logs no text", () => {
    renderPage();
    type("Title", "Quiet standup");
    type("Note", "Two people didn't speak.");
    type("Tags", "Participation, participation, Standup ");
    type("Event", "daily-scrum");
    type("About a tool", "standup");
    fireEvent.click(newNote().getByRole("button", { name: "Save note" }));
    const [saved] = stored();
    expect(saved).toMatchObject({
      date: TODAY,
      title: "Quiet standup",
      body: "Two people didn't speak.",
      tags: ["participation", "standup"],
      event: "daily-scrum",
      linkedTool: "standup",
    });
    expect(saved.id).toMatch(/^note_/);
    expect(saved.createdAt).toBe(saved.updatedAt);
    expect(saved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(logged("note_added")).toEqual([
      { noteId: saved.id, tags: ["participation", "standup"], event: "daily-scrum" },
    ]);
    expect(JSON.stringify(h.logs)).not.toContain("speak");
    // The form starts again.
    expect((newNote().getByLabelText("Note", { exact: false }) as HTMLTextAreaElement).value).toBe(
      ""
    );
    expect(screen.getByRole("heading", { name: "Quiet standup" })).toBeInTheDocument();
  });

  it("won't save a note about a day that hasn't happened", () => {
    renderPage();
    type("Note", "Planning ahead.");
    type("Day", shiftDay(TODAY, 1));
    fireEvent.click(newNote().getByRole("button", { name: "Save note" }));
    expect(stored()).toEqual([]);
    expect(newNote().getByRole("alert")).toHaveTextContent(/hasn't happened/);
  });

  it("starts a note from a template", () => {
    renderPage();
    fireEvent.click(newNote().getByRole("button", { name: "Impediment pattern" }));
    const body = newNote().getByLabelText("Note", { exact: false }) as HTMLTextAreaElement;
    expect(body.value).toMatch(/^The blocker:/);
    expect((newNote().getByLabelText("Tags") as HTMLInputElement).value).toBe("blockers");
    expect(
      (newNote().getByLabelText("About a tool", { exact: false }) as HTMLSelectElement).value
    ).toBe("impediments");
  });

  it("suggests tags without AI into the form only; Save writes them", () => {
    seed([note("old", LAST_MONDAY, { tags: ["sandbox"] })]);
    renderPage();
    // Queried each time: the button moves out of its tooltip once it can be used.
    const ask = () => newNote().getByRole("button", { name: "Suggest tags" });
    fireEvent.click(ask());
    expect(newNote().getByText("Write the note first, then ask for tags.")).toBeInTheDocument();
    type("Note", "Still waiting on the sandbox. Two people stayed quiet.");
    fireEvent.click(ask());
    const list = within(newNote().getByTestId("ai-suggestions"));
    expect(list.getByText("Suggested without AI. Check before you add.")).toBeInTheDocument();
    expect(
      list.getAllByRole("button", { name: /^Add tag: / }).map((b) => b.textContent)
    ).toHaveLength(3);
    fireEvent.click(list.getByRole("button", { name: "Add tag: sandbox" }));
    expect((newNote().getByLabelText("Tags") as HTMLInputElement).value).toBe("sandbox");
    expect(stored()).toHaveLength(1);
    fireEvent.click(newNote().getByRole("button", { name: "Save note" }));
    expect(stored().find((e) => e.id !== "old")!.tags).toEqual(["sandbox"]);
  });

  it("groups notes by week and filters by words, tags and event", () => {
    seed(THREE);
    renderPage();
    expect(screen.getByRole("heading", { name: /^This week · 2 notes$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Last week · 1 note$/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "sandbox" } });
    expect(screen.getByText("1 note of 3 match")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quiet standup" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("3 notes")).toBeInTheDocument();

    const chips = within(screen.getByRole("group", { name: "Filter by tag" }));
    fireEvent.click(chips.getByRole("button", { name: /^participation \(2\)$/ }));
    expect(chips.getByRole("button", { name: /^participation \(2\)$/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("2 notes of 3 match")).toBeInTheDocument();
    fireEvent.click(chips.getByRole("button", { name: /^participation/ }));

    fireEvent.change(screen.getByLabelText("Filter by event"), { target: { value: "retro" } });
    expect(screen.getByText("1 note of 3 match")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Retro experiment" })).toBeInTheDocument();
  });

  it("filters by a tag from a note itself", () => {
    seed(THREE);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Tag blockers: show notes with it" })[0]);
    expect(screen.getByText("1 note of 3 match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tag blockers: stop filtering" }));
    expect(screen.getByText("3 notes")).toBeInTheDocument();
  });

  it("links a note to a real tool only", () => {
    seed(THREE);
    renderPage();
    expect(screen.getByRole("link", { name: "About: Impediment Tracker" })).toHaveAttribute(
      "href",
      "/impediments"
    );
    expect(screen.queryByRole("link", { name: /made-up/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^About:/ })).toHaveLength(1);
  });

  it("edits a note in place, keeping when it was written", () => {
    seed(THREE);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit note: Quiet standup" }));
    const form = within(screen.getByRole("group", { name: "Edit note: Quiet standup" }));
    type("Note", "Two people didn't speak. Asked them in their 1:1s.", form);
    fireEvent.click(form.getByRole("button", { name: "Save note" }));
    expect(one("a")).toMatchObject({
      body: "Two people didn't speak. Asked them in their 1:1s.",
      createdAt: AT,
    });
    expect(one("a")!.updatedAt).not.toBe(AT);
    expect(logged("note_updated")).toEqual([
      { noteId: "a", tags: ["participation"], event: "daily-scrum" },
    ]);
    expect(screen.queryByRole("group", { name: /^Edit note/ })).not.toBeInTheDocument();
  });

  it("closes an edit with Cancel and changes nothing", () => {
    seed(THREE);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit note: Quiet standup" }));
    const form = within(screen.getByRole("group", { name: "Edit note: Quiet standup" }));
    type("Note", "Changed my mind.", form);
    fireEvent.click(form.getByRole("button", { name: "Cancel" }));
    expect(one("a")!.body).toBe(THREE[0].body);
    expect(logged("note_updated")).toEqual([]);
  });

  it("deletes a note with Undo", () => {
    seed(THREE);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete note: Quiet standup" }));
    expect(one("a")).toBeUndefined();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted the note “Quiet standup”");
    expect(logged("note_removed")).toEqual([{ noteId: "a" }]);
    undoLast();
    expect(one("a")).toEqual(THREE[0]);
  });

  it("sends a note on as an impediment that links back; Undo takes both back", () => {
    seed(THREE);
    renderPage();
    fireEvent.keyDown(
      screen.getByRole("button", { name: /^Send to… The payments story is blocked/ }),
      { key: "Enter" }
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));
    const [imp] = ws().impediments ?? [];
    expect(imp).toMatchObject({
      title: "The payments story is blocked on sandbox access.",
      sourceRef: { tool: "sm-notebook", id: "b" },
    });
    expect(one("b")!.sentTo).toEqual([
      expect.objectContaining({ route: "impediment", targetId: imp.id }),
    ]);
    expect(logged("note_sent")).toEqual([{ noteId: "b", route: "impediment", targetId: imp.id }]);
    undoLast();
    expect(ws().impediments ?? []).toEqual([]);
    expect(one("b")!.sentTo ?? []).toEqual([]);
  });

  it("never sends an example note on", () => {
    seed(buildExample(TODAY));
    renderPage();
    expect(screen.queryByRole("button", { name: /^Send to…/ })).not.toBeInTheDocument();
  });

  it("logs nothing for the example's notes", () => {
    seed(buildExample(TODAY));
    renderPage();
    const del = screen.getAllByRole("button", { name: /^Delete note:/ })[0];
    fireEvent.click(del);
    expect(h.logs).toEqual([]);
  });

  it("shows a note whose stored day isn't on the calendar, to fix or delete", () => {
    seed([note("odd", "2026-02-30", { title: "Odd day", body: "An agent wrote this." })]);
    renderPage();
    expect(screen.getByText("2026-02-30 (not a calendar day)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit note: Odd day" }));
    const form = within(screen.getByRole("group", { name: "Edit note: Odd day" }));
    expect(
      form.getByText("Saved as 2026-02-30, which isn't on the calendar. Pick the day it's about.")
    ).toBeInTheDocument();
    fireEvent.click(form.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete note: Odd day" }));
    expect(stored()).toEqual([]);
  });

  it("puts long unbroken tags on as many lines as they need", () => {
    const long = "x".repeat(120);
    seed([note("t", TODAY, { tags: [long] })]);
    renderPage();
    for (const chip of screen.getAllByRole("button", { name: new RegExp(long) })) {
      expect(chip.className).toContain("[overflow-wrap:anywhere]");
      expect(chip.className).toContain("max-w-full");
    }
  });
});

/* ── Focus and announcements ───────────────────────────────────────── */

describe("focus and what is announced", () => {
  const polite = () => screen.getByTestId("live-polite");

  it("announces the tags suggested, and Dismiss puts focus back on the button", async () => {
    renderPage();
    type("Note", "Still waiting on the sandbox. Two people stayed quiet.");
    fireEvent.click(newNote().getByRole("button", { name: "Suggest tags" }));
    await waitFor(() =>
      expect(polite()).toHaveTextContent(
        /^Suggested without AI: 2 tags, blockers, participation\.$/
      )
    );
    const list = within(newNote().getByTestId("ai-suggestions"));
    const dismiss = list.getByRole("button", { name: "Dismiss suggestions" });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(newNote().queryByTestId("ai-suggestions")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(newNote().getByRole("button", { name: "Suggest tags" }));
  });

  it("announces when there is no new tag, without a live region of its own", async () => {
    renderPage();
    type("Note", "Fine.");
    fireEvent.click(newNote().getByRole("button", { name: "Suggest tags" }));
    await waitFor(() =>
      expect(polite()).toHaveTextContent("No new tags to suggest for this note.")
    );
    const shown = newNote().getByText("No new tags to suggest for this note.");
    expect(shown).not.toHaveAttribute("role");
  });

  it("hands focus to the search box when Clear filters goes", () => {
    seed(THREE);
    renderPage();
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "sandbox" } });
    const clear = screen.getByRole("button", { name: "Clear filters" });
    clear.focus();
    fireEvent.click(clear);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText("Search notes"));
  });

  it("gives the timeline its own heading above the weeks", () => {
    seed(THREE);
    renderPage();
    expect(screen.getByRole("heading", { name: "Your notes", level: 2 })).toBeInTheDocument();
  });

  it("keeps focus on a note moved to another week by its edit", async () => {
    seed(THREE);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit note: Quiet standup" }));
    const form = within(screen.getByRole("group", { name: "Edit note: Quiet standup" }));
    type("Day", LAST_MONDAY, form);
    const save = form.getByRole("button", { name: "Save note" });
    save.focus();
    fireEvent.click(save);
    expect(one("a")!.date).toBe(LAST_MONDAY);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit note: Quiet standup" })
      )
    );
  });

  it("moves focus to the list's heading when an edit takes the note out of the search", async () => {
    seed(THREE);
    renderPage();
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "sandbox" } });
    fireEvent.click(screen.getByRole("button", { name: /^Edit note: The payments story/ }));
    const form = within(screen.getByRole("group", { name: /^Edit note: The payments story/ }));
    type("Note", "Access came through on Tuesday.", form);
    const save = form.getByRole("button", { name: "Save note" });
    save.focus();
    fireEvent.click(save);
    expect(screen.getByText("0 notes of 3 match")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your notes" }))
    );
  });
});

/* ── The week ──────────────────────────────────────────────────────── */

describe("the week", () => {
  const WEEK: NotebookEntry[] = [
    note("w1", MONDAY, {
      body: "Blocked on the sandbox.",
      tags: ["blockers"],
      event: "daily-scrum",
    }),
    note("w2", MONDAY, {
      body: "Still stuck on access.",
      event: "daily-scrum",
      createdAt: "2026-11-01T10:00:00.000Z",
    }),
    note("w3", MONDAY, {
      body: "Estimates were 3 and 13.",
      tags: ["estimation"],
      event: "refinement",
      createdAt: "2026-11-01T11:00:00.000Z",
    }),
    note("prev", LAST_MONDAY, { body: "Kudos to the team for the demo.", tags: ["kudos"] }),
  ];

  it("shows this week's notes with counts by tag and event", () => {
    seed(WEEK);
    renderPage();
    openWeek();
    expect(screen.getByRole("heading", { name: "This week", level: 2 })).toBeInTheDocument();
    const byTag = within(screen.getByRole("region", { name: "By tag" }));
    expect(byTag.getByText("blockers")).toBeInTheDocument();
    const byEvent = within(screen.getByRole("region", { name: "By event" }));
    expect(byEvent.getByText("Daily Scrum").parentElement).toHaveTextContent(/Daily Scrum\s*2$/);
    expect(screen.getByRole("list", { name: /^Notes in the week of/ }).children).toHaveLength(3);
    // Unavailable on this week, but still focusable (aria-disabled, not disabled).
    const next = screen.getByRole("button", { name: /Next week/ });
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toBeDisabled();
  });

  it("steps back a week", () => {
    seed(WEEK);
    renderPage();
    openWeek();
    fireEvent.click(screen.getByRole("button", { name: /Previous week/ }));
    expect(screen.getByRole("list", { name: /^Notes in the week of/ }).children).toHaveLength(1);
    expect(screen.getByText("Kudos to the team for the demo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(screen.getByRole("heading", { name: "This week", level: 2 })).toBeInTheDocument();
  });

  it("announces each week it moves to and never drops focus to the page", async () => {
    seed(WEEK);
    renderPage();
    openWeek();
    const polite = () => screen.getByTestId("live-polite");
    fireEvent.click(screen.getByRole("button", { name: /Previous week/ }));
    await waitFor(() =>
      expect(polite()).toHaveTextContent(
        `Week of ${formatDay(LAST_MONDAY)}, ${formatDay(LAST_MONDAY)} to ${formatDay(shiftDay(LAST_MONDAY, 6))}: 1 note`
      )
    );
    // "This week" goes with the week it leaves: focus moves to Previous week.
    const back = screen.getByRole("button", { name: "This week" });
    back.focus();
    fireEvent.click(back);
    expect(screen.queryByRole("button", { name: "This week" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Previous week/ }));
    await waitFor(() => expect(polite()).toHaveTextContent(/^This week, .+: 3 notes$/));
    // Next week on this week does nothing, and keeps focus.
    const next = screen.getByRole("button", { name: /Next week/ });
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole("heading", { name: "This week", level: 2 })).toBeInTheDocument();
    expect(document.activeElement).toBe(next);
  });

  it("says the week's read is ready, and Keep hands focus to the kept summary", async () => {
    seed(WEEK);
    renderPage();
    openWeek();
    fireEvent.click(screen.getByRole("button", { name: "Sum up this week" }));
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        /^Amr's read of the week is ready below: a summary, 1 pattern and \d tools? to try\.$/
      )
    );
    const keep = within(screen.getByTestId("weekly-review")).getByRole("button", {
      name: "Keep as a note",
    });
    keep.focus();
    fireEvent.click(keep);
    expect(screen.queryByTestId("weekly-review")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Kept summary" }));
  });

  it("puts focus back on the button that asked when the read is dismissed", () => {
    seed(WEEK);
    renderPage();
    openWeek();
    fireEvent.click(screen.getByRole("button", { name: "Sum up this week" }));
    const dismiss = within(screen.getByTestId("weekly-review")).getByRole("button", {
      name: "Dismiss",
    });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(screen.queryByTestId("weekly-review")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sum up this week" }));
  });

  it("says nothing leaves the browser when the week is summed up without AI", () => {
    seed(WEEK);
    renderPage();
    openWeek();
    expect(
      screen.getByText(
        /^Sum up this week reads your notes here in this browser; nothing leaves it\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Ask Amr sends this week's notes/)).not.toBeInTheDocument();
  });

  it("says what Ask Amr sends when it will send it", () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    seed(WEEK);
    renderPage();
    openWeek();
    expect(
      screen.getByText(/^Ask Amr sends this week's notes, each cut to 800 characters/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing leaves it/)).not.toBeInTheDocument();
  });

  it("makes each tool to try a touch-sized link", () => {
    seed(WEEK);
    renderPage();
    openWeek();
    fireEvent.click(screen.getByRole("button", { name: "Sum up this week" }));
    const link = within(screen.getByTestId("weekly-review")).getByRole("link", {
      name: "Impediment Tracker",
    });
    expect(link.className).toContain("min-touch-coarse");
    expect(link.className).toContain("inline-flex");
  });

  it("reads the week without AI, and keeps it as a note only on request, with Undo", () => {
    seed(WEEK);
    renderPage();
    openWeek();
    fireEvent.click(screen.getByRole("button", { name: "Sum up this week" }));
    const review = within(screen.getByTestId("weekly-review"));
    expect(review.getByText(/^Written without AI/)).toBeInTheDocument();
    const summary = review.getByLabelText("Summary", { exact: false }) as HTMLTextAreaElement;
    expect(summary.value).toMatch(/^3 notes in the week of .+, 2 of them from the Daily Scrum\./);
    const pattern = review.getByRole("checkbox", {
      name: "“blockers” came up in 2 notes, at the Daily Scrum.",
    });
    expect(pattern).toBeChecked();
    expect(review.getByRole("link", { name: "Impediment Tracker" })).toHaveAttribute(
      "href",
      "/impediments"
    );
    expect(stored()).toHaveLength(4);

    fireEvent.change(summary, { target: { value: "A week of waiting." } });
    fireEvent.click(review.getByRole("button", { name: "Keep as a note" }));
    const kept = stored().find((e) => e.tags.includes(SUMMARY_TAG))!;
    expect(kept).toMatchObject({
      title: expect.stringMatching(/^Week of .+: summary$/),
      body: "A week of waiting.\n\nPatterns:\n- “blockers” came up in 2 notes, at the Daily Scrum.",
      tags: [SUMMARY_TAG],
    });
    expect(kept.date >= MONDAY && kept.date <= TODAY).toBe(true);
    expect(logged("summary_saved")).toEqual([
      { noteId: kept.id, weekStart: MONDAY, source: "fallback", patterns: 1 },
    ]);
    expect(screen.queryByTestId("weekly-review")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kept summary" })).toBeInTheDocument();
    // A kept summary never counts in its week.
    expect(screen.getByRole("list", { name: /^Notes in the week of/ }).children).toHaveLength(3);
    undoLast();
    expect(stored().some((e) => e.tags.includes(SUMMARY_TAG))).toBe(false);
  });

  it("keeps only the patterns left ticked, and dismisses without saving", () => {
    seed(WEEK);
    renderPage();
    openWeek();
    fireEvent.click(screen.getByRole("button", { name: "Sum up this week" }));
    let review = within(screen.getByTestId("weekly-review"));
    for (const box of review.queryAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(review.getByRole("button", { name: "Keep as a note" }));
    expect(stored().find((e) => e.tags.includes(SUMMARY_TAG))!.body).not.toContain("Patterns:");

    fireEvent.click(screen.getByRole("button", { name: "Sum up this week" }));
    review = within(screen.getByTestId("weekly-review"));
    fireEvent.click(review.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("weekly-review")).not.toBeInTheDocument();
    expect(stored().filter((e) => e.tags.includes(SUMMARY_TAG))).toHaveLength(1);
  });

  it("asks for a note first when the week has none", () => {
    seed([note("prev", LAST_MONDAY)]);
    renderPage();
    openWeek();
    expect(screen.getByText(/No notes in this week\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sum up this week" }));
    expect(screen.getAllByText("Write a note in this week first.").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("weekly-review")).not.toBeInTheDocument();
  });

  it("for the owner, asks Amr's AI and links only the tools the registry knows", async () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              summary: "A week spent waiting on access.",
              patterns: ["The same blocker came up three days running."],
              tools: [
                { id: "kanban", why: "See where work waits." },
                { id: "jira-board", why: "Not a toolkit tool." },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed(WEEK);
    renderPage();
    openWeek();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask Amr about this week" }));
    });
    const review = within(await screen.findByTestId("weekly-review"));
    expect(review.getByText(/^Written by Amr's AI/)).toBeInTheDocument();
    expect(review.getByRole("link", { name: "Kanban Board" })).toHaveAttribute("href", "/kanban");
    expect(review.queryByText(/jira/i)).not.toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/tool");
    const body = JSON.parse(String(init.body)) as { task: string; input: { notes: unknown[] } };
    expect(body.task).toBe("sm-notebook.weekly_summary");
    expect(body.input.notes).toHaveLength(3);
    expect(stored().some((e) => e.tags.includes(SUMMARY_TAG))).toBe(false);
  });
});
