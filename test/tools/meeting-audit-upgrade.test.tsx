import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MeetingAudit } from "@/lib/stores/workspace-types";
import { MEETING_AUDIT_ACTIONS } from "@/lib/history/event-actions";

/**
 * Meeting Audit (shelved, on the full contract) on workspace.meetingAudits:
 * an add form that saves nothing until the name, cadence, length and
 * headcount are in (no silent 0), the weekly cost of each meeting, ratings
 * in one meeting's panel at a time, verdicts (Amr's cheer once every meeting
 * has one), in-place edit and delete with Undo, the suggestions without AI
 * (accepted into the notes with Undo), the ritual reset plan, a new round
 * with Undo, the example, and the export.
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

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  seed([]);
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
});
