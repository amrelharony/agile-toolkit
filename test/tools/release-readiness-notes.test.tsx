import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Release, ReleaseReadiness, Story } from "@/lib/stores/workspace-types";

/**
 * Release Readiness's release notes (tools plan, phase 2, N06): on each
 * release card, its stories (linked from the done ones since the previous
 * ship, unlinked with Undo), then notes drafted without AI (or by Amr),
 * used only when the person says so, saved with Undo, copied without a
 * toast; ticket keys only for the team; the line after a reopen; the
 * example's gates unchanged; the Markdown's notes section; history with ids
 * and words like "ai" only.
 */

const h = vi.hoisted(() => ({
  logs: [] as { action: string; payload: Record<string, unknown> }[],
}));
const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, context }: { markdown?: string; context?: string }) => (
    <pre data-testid={context ? "notes-export" : "export-markdown"}>{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => h.logs.push({ action, payload }),
  }),
}));
vi.mock("@/app/(tools)/release-readiness/charts", () => ({
  GatePassControlChart: () => null,
  SkippedGatesChart: () => null,
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { ReleaseReadinessClient } from "@/app/(tools)/release-readiness/release-readiness-client";
import { dayLabel } from "@/app/(tools)/release-readiness/text";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const TODAY = todayIso();
const on = (n: number) => addDays(TODAY, n) as string;
const doneAt = (n: number) => new Date(`${on(n)}T12:00:00`).toISOString();

const story = (id: string, daysAgo: number | null, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  ...(daysAgo !== null ? { doneAt: doneAt(-daysAgo) } : {}),
  ...over,
});
const shipped = (over: Partial<Release> = {}): Release => ({
  id: "r1",
  name: "v1",
  plannedDate: on(-10),
  status: "shipped",
  shippedDate: on(-10),
  gates: {},
  ...over,
});
const planning = (over: Partial<Release> = {}): Release => ({
  id: "r2",
  name: "v2",
  plannedDate: on(5),
  status: "planning",
  gates: {},
  ...over,
});
const seed = (releases: Release[], stories: Story[]) =>
  useWorkspaceStore.setState({
    releaseReadinesses: [{ id: RELEASE_DOC_ID, releases } as ReleaseReadiness],
    stories,
    featureFlags: [],
    definitionsOfDone: [],
    retroBoards: [],
    epicRoadmaps: [],
  });
const STORIES = [
  story("s1", 5, { title: "Fix the login crash", ticketKey: "APP-9" }),
  story("s2", 2, { title: "Search by name", ticketKey: "APP-10" }),
  story("s3", null, { title: "Dark mode", status: "in_progress" }),
];

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) =>
  (ws().releaseReadinesses ?? [])
    .find((d) => d.id === RELEASE_DOC_ID)
    ?.releases.find((r) => r.id === id);
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
        <ReleaseReadinessClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const card = (name: string) =>
  screen.getByRole("heading", { level: 3, name }).closest("article") as HTMLElement;
const openNotes = (name: string) => {
  fireEvent.click(within(card(name)).getByRole("button", { name: /^Stories and release notes/ }));
  return within(screen.getByRole("region", { name: `Stories and release notes for ${name}` }));
};

beforeEach(() => {
  toastSpy.mockReset();
  h.logs.length = 0;
});

describe("linking the stories a release ships", () => {
  it("starts closed, and suggests the stories done since the previous ship", () => {
    seed([planning(), shipped()], [...STORIES, story("old", 20)]);
    renderPage();
    expect(
      within(card("v2")).getByRole("button", { name: /^Stories and release notes/ })
    ).toHaveAttribute("aria-expanded", "false");
    const panel = openNotes("v2");
    expect(
      panel.getByText(/The Definition of Done gate and DORA's lead time read/)
    ).toBeInTheDocument();
    expect(panel.getByLabelText(/Fix the login crash/)).toBeInTheDocument();
    expect(panel.getByLabelText(/Search by name/)).toBeInTheDocument();
    expect(panel.queryByLabelText(/Story old/)).toBeNull();
    expect(panel.queryByLabelText(/Dark mode/)).toBeNull();
  });

  it("labels a suggested story with the local day it was done, the day it is counted by", () => {
    // Done on that day here, at a time whose UTC day differs wherever the zone
    // allows: just after midnight east of UTC, late in the evening west of it.
    const [y, m, d] = on(-2).split("-").map(Number);
    const west = new Date(y, m - 1, d).getTimezoneOffset() >= 0;
    const at = new Date(y, m - 1, d, west ? 23 : 0, 30).toISOString();
    seed([planning(), shipped()], [story("s9", null, { title: "Late fix", doneAt: at })]);
    renderPage();
    const panel = openNotes("v2");
    expect(panel.getByLabelText(/Late fix/)).toHaveAccessibleName(
      new RegExp(`^Late fix\\s*done ${dayLabel(on(-2))}$`)
    );
  });

  it("links the picked stories with Undo, logging the count", () => {
    seed([planning(), shipped()], STORIES);
    renderPage();
    const panel = openNotes("v2");
    fireEvent.click(panel.getByLabelText(/Fix the login crash/));
    fireEvent.click(panel.getByLabelText(/Search by name/));
    fireEvent.click(panel.getByRole("button", { name: "Link 2 stories" }));
    expect(stored("r2")?.storyIds).toEqual(["s1", "s2"]);
    expect(logged("stories_linked")).toEqual([{ releaseId: "r2", count: 2 }]);
    undoLast();
    expect(stored("r2")?.storyIds).toBeUndefined();
  });

  it("unlinks a story with Undo, and says which linked stories aren't done", () => {
    seed([planning({ storyIds: ["s1", "s3"] }), shipped()], STORIES);
    renderPage();
    const panel = openNotes("v2");
    expect(panel.getByText(/Not done yet, left out of the notes: Dark mode/)).toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Unlink Fix the login crash" }));
    expect(stored("r2")?.storyIds).toEqual(["s3"]);
    undoLast();
    expect(stored("r2")?.storyIds).toEqual(["s1", "s3"]);
  });
});

describe("writing the notes", () => {
  beforeEach(() => seed([planning({ storyIds: ["s1", "s2", "s3"] }), shipped()], STORIES));

  it("drafts from the stories without AI, keeps nothing until used, then saves with Undo", () => {
    renderPage();
    const panel = openNotes("v2");
    fireEvent.click(panel.getByRole("button", { name: "Draft from the stories" }));
    const region = screen.getByRole("region", { name: "Drafted notes for v2" });
    const draft = within(region);
    expect(draft.getByText(/Drafted from the stories, without AI/)).toBeInTheDocument();
    expect(region.textContent).toContain("New\n- Search by name\n\nFixed\n- Fix the login crash");
    expect(logged("notes_drafted")).toEqual([
      { releaseId: "r2", audience: "customers", source: "template" },
    ]);
    const box = panel.getByLabelText(/^Release notes for v2/) as HTMLTextAreaElement;
    expect(box.value).toBe("");
    fireEvent.click(draft.getByRole("button", { name: "Use this draft" }));
    expect(box.value).toMatch(/^v2: what's new/);
    expect(box.value).not.toContain("APP-9");
    expect(box.value).not.toContain("Dark mode");
    expect(stored("r2")?.releaseNotes).toBeUndefined();
    fireEvent.click(panel.getByRole("button", { name: "Save notes" }));
    expect(stored("r2")?.releaseNotes).toMatchObject({ audience: "customers" });
    expect(logged("notes_saved")).toEqual([{ releaseId: "r2", audience: "customers" }]);
    undoLast();
    expect(stored("r2")?.releaseNotes).toBeUndefined();
  });

  it("keeps ticket keys for the team", () => {
    renderPage();
    const panel = openNotes("v2");
    fireEvent.click(panel.getByRole("radio", { name: "The team" }));
    fireEvent.click(panel.getByRole("button", { name: "Draft from the stories" }));
    expect(
      within(screen.getByRole("region", { name: "Drafted notes for v2" })).getByText(
        /Fix the login crash \(APP-9\)/
      )
    ).toBeInTheDocument();
  });

  it("copies the notes in place, with no toast", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    const panel = openNotes("v2");
    fireEvent.change(panel.getByLabelText(/^Release notes for v2/), { target: { value: "Hello" } });
    await act(async () => {
      fireEvent.click(panel.getByRole("button", { name: "Copy notes" }));
    });
    expect(writeText).toHaveBeenCalledWith("Hello");
    expect(toastSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("notes-export").textContent).toContain("## Release notes — v2");
  });

  it("refuses notes over 3,000 characters", () => {
    renderPage();
    const panel = openNotes("v2");
    fireEvent.change(panel.getByLabelText(/^Release notes for v2/), {
      target: { value: "x".repeat(3001) },
    });
    expect(panel.getByRole("alert")).toHaveTextContent(/Keep the notes to 3,000 characters/);
    expect(panel.getByRole("button", { name: "Save notes" })).toBeDisabled();
  });
});

describe("after a reopen, the example and the export", () => {
  it("says which ship the notes were written for", () => {
    seed(
      [
        planning({
          previousShips: [{ shippedDate: on(-3), rolledBackAt: on(-2) }],
          releaseNotes: { audience: "customers", text: "Old notes", updatedAt: doneAt(-4) },
        }),
      ],
      STORIES
    );
    renderPage();
    const panel = openNotes("v2");
    expect(
      panel.getByText(/Written for the ship on .*: check them before the next one\./)
    ).toBeInTheDocument();
    expect((panel.getByLabelText(/^Release notes for v2/) as HTMLTextAreaElement).value).toBe(
      "Old notes"
    );
  });

  it("adds the newest release's notes to the page's Markdown", () => {
    seed(
      [
        planning(),
        shipped({ releaseNotes: { audience: "team", text: "v1 notes", updatedAt: doneAt(-1) } }),
      ],
      STORIES
    );
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("## Release notes — v1\n\n_For the team._\n\nv1 notes");
  });

  it("keeps the example's gates and counts, and links its own stories", () => {
    seed([], []);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(within(card("v3.4 Checkout redesign")).getByText("9 / 11 gates")).toBeInTheDocument();
    const payments = openNotes("v3.3 Payments retry");
    expect(payments.getByText(/Retry a failed card payment once/)).toBeInTheDocument();
    const checkout = openNotes("v3.4 Checkout redesign");
    expect(
      checkout.getByLabelText(/One-page checkout for signed-in customers/)
    ).toBeInTheDocument();
    expect(checkout.queryByLabelText(/Retry a failed card payment/)).toBeNull();
    fireEvent.click(checkout.getByLabelText(/One-page checkout for signed-in customers/));
    fireEvent.click(checkout.getByRole("button", { name: "Link 1 story" }));
    expect(within(card("v3.4 Checkout redesign")).getByText("9 / 11 gates")).toBeInTheDocument();
    expect(ws().stories).toEqual([]);
    expect(h.logs).toEqual([]);
  });
});
