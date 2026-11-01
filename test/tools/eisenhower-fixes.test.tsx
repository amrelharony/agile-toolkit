import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";

/**
 * The Eisenhower review fixes: a legacy row's stored quadrant decides its
 * pane over stored answers that contradict it (the old app showed the
 * quadrant), on the page and for the agent, with nothing rewritten on
 * read; the form's live line never names a pane the form would refuse;
 * the live line stays quiet after Add; focus comes back to the task after
 * its editor closes.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { EisenhowerClient } from "@/app/(tools)/eisenhower/eisenhower-client";
import { eisRows, legacyQuadrantFirst, previewText } from "@/app/(tools)/eisenhower/model";
import "@/lib/actions/tools/eisenhower";

const FW = "eisenhower" as const;
const TODAY = "2026-10-27";
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === FW);
const stored = (id: string) => rows().find((r) => r.id === id);

const task = (
  id: string,
  title: string,
  fields: Record<string, number | string> = {}
): PrioritizationItem => ({
  id,
  framework: FW,
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
});
const agent = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <EisenhowerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const IMPORTANT = "Important? (does it move a goal)";
const URGENT = "Urgent? (does waiting cause harm soon)";
const addForm = () =>
  screen.getByRole("button", { name: "Add task" }).closest("form") as HTMLElement;
const answer = (scope: HTMLElement, group: string, value: "Yes" | "No") =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: value,
    })
  );
const pane = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
const inPane = (label: string) =>
  within(pane(label))
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
  toastSpy.mockReset();
  useWorkspaceStore.setState({ prioritizations: [], teamMembers: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

// The old agent stored the answers and the quadrant; the old page's menu then moved only the quadrant.
const moved = task("m", "Moved on the old page", {
  urgent: "false",
  important: "true",
  quadrant: "delegate",
});
// An old agent persist with a quadrant it decided over the answers.
const overridden = task("o", "Agent override", {
  urgent: "false",
  important: "false",
  quadrant: "do",
});

describe("Eisenhower fixes: a legacy quadrant is the pane the old app showed", () => {
  it("reads the stored quadrant over contradicting answers, without rewriting the row", () => {
    expect(legacyQuadrantFirst(moved).fields).toEqual({ quadrant: "delegate" });
    // New rows (no quadrant) and other methods' rows are left as they are.
    const fresh = task("n", "New", { urgent: "true", important: "true" });
    expect(legacyQuadrantFirst(fresh)).toBe(fresh);
    const other = { ...moved, framework: "value-effort" as const };
    expect(legacyQuadrantFirst(other)).toBe(other);
    const ranked = eisRows([moved, overridden], TODAY);
    expect(ranked.map((r) => [r.row.id, r.result.bucket])).toEqual([
      ["o", "do"],
      ["m", "delegate"],
    ]);
    // The ranked row is the stored row itself.
    expect(ranked.find((r) => r.row.id === "m")?.row).toBe(moved);
  });

  it("puts each legacy row in the same pane on the page and for the agent", async () => {
    useWorkspaceStore.setState({ prioritizations: [moved, overridden] });
    const out = (await registry
      .get("tool.eisenhower.list_items")!
      .handler({ today: TODAY }, agent())) as Record<
      string,
      { id: string; values?: Record<string, string> }[]
    >;
    renderPage();
    expect(out.delegate.map((r) => r.id)).toEqual(["m"]);
    expect(out.delegate[0].values).toMatchObject({ urgent: "true", important: "false" });
    expect(inPane("Delegate")).toEqual([expect.stringContaining("Moved on the old page")]);
    expect(out.do.map((r) => r.id)).toEqual(["o"]);
    expect(inPane("Do")).toEqual([expect.stringContaining("Agent override")]);
    expect(out.schedule).toEqual([]);
    expect(stored("m")?.fields).toEqual(moved.fields);
  });

  it("keeps the legacy pane when the agent changes something else", async () => {
    useWorkspaceStore.setState({ prioritizations: [moved] });
    const out = (await registry
      .get("tool.eisenhower.update_task")!
      .handler({ id: "m", delegateTo: "Priya" } as never, agent())) as { quadrant: string };
    expect(out.quadrant).toBe("delegate");
    expect(stored("m")?.fields).toEqual({
      urgent: "true",
      important: "false",
      delegateTo: "Priya",
    });
  });

  it("edits a legacy row from its quadrant's answers, and Undo of a delete restores it exactly", () => {
    useWorkspaceStore.setState({ prioritizations: [moved] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Moved on the old page" }));
    expect(rows()).toHaveLength(0);
    const call = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
    act(() => (call[1] as { action: { onClick: () => void } }).action.onClick());
    expect(stored("m")).toEqual(moved);
    fireEvent.click(screen.getByRole("button", { name: "Edit Moved on the old page" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    const urgent = within(editor).getByRole("radiogroup", { name: URGENT });
    expect(within(urgent).getByRole("radio", { name: "Yes" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.submit(editor);
    expect(stored("m")?.fields).toEqual({ urgent: "true", important: "false" });
    expect(inPane("Delegate")).toEqual([expect.stringContaining("Moved on the old page")]);
  });
});

describe("Eisenhower fixes: the form's line agrees with what it saves", () => {
  it("asks for Urgent while a near due date alone would make it urgent", () => {
    expect(previewText({ important: "true", dueAt: "2026-10-28" }, TODAY)).toBe(
      "Say whether it's urgent (being due tomorrow makes it urgent anyway)."
    );
    expect(previewText({ important: "false", dueAt: "2026-10-20" }, TODAY)).toBe(
      "Say whether it's urgent (being 7 days overdue makes it urgent anyway)."
    );
    expect(previewText({ important: "true", dueAt: "2026-11-20" }, TODAY)).toBe(
      "Say whether it's urgent to see where it goes."
    );
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Task/), { target: { value: "Book the room" } });
    answer(addForm(), IMPORTANT, "No");
    fireEvent.change(within(addForm()).getByLabelText(/^Due/), {
      target: { value: "2026-10-27" },
    });
    // Not "goes to Delegate": the form would refuse it, so no picker either.
    expect(within(addForm()).getByRole("status")).toHaveTextContent(
      "Say whether it's urgent (being due today makes it urgent anyway)."
    );
    expect(screen.queryByLabelText(/^Who takes it\?/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Say whether it's urgent.")).toBeInTheDocument();
    answer(addForm(), URGENT, "No");
    expect(within(addForm()).getByRole("status")).toHaveTextContent(
      "Urgent because it's due today, so it goes to Delegate."
    );
    expect(screen.getByLabelText(/^Who takes it\?/)).toBeInTheDocument();
  });
});

describe("Eisenhower fixes: announcements and focus", () => {
  it("leaves the live line empty after Add, so only “Added …” is read out", async () => {
    renderPage();
    const live = within(addForm()).getByRole("status");
    expect(live).toHaveTextContent("");
    expect(
      within(addForm()).getByText("Answer both questions to see where it goes.")
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText(/^Task/), { target: { value: "Fix the outage" } });
    answer(addForm(), IMPORTANT, "Yes");
    expect(live).toHaveTextContent("Say whether it's urgent to see where it goes.");
    answer(addForm(), URGENT, "Yes");
    expect(live).toHaveTextContent("Goes to Do.");
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(rows()).toHaveLength(1);
    expect(within(addForm()).getByRole("status")).toHaveTextContent("");
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Added “Fix the outage” to Do")
    );
  });

  it("puts focus back on the task's Edit button after Save and after Cancel", () => {
    useWorkspaceStore.setState({
      prioritizations: [task("a", "Answer emails", { urgent: "true", important: "true" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Answer emails" }));
    let editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    answer(editor, IMPORTANT, "No");
    fireEvent.submit(editor);
    expect(inPane("Delegate")).toEqual([expect.stringContaining("Answer emails")]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Answer emails" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Answer emails" }));
    editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Answer emails" }));
  });
});
