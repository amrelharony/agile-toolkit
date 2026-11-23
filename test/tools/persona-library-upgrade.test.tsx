import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Interview,
  Persona,
  StrategyMap,
  UserInterviewLog,
} from "@/lib/stores/workspace-types";
import type {
  PersonaFromNotesInput,
  PersonaFromNotesOutput,
} from "@/lib/ai/tasks/persona-library.lite";

/**
 * Persona Library (tools plan, phase 2, N24): add and edit with checks at
 * the CRUD's caps and a duplicate-name warning; lists whose points are
 * removed with Undo; delete with Undo; filters; where a persona is used and
 * the interviews it is based on; drafting from notes (contact details taken
 * out first) and from interviews (participants renamed, no dates), which
 * only fills the form; the Impact Map links; the example; and no persona
 * text in any history payload.
 */

const h = vi.hoisted(() => ({
  logs: [] as { action: string; payload: Record<string, unknown> }[],
  inputs: [] as PersonaFromNotesInput[],
  canned: null as PersonaFromNotesOutput | null,
}));
const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/persona-library",
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
// Records what the draft was asked with; a canned answer stands in for a model's.
vi.mock("@/lib/ai/tasks/persona-library.lite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tasks/persona-library.lite")>();
  return {
    ...actual,
    personaFromNotesTask: {
      ...actual.personaFromNotesTask,
      fallback: (input: PersonaFromNotesInput) => {
        h.inputs.push(input);
        return h.canned ?? actual.personaFromNotesFallback(input);
      },
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

import { PersonaLibraryClient } from "@/app/(tools)/persona-library/persona-library-client";
import {
  INTERVIEWS_AI_LINE,
  NAME_HINT,
  NOTES_AI_LINE,
} from "@/app/(tools)/persona-library/persona-form";
import { emptyFields, validatePersona } from "@/app/(tools)/persona-library/form";
import { buildExample } from "@/app/(tools)/persona-library/example";
import { personasMarkdown } from "@/app/(tools)/persona-library/markdown";
import { personaFromNotesFallback } from "@/lib/ai/tasks/persona-library.lite";
import { PERSONA_NAMES } from "@/lib/personas/from-notes";
import { interviewNotes } from "@/lib/personas/interviews";

const AT = "2026-11-20T10:00:00.000Z";
const persona = (id: string, over: Partial<Persona> = {}): Persona => ({
  id,
  name: "Maya",
  role: "Shift nurse",
  tier: "primary",
  evidence: "some",
  goals: ["Dinner in 30 minutes"],
  pains: ["Late deliveries"],
  behaviours: [],
  tags: ["mobile"],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const impactMap = (personaId?: string): StrategyMap => ({
  id: "strategyMap_1",
  format: "impact-map",
  title: "Fewer refund calls",
  nodes: [
    { id: "g", parentId: null, level: 0, text: "Fewer refund calls" },
    {
      id: "a1",
      parentId: "g",
      level: 1,
      text: "Busy parents",
      ...(personaId ? { personaId } : {}),
    },
  ],
  createdAt: AT,
  updatedAt: AT,
});
const INTERVIEWS: Interview[] = [
  {
    id: "i1",
    date: "2026-11-02T09:00:00.000Z",
    participant: "Dana Lee",
    context: "Dana works nights at the hospital.",
    quotes: [
      { id: "q1", text: "Dana here: I want dinner sorted before my shift.", tags: [] },
      { id: "q2", text: "It is frustrating when the box comes late.", tags: [] },
    ],
  },
  {
    id: "i2",
    date: "2026-11-03T09:00:00.000Z",
    participant: "Sam",
    quotes: [{ id: "q3", text: "I usually order on Sunday.", tags: [] }],
  },
];
const LOG: UserInterviewLog = { id: "userInterviewLog:current", interviews: INTERVIEWS };

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().personas ?? [];
const seed = (personas: Persona[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    personas,
    strategyMaps: [],
    userInterviewLogs: [],
    ...extra,
  });
const logged = (action: string) => h.logs.filter((l) => l.action === action).map((l) => l.payload);
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
/** Presses Undo on the toast with this label: the last one, or the `nth` (0 = first). */
const undoToast = (label: string, nth?: number) => {
  const calls = toastSpy.mock.calls.filter((c) => c[0] === label);
  const call = nth === undefined ? calls.at(-1) : calls[nth];
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <PersonaLibraryClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const card = (name: string) => screen.getByRole("article", { name });

beforeEach(() => {
  h.logs = [];
  h.inputs = [];
  h.canned = null;
  toastSpy.mockReset();
  window.history.replaceState(null, "", "/persona-library");
  seed([]);
});
afterEach(() => {
  window.history.replaceState(null, "", "/persona-library");
});

describe("Persona Library first run", () => {
  it("offers the example, shows its cards, and clears it", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Load an example" }));
    expect(stored().map((p) => p.id)).toEqual([
      "example-persona-maya",
      "example-persona-tom",
      "example-persona-riley",
    ]);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    const maya = card("Maya");
    expect(within(maya).getByText("Main")).toBeInTheDocument();
    expect(within(maya).getByText("Some evidence")).toBeInTheDocument();
    expect(within(card("Riley")).getByText("Not for us")).toBeInTheDocument();
    expect(within(card("Tom")).getByText("Our guess")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(stored()).toEqual([]);
    // The example is never the team's history.
    expect(h.logs).toEqual([]);
  });

  it("shows the name hint and Decision D4's line by the notes draft", async () => {
    renderPage();
    expect(await screen.findByText(NAME_HINT)).toBeInTheDocument();
    expect(screen.getByText(NOTES_AI_LINE)).toBeInTheDocument();
    expect(NOTES_AI_LINE).toBe(
      "Names and contact details aren't all caught. Take them out before you ask Amr."
    );
    expect(INTERVIEWS_AI_LINE).toBe(
      "Participant names become Participant 1, 2… Other names in quotes aren't caught, so check before you ask Amr."
    );
  });
});

describe("validatePersona", () => {
  it("asks for a name and a role, and holds every field to the CRUD's caps", () => {
    const blank = validatePersona(emptyFields("primary"));
    expect(blank.ok).toBe(false);
    if (!blank.ok) {
      expect(blank.errors.name).toBe("Give the persona a made-up name.");
      expect(blank.errors.role).toBe("Say what they do: their role.");
    }
    const over = validatePersona({
      ...emptyFields("primary"),
      name: "n".repeat(201),
      role: "r",
      summary: "s".repeat(1001),
      quote: "q".repeat(201),
      context: "c".repeat(1001),
      goals: Array.from({ length: 9 }, (_, i) => `g${i}`),
      tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(","),
      interviewIds: Array.from({ length: 21 }, (_, i) => `i${i}`),
    });
    expect(over.ok).toBe(false);
    if (!over.ok)
      expect(Object.keys(over.errors).sort()).toEqual(
        ["context", "goals", "interviewIds", "name", "quote", "summary", "tags"].sort()
      );
    const ok = validatePersona({
      ...emptyFields("anti"),
      name: "  Riley ",
      role: "Deal hunter",
      tags: "deals, , churn",
    });
    expect(ok).toEqual({
      ok: true,
      values: expect.objectContaining({
        name: "Riley",
        tier: "anti",
        tags: ["deals", "churn"],
        interviewIds: [],
      }),
    });
  });
});

describe("adding and editing", () => {
  it("refuses an empty save, then adds a persona with its goals, stamped, as the main one", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add persona" }));
    expect(await screen.findByText("Give the persona a made-up name.")).toBeInTheDocument();
    expect(stored()).toEqual([]);

    type(/^Name/, "Maya");
    type(/^Role/, "Shift nurse");
    const goal = screen.getByLabelText("Add a goal");
    fireEvent.change(goal, { target: { value: "Dinner in 30 minutes" } });
    // Enter adds the point; it doesn't save the form.
    fireEvent.keyDown(goal, { key: "Enter" });
    expect(stored()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Add persona" }));

    expect(stored()).toHaveLength(1);
    const p = stored()[0];
    expect(p).toMatchObject({
      name: "Maya",
      role: "Shift nurse",
      tier: "primary",
      evidence: "assumed",
      goals: ["Dinner in 30 minutes"],
    });
    expect(p.id).toMatch(/^persona_/);
    expect(p.createdAt).toBe(p.updatedAt);
    expect(logged("persona_created")).toEqual([
      { personaId: p.id, tier: "primary", evidence: "assumed" },
    ]);
    expect(within(card("Maya")).getByText("Dinner in 30 minutes")).toBeInTheDocument();
  });

  it("starts the next persona as also served, and warns about a name already used", async () => {
    seed([persona("persona_a")]);
    renderPage();
    const tier = await screen.findByRole("radiogroup", { name: "Tier" });
    expect(within(tier).getByRole("radio", { name: "Also served" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    type(/^Name/, " maya ");
    expect(screen.getByText(/Another persona is already called “Maya”/)).toBeInTheDocument();
    type(/^Name/, "Noor");
    expect(screen.queryByText(/Another persona is already called/)).not.toBeInTheDocument();
  });

  it("holds a list to 8 points, skips repeats, and removes a point with Undo", async () => {
    renderPage();
    const add = async (text: string) => {
      fireEvent.change(await screen.findByLabelText("Add a habit"), { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "Add habit" }));
    };
    for (let i = 1; i <= 8; i++) await add(`Habit ${i}`);
    expect(screen.getByText(/Full: 8 is the most/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a habit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove habit “Habit 3”" }));
    expect(screen.queryByText("Habit 3")).not.toBeInTheDocument();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Removed habit “Habit 3”");
    undoLast();
    const list = screen.getByRole("list", { name: "Habits" });
    expect(within(list).getAllByRole("listitem")[2]).toHaveTextContent("Habit 3");

    await waitFor(() => expect(screen.getByLabelText("Add a goal")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Add a goal"), { target: { value: "Eat well" } });
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    fireEvent.change(screen.getByLabelText("Add a goal"), { target: { value: "eat well" } });
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(screen.getByText("Already on the list.")).toBeInTheDocument();
  });

  it("adds a point with Undo, which takes it back only from the form it went into", async () => {
    seed([persona("persona_a")]);
    renderPage();
    const addGoal = async (text: string) => {
      fireEvent.change(await screen.findByLabelText("Add a goal"), { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    };
    await addGoal("Eat well");
    await addGoal("Cook less");
    const goals = () =>
      within(screen.getByRole("list", { name: "Goals" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent);
    expect(goals()).toEqual(["Eat well", "Cook less"]);
    const [label, opts] = toastSpy.mock.calls.at(-1) ?? [];
    expect(label).toBe("Added goal “Cook less”");
    expect(opts).toMatchObject({ kind: "success" });
    // Undo of the first add takes that point back, leaving the later one.
    undoToast("Added goal “Eat well”");
    expect(goals()).toEqual(["Cook less"]);

    // An add to an edit that was then cancelled is never taken back from another form.
    fireEvent.click(screen.getByRole("button", { name: "Edit Maya" }));
    await addGoal("Sleep more");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await addGoal("Sleep more");
    undoToast("Added goal “Sleep more”", 0);
    expect(screen.getByRole("list", { name: "Goals" })).toHaveTextContent("Sleep more");
    expect(stored()[0].goals).toEqual(["Dinner in 30 minutes"]);
  });

  it("edits a persona in the same form, keeping its id and createdAt", async () => {
    seed([persona("persona_a")]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Maya" }));
    expect(screen.getByText("Edit “Maya”")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Role/)).toHaveValue("Shift nurse");
    type(/^Role/, "Night-shift nurse");
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      id: "persona_a",
      role: "Night-shift nurse",
      createdAt: AT,
      goals: ["Dinner in 30 minutes"],
    });
    expect(stored()[0].updatedAt).not.toBe(AT);
    expect(logged("persona_updated")).toEqual([{ personaId: "persona_a" }]);
    expect(screen.getByText("Add a persona")).toBeInTheDocument();
  });

  it("cancels an edit without saving", async () => {
    seed([persona("persona_a")]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Maya" }));
    type(/^Role/, "Changed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stored()[0].role).toBe("Shift nurse");
    expect(screen.getByLabelText(/^Role/)).toHaveValue("");
  });

  it("deletes a persona with Undo", async () => {
    seed([persona("persona_a"), persona("persona_b", { name: "Tom", tier: "secondary" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Maya" }));
    expect(stored().map((p) => p.id)).toEqual(["persona_b"]);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted “Maya”");
    expect(logged("persona_removed")).toEqual([{ personaId: "persona_a" }]);
    undoLast();
    expect(
      stored()
        .map((p) => p.id)
        .sort()
    ).toEqual(["persona_a", "persona_b"]);
    expect(stored().find((p) => p.id === "persona_a")).toEqual(persona("persona_a"));
  });
});

describe("the library", () => {
  it("filters by tier, evidence and tag", async () => {
    seed([
      persona("persona_a"),
      persona("persona_b", {
        name: "Tom",
        tier: "secondary",
        evidence: "assumed",
        tags: ["teams"],
      }),
      persona("persona_c", { name: "Riley", tier: "anti", tags: ["teams", "deals"] }),
    ]);
    renderPage();
    await screen.findByText("Personas (3)");
    fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), { target: { value: "teams" } });
    expect(screen.getByText("Showing 2 of 3 personas.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Evidence" }), {
      target: { value: "assumed" },
    });
    expect(screen.queryByRole("article", { name: "Riley" })).not.toBeInTheDocument();
    expect(card("Tom")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Tier" }), {
      target: { value: "primary" },
    });
    expect(screen.getByText("No persona matches these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("says which Impact Maps use a persona and how many interviews it is based on", async () => {
    seed(
      [
        persona("persona_a", { interviewIds: ["i1", "i2", "gone"] }),
        persona("persona_b", { name: "Tom" }),
      ],
      {
        strategyMaps: [impactMap("persona_a")],
        userInterviewLogs: [LOG],
      }
    );
    renderPage();
    const maya = await screen.findByRole("article", { name: "Maya" });
    expect(within(maya).getByText(/Used on 1 Impact Map/)).toBeInTheDocument();
    expect(within(maya).getByRole("link", { name: "Fewer refund calls" })).toHaveAttribute(
      "href",
      "/impact-map?map=strategyMap_1"
    );
    expect(within(maya).getByText("Based on 2 interviews")).toBeInTheDocument();
    expect(within(card("Tom")).getByText("Not on an Impact Map yet")).toBeInTheDocument();
  });

  it("exports Markdown with each persona and no interview's participant", async () => {
    seed([persona("persona_a", { interviewIds: ["i1"], quote: "Toast again." })], {
      userInterviewLogs: [LOG],
    });
    renderPage();
    const md = (await screen.findByTestId("export-markdown")).textContent ?? "";
    expect(md).toMatch(/^# Personas — /);
    expect(md).toContain("## Maya, Shift nurse");
    expect(md).toContain("Main persona · Some evidence");
    expect(md).toContain("**Goals**\n\n- Dinner in 30 minutes");
    expect(md).toContain("**Frustrations**\n\n- Late deliveries");
    expect(md).toContain("> Toast again.");
    expect(md).toContain("Based on 1 interview.");
    expect(md).not.toContain("Dana");
    expect(screen.getByTestId("ai-prompt").textContent).toContain("Maya");
  });

  it("builds Markdown for the example and an empty library", () => {
    const md = personasMarkdown(
      buildExample(new Date("2026-11-23T12:00:00Z")),
      [],
      new Date("2026-11-23T12:00:00Z")
    );
    expect(md).toContain("# Personas — 23 Nov 2026");
    expect(md).toContain("## Riley, Deal hunter who cancels after the first discount");
    expect(md).toContain("Not for us persona · Some evidence");
    expect(personasMarkdown([])).toContain("No personas yet.");
  });
});

describe("drafting a persona", () => {
  it("drafts from notes without AI, contact details out first, and saves nothing until Save", async () => {
    seed([persona("persona_a", { name: "Tom", tier: "primary" })]);
    renderPage();
    fireEvent.click(await screen.findByText("Draft from notes"));
    const button = screen.getByRole("button", { name: "Draft without AI" });
    fireEvent.change(screen.getByLabelText("Research notes"), { target: { value: "Too short" } });
    fireEvent.click(button);
    expect(h.inputs).toEqual([]);
    expect(
      screen.getAllByText("Paste at least 20 characters of notes first.").length
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Research notes"), {
      target: {
        value:
          "As a nurse on nights I plan dinner on my phone. Mail me at nurse@example.com.\nI want dinner sorted before I get home.\nIt's frustrating when the box is late.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft without AI" }));
    expect(h.inputs).toHaveLength(1);
    expect(h.inputs[0].notes).not.toContain("nurse@example.com");
    expect(h.inputs[0].notes).toContain("[redacted:email]");
    expect(h.inputs[0].names).toEqual(["Tom"]);
    expect(h.inputs[0].tier).toBe("secondary");

    expect(await screen.findByText(/Drafted without AI\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Role/)).toHaveValue("Nurse on nights");
    expect(screen.getByLabelText(/^Name/)).not.toHaveValue("Tom");
    expect(
      within(screen.getByRole("list", { name: "Goals" })).getByText(/I want dinner sorted/)
    ).toBeInTheDocument();
    // Nothing is saved before Save.
    expect(stored()).toHaveLength(1);
    expect(logged("persona_drafted")).toEqual([{ source: "rules", interviews: 0 }]);
    fireEvent.click(screen.getByRole("button", { name: "Add persona" }));
    expect(stored()).toHaveLength(2);
  });

  it("fills only blank fields and adds to the lists, keeping what was typed", async () => {
    h.canned = {
      name: "Noor",
      role: "Drafted role",
      summary: "A drafted summary.",
      goals: ["Drafted goal"],
      pains: [],
      behaviours: ["Drafted habit"],
      quote: "A drafted quote.",
      tags: ["drafted"],
    };
    renderPage();
    await screen.findByLabelText(/^Name/);
    type(/^Name/, "Ana");
    fireEvent.change(screen.getByLabelText("Add a goal"), { target: { value: "My goal" } });
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    fireEvent.click(screen.getByText("Draft from notes"));
    fireEvent.change(screen.getByLabelText("Research notes"), {
      target: { value: "Plenty of notes about the people we build for." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft without AI" }));
    await screen.findByText(/Drafted without AI\./);
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Ana");
    expect(screen.getByLabelText(/^Role/)).toHaveValue("Drafted role");
    expect(screen.getByLabelText("Quote")).toHaveValue("A drafted quote.");
    const goals = within(screen.getByRole("list", { name: "Goals" })).getAllByRole("listitem");
    expect(goals.map((g) => g.textContent)).toEqual(["My goal", "Drafted goal"]);
  });

  it("drafts from picked interviews: participants renamed, no dates, interviews linked", async () => {
    seed([], { userInterviewLogs: [LOG] });
    renderPage();
    expect(await screen.findByText(INTERVIEWS_AI_LINE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Draft from the interviews without AI" }));
    expect(h.inputs).toEqual([]);
    fireEvent.click(screen.getByLabelText(/Dana Lee · 2026-11-02/));
    fireEvent.click(screen.getByLabelText(/Sam · 2026-11-03/));
    fireEvent.click(screen.getByRole("button", { name: "Draft from the interviews without AI" }));
    expect(h.inputs).toHaveLength(1);
    const notes = h.inputs[0].notes;
    expect(notes).toContain("Participant 1:");
    expect(notes).toContain("“Participant 1 here: I want dinner sorted before my shift.”");
    for (const leak of ["Dana", "Sam", "2026-11", "q1", "i1"]) expect(notes).not.toContain(leak);

    await screen.findByText(/Drafted without AI\./);
    // A persona drafted from interviews has some evidence.
    const evidence = screen.getByRole("radiogroup", { name: "Evidence" });
    expect(within(evidence).getByRole("radio", { name: "Some evidence" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(logged("persona_drafted")).toEqual([{ source: "rules", interviews: 2 }]);
    fireEvent.click(screen.getByRole("button", { name: "Add persona" }));
    expect(stored()[0].interviewIds).toEqual(["i1", "i2"]);
    expect(stored()[0].evidence).toBe("some");
  });

  it("never calls a draft by an interviewee's real name", async () => {
    const base: Interview = {
      id: "i9",
      date: "2026-11-02T09:00:00.000Z",
      participant: "Someone",
      quotes: [
        { id: "q9", text: "I want dinner sorted before my shift.", tags: [] },
        { id: "q10", text: "It is frustrating when the box comes late.", tags: [] },
      ],
    };
    // The notes are the same whoever the participant is, so the name the
    // rules would pick is known before the participant is named after it.
    const notes = interviewNotes([base]);
    const picked = personaFromNotesFallback({ notes, tier: "primary", names: [] }).name;
    const real: Interview = { ...base, participant: `${picked} Park` };
    expect(interviewNotes([real])).toBe(notes);
    seed([], { userInterviewLogs: [{ id: "userInterviewLog:current", interviews: [real] }] });
    renderPage();
    fireEvent.click(await screen.findByLabelText(new RegExp(`^${picked} Park · 2026-11-02`)));
    fireEvent.click(screen.getByRole("button", { name: "Draft from the interviews without AI" }));
    // The real names stay out of what is asked.
    expect(h.inputs).toEqual([{ notes, tier: "primary", names: [] }]);
    await screen.findByText(/Drafted without AI\./);
    const name = (screen.getByLabelText(/^Name/) as HTMLInputElement).value;
    expect(name).not.toBe(picked);
    expect(PERSONA_NAMES).toContain(name);

    // A model's answer that lands on the name is swapped too.
    h.canned = {
      name: picked,
      role: "Nurse",
      goals: [],
      pains: [],
      behaviours: [],
      tags: [],
    };
    type(/^Name/, "");
    fireEvent.click(screen.getByRole("button", { name: "Draft from the interviews without AI" }));
    await waitFor(() => expect(h.inputs).toHaveLength(2));
    expect(screen.getByLabelText(/^Name/)).not.toHaveValue(picked);
    expect(screen.getByLabelText(/^Name/)).not.toHaveValue("");
  });

  it("links at most 20 interviews", async () => {
    const many: Interview[] = Array.from({ length: 21 }, (_, k) => ({
      id: `i${k}`,
      date: `2026-10-${String(k + 1).padStart(2, "0")}T09:00:00.000Z`,
      participant: `Person ${k}`,
      quotes: [{ id: `q${k}`, text: "I want it to be quick.", tags: [] }],
    }));
    seed([], { userInterviewLogs: [{ id: "userInterviewLog:current", interviews: many }] });
    renderPage();
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(21);
    for (const box of boxes.slice(0, 20)) fireEvent.click(box);
    expect(boxes[20]).toBeDisabled();
    fireEvent.click(boxes[0]);
    expect(boxes[20]).not.toBeDisabled();
  });
});

describe("history and safety", () => {
  it("logs ids, tiers and counts, never a persona's words", async () => {
    seed([], { userInterviewLogs: [LOG] });
    renderPage();
    await screen.findByLabelText(/^Name/);
    type(/^Name/, "Secret Name");
    type(/^Role/, "Secret role");
    fireEvent.click(screen.getByRole("button", { name: "Add persona" }));
    const id = stored()[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Edit Secret Name" }));
    type(/^Role/, "Another secret");
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Secret Name" }));
    expect(h.logs.map((l) => l.action)).toEqual([
      "persona_created",
      "persona_updated",
      "persona_removed",
    ]);
    const text = JSON.stringify(h.logs);
    expect(text).not.toMatch(/Secret|secret/);
    expect(h.logs.every((l) => l.payload.personaId === id)).toBe(true);
  });

  it("never logs a change to the example's personas", async () => {
    seed(buildExample(new Date()));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Tom" }));
    type(/^Role/, "Changed");
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Riley" }));
    expect(stored().find((p) => p.name === "Tom")?.role).toBe("Changed");
    expect(h.logs).toEqual([]);
  });

  it("puts a removed point back only into the form it came from", async () => {
    seed([persona("persona_a", { behaviours: ["Orders on Sunday"] })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Maya" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove habit “Orders on Sunday”" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    undoLast();
    expect(screen.queryByText("Orders on Sunday", { selector: "span" })).not.toBeInTheDocument();
    // The saved persona never lost it.
    expect(stored()[0].behaviours).toEqual(["Orders on Sunday"]);
  });

  it("leaves the form when the persona being edited is deleted", async () => {
    seed([persona("persona_a"), persona("persona_b", { name: "Tom", tier: "secondary" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Tom" }));
    expect(screen.getByText("Edit “Tom”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Tom" }));
    expect(screen.getByText("Add a persona")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("");
  });
});

describe("links", () => {
  it("?fromMap=&actor= starts a persona for that actor, then links back to the map", async () => {
    seed([], { strategyMaps: [impactMap()] });
    window.history.replaceState(null, "", "/persona-library?fromMap=strategyMap_1&actor=a1");
    renderPage();
    expect(
      await screen.findByText(/A persona for the actor “Busy parents” on “Fewer refund calls”/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Role/)).toHaveValue("Busy parents");
    expect(window.location.search).toBe("");
    type(/^Name/, "Maya");
    fireEvent.click(screen.getByRole("button", { name: "Add persona" }));
    expect(stored()[0].role).toBe("Busy parents");
    expect(screen.getByRole("link", { name: "Back to the Impact Map" })).toHaveAttribute(
      "href",
      "/impact-map?map=strategyMap_1"
    );
  });

  it("?persona=<id> opens and focuses that persona's card, clearing the filters", async () => {
    seed([persona("persona_a"), persona("persona_b", { name: "Tom" })]);
    window.history.replaceState(null, "", "/persona-library?persona=persona_b");
    renderPage();
    const tom = await screen.findByRole("article", { name: "Tom" });
    await waitFor(() => expect(tom).toHaveFocus());
    expect(tom.className).toContain("border-accent");
    expect(window.location.search).toBe("");
  });

  it("drops a link to a persona or actor that is gone", async () => {
    window.history.replaceState(null, "", "/persona-library?fromMap=nope&actor=x");
    renderPage();
    await screen.findByText(NAME_HINT);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.getByLabelText(/^Role/)).toHaveValue("");
  });
});
