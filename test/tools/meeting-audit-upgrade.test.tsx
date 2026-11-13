import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MeetingAudit } from "@/lib/stores/workspace-types";
import { MEETING_AUDIT_ACTIONS } from "@/lib/history/event-actions";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

/**
 * Meeting Audit (shelved, on the full contract) on workspace.meetingAudits:
 * an add form that saves nothing until the name, cadence, length and
 * headcount are in (no silent 0), the weekly cost of each meeting, ratings
 * in one meeting's panel at a time, verdicts (Amr's cheer once every meeting
 * has one, from a verdict or an accepted change), in-place edit and delete
 * with Undo, the suggestions without AI and with it (accepted into the notes
 * with Undo, one or all), the ritual reset plan, a new round with Undo, the
 * example, the export, keyboard focus after every change, and what the live
 * announcer says.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/meeting-audit",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.push(args),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { MeetingAuditClient } from "@/app/(tools)/meeting-audit/meeting-audit-client";

const ws = () => useWorkspaceStore.getState();
const audits = () => ws().meetingAudits ?? [];
const find = (id: string) => audits().find((a) => a.id === id);

const AT = "2026-11-12T09:00:00.000Z";
const audit = (over: Partial<MeetingAudit> = {}): MeetingAudit => ({
  id: "m1",
  meeting: "Weekly sync",
  cadence: "weekly",
  minutes: 60,
  attendees: 6,
  purpose: "Share progress.",
  ratings: {},
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const seed = (meetingAudits: MeetingAudit[]) => useWorkspaceStore.setState({ meetingAudits });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <MeetingAuditClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const logged = (action: string) => logs.filter((l) => l.action === action);
const card = (id: string) => document.getElementById(`meeting-${id}`)!;
/** A meeting's name on its card, where focus lands after a change. */
const nameOf = (id: string) => document.querySelector(`[data-meeting-name="${id}"]`);
const focusIs = (el: () => Element | null) =>
  waitFor(() => {
    const target = el();
    expect(target).not.toBeNull();
    expect(document.activeElement).toBe(target);
  });
/** What the live announcer said last. */
const announced = (text: string | RegExp) =>
  waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(text));
/** The cards' order on screen. */
const order = () =>
  Array.from(document.querySelectorAll("[data-meeting-name]")).map((e) =>
    e.getAttribute("data-meeting-name")
  );

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  seed([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("an empty audit", () => {
  it("says what to do and loads the example without logging it", async () => {
    renderPage();
    expect(await screen.findByText(/No meetings audited yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(audits()).toHaveLength(6);
    expect(audits().every((a) => a.id.startsWith("example-"))).toBe(true);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ritual reset plan" })).toBeInTheDocument();
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(audits()).toEqual([]);
    undoLast();
    expect(audits()).toHaveLength(6);
  });
});

describe("adding a meeting", () => {
  it("saves nothing until the name, cadence, minutes and people are in", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add meeting" }));
    const form = screen.getByRole("textbox", { name: /^Meeting/ }).closest("form")!;
    fireEvent.click(within(form).getByRole("button", { name: "Add meeting" }));
    expect(await within(form).findByText("Name the meeting.")).toBeInTheDocument();
    expect(within(form).getByText("Pick how often it meets.")).toBeInTheDocument();
    expect(within(form).getByText("Say how many minutes it takes.")).toBeInTheDocument();
    expect(within(form).getByText("Say how many people attend.")).toBeInTheDocument();
    expect(audits()).toEqual([]);
  });

  it("adds a meeting with its weekly cost, and logs it", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add meeting" }));
    const form = screen.getByRole("textbox", { name: /^Meeting/ }).closest("form")!;
    fireEvent.change(within(form).getByRole("textbox", { name: /^Meeting/ }), {
      target: { value: "Daily Scrum" },
    });
    fireEvent.click(within(form).getByRole("radio", { name: "Daily" }));
    fireEvent.change(within(form).getByRole("spinbutton", { name: /^Minutes each time/ }), {
      target: { value: "20" },
    });
    fireEvent.change(within(form).getByRole("spinbutton", { name: /^People attending/ }), {
      target: { value: "9" },
    });
    expect(within(form).getByText("≈ 15 person-hours a week")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Add meeting" }));
    expect(audits()).toEqual([
      expect.objectContaining({
        meeting: "Daily Scrum",
        cadence: "daily",
        minutes: 20,
        attendees: 9,
        purpose: "",
        ratings: {},
      }),
    ]);
    expect(audits()[0].id).toMatch(/^meeting_/);
    expect(logged(MEETING_AUDIT_ACTIONS.MEETING_ADDED)[0].payload).toMatchObject({
      meeting: "Daily Scrum",
    });
    expect(
      screen.getByText(/1 recurring meeting takes 15 person-hours a week/, { selector: "p" })
    ).toBeInTheDocument();
  });
});

describe("rating and verdicts", () => {
  it("rates in one meeting's panel at a time, each pick saved", async () => {
    seed([audit(), audit({ id: "m2", meeting: "Planning", minutes: 30 })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rate: Weekly sync" }));
    expect(screen.getAllByRole("radiogroup", { name: "Useful outcome" })).toHaveLength(1);
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Useful outcome" })).getByRole("radio", {
        name: "2",
      })
    );
    expect(find("m1")?.ratings).toEqual({ outcome: 2 });
    expect(logged(MEETING_AUDIT_ACTIONS.MEETING_RATED)[0].payload).toEqual({
      meetingId: "m1",
      question: "outcome",
      rating: 2,
    });
    expect(within(card("m1")).getByText(/low on useful outcome/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rate: Planning" }));
    expect(screen.getAllByRole("radiogroup", { name: "Useful outcome" })).toHaveLength(1);
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Useful outcome" })).getByRole("radio", {
        name: "4",
      })
    );
    expect(find("m2")?.ratings).toEqual({ outcome: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Clear Useful outcome" }));
    expect(find("m2")?.ratings).toEqual({});
  });

  it("sets a verdict per meeting, and Amr cheers once every meeting has one", async () => {
    seed([audit(), audit({ id: "m2", meeting: "Planning" })]);
    renderPage();
    const verdict = async (name: string, v: string) =>
      fireEvent.click(
        within(await screen.findByRole("radiogroup", { name: `Verdict for ${name}` })).getByRole(
          "radio",
          { name: v }
        )
      );
    await verdict("Weekly sync", "Drop");
    expect(find("m1")?.verdict).toBe("drop");
    expect(logged(MEETING_AUDIT_ACTIONS.VERDICT_SET)[0].payload).toEqual({
      meetingId: "m1",
      verdict: "drop",
    });
    expect(cheers).toEqual([]);
    await verdict("Planning", "Keep");
    expect(cheers).toEqual([["meeting-audit", "done"]]);
    expect(
      screen.getByText(/The plan: 1 meeting to drop, which frees 6 person-hours a week\./, {
        selector: "p",
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear the verdict for Planning" }));
    expect(find("m2")).not.toHaveProperty("verdict");
  });
});

describe("editing and deleting", () => {
  it("edits a meeting in place, keeping its ratings and verdict", async () => {
    seed([audit({ ratings: { purpose: 4 }, verdict: "keep" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit: Weekly sync" }));
    const form = within(card("m1"));
    fireEvent.change(form.getByRole("spinbutton", { name: /^Minutes each time/ }), {
      target: { value: "" },
    });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    expect(await form.findByText("Say how many minutes it takes.")).toBeInTheDocument();
    fireEvent.change(form.getByRole("spinbutton", { name: /^Minutes each time/ }), {
      target: { value: "45" },
    });
    fireEvent.change(form.getByRole("textbox", { name: /^What to change/ }), {
      target: { value: "End with decisions" },
    });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    expect(find("m1")).toMatchObject({
      minutes: 45,
      notes: "End with decisions",
      ratings: { purpose: 4 },
      verdict: "keep",
    });
    expect(logged(MEETING_AUDIT_ACTIONS.MEETING_UPDATED)[0].payload).toEqual({
      meetingId: "m1",
      fields: ["minutes", "notes"],
    });
  });

  it("deletes a meeting with Undo", async () => {
    seed([audit()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete: Weekly sync" }));
    expect(audits()).toEqual([]);
    expect(logged(MEETING_AUDIT_ACTIONS.MEETING_REMOVED)).toHaveLength(1);
    undoLast();
    expect(find("m1")).toBeDefined();
  });
});

describe("suggested changes", () => {
  it("suggests without AI, and an accepted change goes into the notes with Undo", async () => {
    seed([audit({ meeting: "Daily Scrum", cadence: "daily", minutes: 30, attendees: 8 })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest changes" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(within(list).getByText("Daily Scrum: Timebox it to 15 minutes")).toBeInTheDocument();
    expect(find("m1")).not.toHaveProperty("notes");
    fireEvent.click(within(list).getByRole("button", { name: /^Add to plan: Daily Scrum/ }));
    expect(find("m1")).toMatchObject({ notes: "Timebox it to 15 minutes", verdict: "change" });
    expect(logged(MEETING_AUDIT_ACTIONS.VERDICT_SET)[0].payload).toEqual({
      meetingId: "m1",
      verdict: "change",
    });
    expect(within(card("m1")).getByText("Timebox it to 15 minutes")).toBeInTheDocument();
    undoLast();
    expect(find("m1")).not.toHaveProperty("notes");
    expect(find("m1")).not.toHaveProperty("verdict");
  });

  it("says so when the rules find nothing to change", async () => {
    seed([audit()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest changes" }));
    expect(await screen.findByText(/No change to suggest yet/)).toBeInTheDocument();
  });
});

describe("the ritual reset plan and a new round", () => {
  it("groups the meetings by verdict and starts a new round with Undo", async () => {
    seed([
      audit({ ratings: { outcome: 1 }, verdict: "drop" }),
      audit({
        id: "m2",
        meeting: "Planning",
        minutes: 30,
        ratings: { purpose: 5 },
        verdict: "keep",
      }),
    ]);
    renderPage();
    await screen.findByRole("heading", { name: "Ritual reset plan" });
    expect(
      screen.getByText("Now 9 person-hours a week. After the drops, 3 person-hours a week.", {
        selector: "p",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Drop (1)" })).toBeInTheDocument();
    expect(
      screen.getByText(/Frees 6 person-hours a week/, { selector: "span" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start a new round" }));
    const dialog = screen.getByRole("dialog", { name: "Start a new round of the audit?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start a new round" }));
    expect(audits().every((a) => Object.keys(a.ratings).length === 0 && !a.verdict)).toBe(true);
    expect(logged(MEETING_AUDIT_ACTIONS.AUDIT_RESET)[0].payload).toEqual({ count: 2 });
    undoLast();
    await waitFor(() => expect(find("m1")?.verdict).toBe("drop"));
  });
});

describe("the export", () => {
  it("writes the table and the plan", async () => {
    seed([audit({ verdict: "drop", notes: "Write it up" })]);
    renderPage();
    await screen.findByRole("heading", { name: "Weekly sync" });
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("| Weekly sync | Weekly | 60 | 6 | 6 | — | Drop |");
    expect(md).toContain("- Weekly sync (frees 6 person-hours a week): Write it up");
  });

  it("exports the team's own meetings, not the example beside them", async () => {
    seed([audit()]);
    renderPage();
    await screen.findByRole("heading", { name: "Weekly sync" });
    act(() =>
      ws().upsertMeetingAudit(audit({ id: "example-x", meeting: "Example forum", minutes: 90 }))
    );
    expect(await screen.findByRole("heading", { name: "Example forum" })).toBeInTheDocument();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("Weekly sync");
    expect(md).not.toContain("Example forum");
  });
});

describe("the form and the list", () => {
  it("tells assistive tech that how often it meets is required", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add meeting" }));
    expect(screen.getByRole("radiogroup", { name: "How often (required)" })).toBeInTheDocument();
  });

  it("keeps a card in place when an edit makes it costlier, until Re-sort", async () => {
    seed([audit(), audit({ id: "m2", meeting: "Planning", minutes: 30 })]);
    renderPage();
    await screen.findByRole("heading", { name: "Planning" });
    expect(order()).toEqual(["m1", "m2"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit: Planning" }));
    const form = within(card("m2"));
    fireEvent.change(form.getByRole("spinbutton", { name: /^Minutes each time/ }), {
      target: { value: "240" },
    });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    expect(find("m2")?.minutes).toBe(240);
    expect(order()).toEqual(["m1", "m2"]);
    fireEvent.click(screen.getByRole("button", { name: /Re-sort/ }));
    expect(order()).toEqual(["m2", "m1"]);
  });

  it("closes a meeting's ratings panel again", async () => {
    seed([audit()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rate: Weekly sync" }));
    expect(screen.getByRole("radiogroup", { name: "Clear purpose" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the ratings: Weekly sync" }));
    expect(screen.queryByRole("radiogroup", { name: "Clear purpose" })).toBeNull();
  });

  it("says each change out loud: added, a verdict, a verdict cleared", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add meeting" }));
    const form = screen.getByRole("textbox", { name: /^Meeting/ }).closest("form")!;
    fireEvent.change(within(form).getByRole("textbox", { name: /^Meeting/ }), {
      target: { value: "Daily Scrum" },
    });
    fireEvent.click(within(form).getByRole("radio", { name: "Daily" }));
    fireEvent.change(within(form).getByRole("spinbutton", { name: /^Minutes each time/ }), {
      target: { value: "20" },
    });
    fireEvent.change(within(form).getByRole("spinbutton", { name: /^People attending/ }), {
      target: { value: "9" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add meeting" }));
    await announced("Added “Daily Scrum”: 15 person-hours a week");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Verdict for Daily Scrum" })).getByRole(
        "radio",
        { name: "Keep" }
      )
    );
    await announced("Daily Scrum: keep");
    fireEvent.click(screen.getByRole("button", { name: "Clear the verdict for Daily Scrum" }));
    await announced("Cleared the verdict for Daily Scrum");
  });
});

describe("accepting changes, further", () => {
  const twoMeetings = () => [
    audit({
      meeting: "Daily Scrum",
      cadence: "daily",
      minutes: 30,
      attendees: 8,
      ratings: { purpose: 1 },
    }),
    audit({ id: "m2", meeting: "Status sync", attendees: 10, ratings: { people: 1 } }),
  ];

  it("adds all, two changes for one meeting, under one Undo", async () => {
    seed(twoMeetings());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest changes" }));
    const list = await screen.findByTestId("ai-suggestions");
    const before = toastSpy.mock.calls.length;
    fireEvent.click(within(list).getByRole("button", { name: "Add to plan all 3" }));
    expect(find("m1")).toMatchObject({
      notes: "Timebox it to 15 minutes\nWrite its purpose in one line at the top of the invite",
      verdict: "change",
    });
    expect(find("m2")).toMatchObject({
      notes: "Invite only the people it needs, and send notes to the rest",
      verdict: "change",
    });
    expect(toastSpy.mock.calls.length - before).toBe(1);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Added 3 changes to the plan");
    expect(logged(MEETING_AUDIT_ACTIONS.MEETING_UPDATED)).toHaveLength(3);
    expect(logged(MEETING_AUDIT_ACTIONS.VERDICT_SET).map((l) => l.payload?.meetingId)).toEqual([
      "m1",
      "m2",
    ]);
    // The last meeting got its verdict from a change: the plan is ready.
    expect(cheers).toEqual([["meeting-audit", "done"]]);
    await announced("Added 3 changes to the plan");

    undoLast();
    for (const id of ["m1", "m2"]) {
      expect(find(id)).not.toHaveProperty("notes");
      expect(find(id)).not.toHaveProperty("verdict");
    }
  });

  it("cheers only when the change gives the team's last meeting its verdict", async () => {
    const [daily, sync] = twoMeetings();
    seed([daily, { ...sync, verdict: "keep" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest changes" }));
    const list = await screen.findByTestId("ai-suggestions");
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Add to plan: Daily Scrum: Timebox it to 15 minutes",
      })
    );
    expect(find("m1")?.verdict).toBe("change");
    expect(cheers).toEqual([["meeting-audit", "done"]]);
    // A second change for a meeting already marked change sets no verdict, and no cheer.
    fireEvent.click(within(list).getByRole("button", { name: /^Add to plan: Daily Scrum: Write/ }));
    expect(cheers).toHaveLength(1);
  });

  it("takes changes on the example's meetings without logging or cheering", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Suggest changes" }));
    const list = await screen.findByTestId("ai-suggestions");
    const notesBefore = new Map(audits().map((a) => [a.id, a.notes ?? ""]));
    fireEvent.click(within(list).getAllByRole("button", { name: /^Add to plan: / })[0]);
    const changed = audits().filter((a) => (a.notes ?? "") !== notesBefore.get(a.id));
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toMatch(/^example-/);
    expect(logs).toEqual([]);
    expect(cheers).toEqual([]);
  });

  it("still suggests for the other meetings when one has an id the task can't take", async () => {
    const [daily, sync] = twoMeetings();
    seed([{ ...daily, id: `meeting_${"x".repeat(70)}` }, sync]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest changes" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText(
        "Status sync: Invite only the people it needs, and send notes to the rest"
      )
    ).toBeInTheDocument();
    expect(within(list).queryByText(/Daily Scrum/)).toBeNull();
    expect(screen.queryByText(/Fill in the tool first/)).toBeNull();
  });

  it("shows Amr's AI answer as his, and adds only what is accepted", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              changes: [
                { meetingId: "m1", change: "Move it to Tuesdays", why: "Mondays are full." },
                { meetingId: "made-up", change: "Cancel it", why: "Not a meeting here." },
              ],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed([audit()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Amr for changes" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested by Amr's AI. Check before you add.")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(list).queryByText(/Cancel it/)).toBeNull();
    expect(find("m1")).not.toHaveProperty("notes");
    fireEvent.click(within(list).getByRole("button", { name: /^Add to plan: Weekly sync: Move/ }));
    expect(find("m1")).toMatchObject({ notes: "Move it to Tuesdays", verdict: "change" });
  });
});

describe("keyboard focus stays on the page", () => {
  it("goes back to the suggest button when the suggestions are dismissed", async () => {
    seed([audit({ meeting: "Daily Scrum", cadence: "daily", minutes: 30 })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest changes" }));
    const list = await screen.findByTestId("ai-suggestions");
    fireEvent.click(within(list).getByRole("button", { name: "Dismiss suggestions" }));
    expect(screen.queryByTestId("ai-suggestions")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Suggest changes" }));
  });

  it("goes to the costliest meeting after a new round", async () => {
    seed([
      audit({ ratings: { outcome: 1 }, verdict: "drop" }),
      audit({ id: "m2", meeting: "Planning", minutes: 30, verdict: "keep" }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start a new round" }));
    const dialog = screen.getByRole("dialog", { name: "Start a new round of the audit?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start a new round" }));
    expect(screen.queryByRole("button", { name: "Start a new round" })).toBeNull();
    await focusIs(() => nameOf("m1"));
  });

  it("goes to the verdict's first choice after Clear", async () => {
    seed([audit({ verdict: "keep" })]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Clear the verdict for Weekly sync" })
    );
    const group = screen.getByRole("radiogroup", { name: "Verdict for Weekly sync" });
    await focusIs(() => within(group).getByRole("radio", { name: "Keep" }));
  });

  it("goes to the next meeting after a delete, and back to the meeting on Undo", async () => {
    seed([audit(), audit({ id: "m2", meeting: "Planning", minutes: 30 })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete: Weekly sync" }));
    await focusIs(() => nameOf("m2"));
    undoLast();
    await focusIs(() => nameOf("m1"));
  });

  it("returns to the meeting after an edit is cancelled or saved", async () => {
    seed([audit()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit: Weekly sync" }));
    fireEvent.click(within(card("m1")).getByRole("button", { name: "Cancel" }));
    await focusIs(() => nameOf("m1"));
    fireEvent.click(screen.getByRole("button", { name: "Edit: Weekly sync" }));
    fireEvent.change(within(card("m1")).getByRole("textbox", { name: /^Meeting/ }), {
      target: { value: "Weekly team sync" },
    });
    fireEvent.click(within(card("m1")).getByRole("button", { name: "Save" }));
    await focusIs(() => nameOf("m1"));
    await announced("Saved “Weekly team sync”");
  });
});
