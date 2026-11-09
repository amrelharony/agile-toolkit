/**
 * Ink moments at the places something gets finished (DNA-SPEC §9): each
 * site draws its mark only in the finished state, beside the text that says
 * so, hidden from assistive tech. The poker circle, the retro flourish and
 * the kudos heart are checked with the rest of those screens
 * (test/poker/session-screen, test/retro/retro-board, test/kudos/kudos-sent).
 */

import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SprintHeader } from "@/components/sprints/sprint-header";
import { StartFlow } from "@/app/(tools)/sprint/components/start-flow";
import { RunSummary } from "@/app/(tools)/ceremony-timer/run-summary";
import type { RunReport } from "@/app/(tools)/ceremony-timer/run";
import { ObjectiveCard } from "@/app/(tools)/okrs/objective-card";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KeyResult, Okr, Sprint } from "@/lib/stores/workspace-types";

const ink = (c: ParentNode, name: string) => c.querySelector(`[data-ink="${name}"]`);

const SPRINT: Sprint = {
  id: "spr_1",
  name: "Sprint 14",
  startDate: "2026-10-26",
  endDate: "2026-11-06",
  goal: "Ship the checkout",
  pointsPlanned: 30,
  status: "active",
};

function header(status: Sprint["status"]) {
  return render(
    <SprintHeader
      sprint={{ ...SPRINT, status }}
      today="2026-11-09"
      detailsOpen={false}
      onDetailsOpenChange={() => {}}
      onEdit={() => {}}
      onRequestClose={() => {}}
      onReopen={() => {}}
    />
  );
}

describe("sprint closed: the Done stamp", () => {
  it("stamps a completed sprint beside its status badge", () => {
    const { container } = header("completed");
    const stamp = ink(container, "done-stamp")!;
    expect(stamp).not.toBeNull();
    // The badge states it; the stamp sits next to it, hidden from screen readers.
    expect(stamp.previousElementSibling).toHaveTextContent("Done");
    expect(stamp).toHaveAttribute("aria-hidden", "true");
  });

  it.each(["planned", "active", "cancelled"] as const)(
    "draws no stamp on a %s sprint",
    (status) => {
      const { container } = header(status);
      expect(ink(container, "done-stamp")).toBeNull();
    }
  );
});

describe("sprint start steps: the tick", () => {
  afterEach(() => useWorkspaceStore.setState({ teamMembers: [] }));

  const flow = () =>
    render(
      <TooltipProvider>
        <StartFlow
          onCreate={() => {}}
          onExample={() => {}}
          cadence={DEFAULT_CADENCE}
          onCadence={() => {}}
        />
      </TooltipProvider>
    );

  it("shows the step's number until it's done", () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    const { container } = flow();
    expect(ink(container, "tick")).toBeNull();
    const step = screen.getByRole("heading", { name: "Add your team" }).closest("li")!;
    expect(step.querySelector("span[aria-hidden]")).toHaveTextContent("1");
  });

  it("inks a tick in the done step's bubble once the team has someone", () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "tm_1", name: "Sam" }],
    });
    const { container } = flow();
    const step = screen.getByRole("heading", { name: /^Add your team ?\(done\)$/ }).closest("li")!;
    const bubble = step.querySelector("span[aria-hidden]")!;
    expect(bubble.querySelector('[data-ink="tick"]')).not.toBeNull();
    expect(bubble).not.toHaveTextContent("1");
    // Only that step: the others aren't done.
    expect(container.querySelectorAll('[data-ink="tick"]')).toHaveLength(1);
  });
});

const REPORT: RunReport = {
  label: "Daily Scrum",
  short: "Daily",
  finished: true,
  plannedSeconds: 900,
  actualSeconds: 840,
  segments: [
    { label: "Daily Scrum", plannedSeconds: 900, actualSeconds: 840, current: false, turns: [] },
  ],
};

describe("ceremony timer finished: a tick and a flourish", () => {
  it("draws a tick by the verdict and a flourish under it", () => {
    const { container } = render(<RunSummary report={REPORT} />);
    const verdict = screen.getByRole("status");
    const tick = ink(container, "tick")!;
    const flourish = ink(container, "flourish")!;
    expect(tick).not.toBeNull();
    expect(flourish).not.toBeNull();
    // Outside the status line, so the announcement is the verdict alone.
    expect(verdict.contains(tick)).toBe(false);
    expect(verdict.contains(flourish)).toBe(false);
    expect(verdict.nextElementSibling).toBe(flourish);
  });

  it("draws neither for a meeting that isn't finished", () => {
    const { container } = render(<RunSummary report={{ ...REPORT, finished: false }} />);
    expect(ink(container, "tick")).toBeNull();
    expect(ink(container, "flourish")).toBeNull();
  });
});

const kr = (id: string, current: number, target = 10): KeyResult => ({
  id,
  title: `KR ${id}`,
  target,
  current,
  baseline: 0,
});

function objective(keyResults: KeyResult[]) {
  const okr: Okr = { id: "okr_1", objective: "Delight new users", quarter: "2026-Q4", keyResults };
  return render(
    <TooltipProvider>
      <ObjectiveCard
        okr={okr}
        now={new Date("2026-11-09T12:00:00")}
        today="2026-11-09"
        quarters={["2026-Q4"]}
        goals={[]}
        sprints={[]}
        example={false}
        handlers={{
          onEdit: () => {},
          onDelete: () => {},
          onAddKr: () => {},
          onEditKr: () => {},
          onDeleteKr: () => {},
          onCheckIn: () => {},
          onRemoveCheckIn: () => {},
        }}
      />
    </TooltipProvider>
  );
}

describe("OKR at 100%: the star", () => {
  it("stars the objective once every key result has reached its target", () => {
    const { container } = objective([kr("a", 10), kr("b", 12)]);
    const star = ink(container, "star")!;
    expect(star).not.toBeNull();
    expect(star.previousElementSibling).toHaveTextContent("Delight new users");
    expect(screen.getByText(/Every key result has reached its target/)).toBeInTheDocument();
  });

  it("draws no star short of 100%, even one that rounds to 100%, or with nothing measured", () => {
    for (const krs of [[kr("a", 10), kr("b", 5)], [kr("a", 995, 1000)], []]) {
      const { container, unmount } = objective(krs);
      expect(ink(container, "star")).toBeNull();
      unmount();
    }
  });
});
