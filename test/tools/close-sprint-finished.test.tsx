import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintGoal, Story } from "@/lib/stores/workspace-types";
import { goalDocId } from "@/lib/sprints/goal-doc";

/**
 * The Close sprint dialog's finished step: closing no longer shuts the
 * dialog. It says the sprint is closed, asks "Did we meet the sprint goal?"
 * when the sprint has a goal and no answer yet (written to the goal
 * document, under the close's own Undo), and offers a backup download that
 * confirms itself on the button. Nothing here is a toast.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    dismiss: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
vi.mock("@/lib/gamification/signal", () => ({ signalGamification: vi.fn() }));

import { saveAs } from "file-saver";
import { CloseSprintDialog } from "@/components/sprints/close-sprint-dialog";
import { closeSprint, type ClosedSprint } from "@/app/(tools)/sprint/close";
import { unansweredGoal } from "@/app/(tools)/sprint-goal/doc";
import { buildExample as exampleGoal } from "@/app/(tools)/sprint-goal/example";
import { LAST_BACKUP_KEY } from "@/lib/data/backup-meta";
import { undoable } from "@/lib/utils/undoable";

const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};
const S3: Sprint = {
  id: "s3",
  name: "Sprint 3",
  startDate: "2026-10-26",
  endDate: "2026-11-05",
  pointsPlanned: 0,
  status: "planned",
};
const BOARD: Story[] = [
  { id: "a", title: "Save a card", points: 8, status: "done", sprintId: "s2" },
  { id: "b", title: "Pay with it", points: 5, status: "done", sprintId: "s2" },
];

const state = () => useWorkspaceStore.getState();
const sprint = (id = "s2") => state().sprints.find((s) => s.id === id)!;
const goalDoc = () => state().sprintGoals?.find((d) => d.id === goalDocId("s2"));

/**
 * The dialog as the cockpit mounts it: the sprint read from the store, the
 * close made through `closeSprint` under one Undo, and the goal answer
 * handed to that close.
 */
function Harness({
  onOpenChange,
  withGoalAnswer = true,
  mode = "close",
}: {
  onOpenChange: (open: boolean) => void;
  withGoalAnswer?: boolean;
  mode?: "close" | "points";
}) {
  const current = useWorkspaceStore((s) => s.sprints.find((x) => x.id === "s2"));
  const stories = useWorkspaceStore((s) => s.stories);
  const sprints = useWorkspaceStore((s) => s.sprints);
  const last = useRef<ClosedSprint | null>(null);
  if (!current) return null;
  return (
    <CloseSprintDialog
      open
      onOpenChange={onOpenChange}
      sprint={current}
      series={undefined}
      mode={mode}
      stories={stories}
      sprints={sprints}
      onConfirm={(points, carry) => {
        undoable({
          label: `Closed ${current.name}`,
          apply: () => {
            last.current = closeSprint("s2", points, carry);
          },
          revert: () => last.current?.revert(),
        });
      }}
      onGoalOutcome={withGoalAnswer ? (values) => last.current?.answerGoal(values) : undefined}
    />
  );
}

function open(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const onOpenChange = vi.fn();
  render(<Harness onOpenChange={onOpenChange} {...props} />);
  return { onOpenChange };
}

/** Press "Close sprint" on the form; returns the finished step. */
function closeIt() {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close sprint" }));
  return screen.getByRole("dialog");
}

const undoClose = () => {
  const [, options] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  act(() => options.action.onClick());
};

beforeEach(() => {
  toastSpy.mockClear();
  toastSpy.success.mockClear();
  vi.mocked(saveAs).mockClear();
  localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [S2, S3],
    stories: BOARD.map((s) => ({ ...s })),
    sprintGoals: [],
    sprintSeries: [],
  });
});

describe("the finished step", () => {
  it("stays open on a closed sprint, with focus on what it says", () => {
    const { onOpenChange } = open();
    const dlg = closeIt();
    expect(sprint()).toMatchObject({ status: "completed", pointsCompleted: 13 });
    expect(onOpenChange).not.toHaveBeenCalled();
    const title = within(dlg).getByRole("heading", { name: "Sprint 2 is closed" });
    expect(title).toHaveFocus();
    expect(dlg).toHaveTextContent("13 points done of 30 committed.");
    // The form went with the close.
    expect(within(dlg).queryByLabelText(/Completed points/)).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "Close sprint" })).toBeNull();

    fireEvent.click(within(dlg).getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks the goal question, and saves the answer and its note to the goal document", () => {
    const { onOpenChange } = open();
    const dlg = closeIt();
    const question = within(dlg).getByRole("radiogroup", { name: "Did we meet the sprint goal?" });
    expect(dlg).toHaveTextContent("“Checkout works end to end”");
    // No default answer, and answering is optional.
    for (const radio of within(question).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
    expect(within(dlg).getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(within(dlg).queryByLabelText("Note")).toBeNull();

    fireEvent.click(within(question).getByRole("radio", { name: "Partly met" }));
    fireEvent.change(within(dlg).getByLabelText("Note"), {
      target: { value: "Refunds slipped" },
    });
    // The button says what it will do.
    expect(within(dlg).queryByRole("button", { name: "Done" })).toBeNull();
    expect(goalDoc()).toBeUndefined();
    fireEvent.click(within(dlg).getByRole("button", { name: "Save answer and close" }));

    expect(goalDoc()).toMatchObject({
      sprintId: "s2",
      goal: "Checkout works end to end",
      outcome: { met: "partly", note: "Refunds slipped", decidedAt: expect.any(String) },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Never a toast: the only one is the close's own Undo.
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.success).not.toHaveBeenCalled();
    expect(toastSpy.info).not.toHaveBeenCalled();
  });

  it("takes the answer back with the close, under its one Undo", () => {
    open();
    const dlg = closeIt();
    fireEvent.click(within(dlg).getByRole("radio", { name: "Met" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Save answer and close" }));
    expect(goalDoc()?.outcome?.met).toBe("met");

    undoClose();
    expect(sprint()).toEqual(S2);
    expect(goalDoc()?.outcome).toBeUndefined();
    expect(unansweredGoal(state().sprintGoals, sprint())).toBe("Checkout works end to end");
  });

  it("saves nothing when the answer is cleared, or the dialog is closed with Done", () => {
    const { onOpenChange } = open();
    const dlg = closeIt();
    fireEvent.click(within(dlg).getByRole("radio", { name: "Not met" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Clear answer" }));
    expect(within(dlg).queryByLabelText("Note")).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: "Done" }));
    expect(goalDoc()).toBeUndefined();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(sprint().status).toBe("completed");
  });

  it("doesn't ask when the sprint has no goal", () => {
    const noGoal: Sprint = { ...S2, goal: undefined };
    useWorkspaceStore.setState({ sprints: [noGoal, S3] });
    open();
    const dlg = closeIt();
    expect(within(dlg).queryByRole("radiogroup")).toBeNull();
    expect(dlg).not.toHaveTextContent("Did we meet the sprint goal?");
  });

  it("doesn't ask again once the goal has an answer", () => {
    const answered: SprintGoal = {
      id: goalDocId("s2"),
      sprintId: "s2",
      businessObjective: "",
      goal: "Checkout works end to end",
      criteria: [],
      keyResults: [],
      outcome: { met: "met", decidedAt: "2026-10-25T10:00:00.000Z" },
    };
    useWorkspaceStore.setState({ sprintGoals: [answered] });
    open();
    const dlg = closeIt();
    expect(within(dlg).queryByRole("radiogroup")).toBeNull();
    expect(within(dlg).getByRole("button", { name: "Done" })).toBeInTheDocument();
    // Undo of the close leaves that earlier answer alone.
    undoClose();
    expect(goalDoc()).toEqual(answered);
  });

  it("doesn't ask when the caller can't put the answer under the close's Undo", () => {
    open({ withGoalAnswer: false });
    expect(within(closeIt()).queryByRole("radiogroup")).toBeNull();
  });

  it("offers a backup download that confirms itself on the button", () => {
    localStorage.setItem("agile-toolkit:workspace", "{}");
    open();
    const dlg = closeIt();
    expect(dlg).toHaveTextContent("No backup yet");
    expect(dlg).toHaveTextContent("Nothing is backed up on its own.");

    fireEvent.click(within(dlg).getByRole("button", { name: "Download backup" }));
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(within(dlg).getByRole("button", { name: "Backup downloaded" })).toBeInTheDocument();
    expect(localStorage.getItem(LAST_BACKUP_KEY)).not.toBeNull();
    expect(dlg).toHaveTextContent("Last backup: today");
    // An inline echo, never a pop-up of its own.
    expect(toastSpy.success).toHaveBeenCalledWith(expect.stringMatching(/^Backup downloaded/), {
      kind: "echo",
    });
    // The dialog is still there: the download isn't the end of the step.
    expect(within(dlg).getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("goes away when the close is undone while it is up", () => {
    const { onOpenChange } = open();
    closeIt();
    expect(onOpenChange).not.toHaveBeenCalled();
    undoClose();
    expect(sprint().status).toBe("active");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts on the form again the next time it opens", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Harness onOpenChange={onOpenChange} />);
    closeIt();
    // Reopened on a sprint that is active again (the close was undone).
    undoClose();
    rerender(<Harness onOpenChange={onOpenChange} />);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close sprint" })
    ).toBeInTheDocument();
  });

  describe("kept mounted, as the cockpit keeps it", () => {
    /** `open` held in state, the way the cockpit's Close sprint button drives it. */
    function Mounted() {
      const [isOpen, setOpen] = useState(true);
      const current = useWorkspaceStore((s) => s.sprints.find((x) => x.id === "s2"));
      const stories = useWorkspaceStore((s) => s.stories);
      const sprints = useWorkspaceStore((s) => s.sprints);
      const last = useRef<ClosedSprint | null>(null);
      if (!current) return null;
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open the dialog
          </button>
          <CloseSprintDialog
            open={isOpen}
            onOpenChange={setOpen}
            sprint={current}
            series={undefined}
            mode="close"
            stories={stories}
            sprints={sprints}
            onConfirm={(points, carry) => {
              undoable({
                label: `Closed ${current.name}`,
                apply: () => {
                  last.current = closeSprint("s2", points, carry);
                },
                revert: () => last.current?.revert(),
              });
            }}
            onGoalOutcome={(values) => last.current?.answerGoal(values)}
          />
        </>
      );
    }
    const reopen = () =>
      fireEvent.click(screen.getByRole("button", { name: "Open the dialog", hidden: true }));
    const formButton = () =>
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close sprint" });

    it("opens on the form after a close that was finished with Done, then undone", () => {
      render(<Mounted />);
      fireEvent.click(within(closeIt()).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      undoClose();
      expect(sprint().status).toBe("active");

      reopen();
      expect(formButton()).toBeInTheDocument();
      // It stays open: the first click is enough.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("opens on the form after a close undone while its finished step was up", () => {
      render(<Mounted />);
      closeIt();
      undoClose();
      expect(screen.queryByRole("dialog")).toBeNull();

      reopen();
      expect(formButton()).toBeInTheDocument();
      // And a second close ends on the finished step again.
      fireEvent.click(formButton());
      expect(
        within(screen.getByRole("dialog")).getByRole("heading", { name: "Sprint 2 is closed" })
      ).toBeInTheDocument();
    });
  });

  it("adding points to a finished sprint still closes on save, with no finished step", () => {
    const { onOpenChange } = open({ mode: "points" });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save points" })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("heading", { name: /is closed/ })).toBeNull();
  });
});

describe("closeSprint: the goal answer", () => {
  it("writes the answer onto the sprint's goal document and reverts to what was there", () => {
    const earlier: SprintGoal = {
      id: goalDocId("s2"),
      sprintId: "s2",
      businessObjective: "Fewer abandoned baskets",
      goal: "Checkout works end to end",
      criteria: [],
      keyResults: [],
      outcome: { met: "not-met", note: "Old", decidedAt: "2026-10-20T10:00:00.000Z" },
    };
    useWorkspaceStore.setState({ sprintGoals: [earlier] });
    const closed = closeSprint("s2", 13)!;
    closed.answerGoal({ met: "met" });
    closed.answerGoal({ met: "partly", note: "Second thoughts" });
    expect(goalDoc()).toMatchObject({
      businessObjective: "Fewer abandoned baskets",
      outcome: { met: "partly", note: "Second thoughts" },
    });
    closed.revert();
    // The answer from before the close, not the first one this close wrote.
    expect(goalDoc()).toEqual(earlier);
  });

  it("does nothing once the close was undone, or for a sprint that is gone", () => {
    const closed = closeSprint("s2", 13)!;
    closed.revert();
    closed.answerGoal({ met: "met" });
    expect(goalDoc()).toBeUndefined();

    const again = closeSprint("s2", 13)!;
    useWorkspaceStore.setState({ sprints: [S3] });
    again.answerGoal({ met: "met" });
    expect(goalDoc()).toBeUndefined();
  });
});

describe("unansweredGoal", () => {
  const doc = (patch: Partial<SprintGoal> = {}): SprintGoal => ({
    id: goalDocId("s2"),
    sprintId: "s2",
    businessObjective: "",
    goal: "",
    criteria: [],
    keyResults: [],
    ...patch,
  });

  it("reads the goal from the document, else from the sprint", () => {
    expect(unansweredGoal([], S2)).toBe("Checkout works end to end");
    expect(unansweredGoal([doc({ goal: "  A  sharper   goal " })], S2)).toBe("A sharper goal");
    expect(unansweredGoal(undefined, S2)).toBe("Checkout works end to end");
  });

  it("is null without a goal, with an answer, or while the example is loaded", () => {
    expect(unansweredGoal([], { ...S2, goal: undefined })).toBeNull();
    expect(unansweredGoal([], { ...S2, goal: "   " })).toBeNull();
    expect(
      unansweredGoal(
        [doc({ goal: "G", outcome: { met: "met", decidedAt: "2026-10-25T10:00:00.000Z" } })],
        S2
      )
    ).toBeNull();
    expect(unansweredGoal([doc({ ...exampleGoal() })], S2)).toBeNull();
  });

  it("asks again when the stored answer can't be read", () => {
    const broken = doc({ goal: "G", outcome: { met: "maybe" } as never });
    expect(unansweredGoal([broken], S2)).toBe("G");
  });
});
