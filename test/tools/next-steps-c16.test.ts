/**
 * Improve's next steps (lib/improve/model improveSteps, through the base's
 * lazy rule): a Kata's coaching talk that is due, an A3 whose
 * countermeasures are all done with no reading since (a countermeasure done
 * in Retro Actions counts), a Kata with no obstacle being worked on, and a
 * Kata with one but no experiment planned or running. The team's own
 * improvements still being worked on only, newest first; quiet otherwise.
 * "Today" is pinned by shifting Date (not fake timers).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type Improvement,
  type RetroBoard,
  type Workspace,
} from "@/lib/stores/workspace-types";

beforeAll(() => loadNextStepRule("improve"));

/** Pin "now" for code that calls `new Date()` with no arguments. */
function pinNow(iso: string) {
  const FIXED = Date.parse(iso);
  const RealDate = Date;
  vi.stubGlobal(
    "Date",
    class extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...((args.length ? args : [FIXED]) as [number]));
      }
      static now() {
        return FIXED;
      }
    }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const steps = (ws: Partial<Workspace>) => {
  const rule = getNextStepRule("improve");
  if (!rule) throw new Error("no rule for improve");
  return rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
};
const ids = (ws: Partial<Workspace>) => steps(ws).map((s) => s.id);

function improvement(over: Partial<Improvement> & Pick<Improvement, "id">): Improvement {
  return {
    title: `Improve ${over.id}`,
    method: "kata",
    status: "open",
    background: "",
    current: { text: "" },
    target: { text: "Under 8 h" },
    obstacles: [{ id: "o1", text: "One reviewer", status: "working" }],
    steps: [{ id: "s1", text: "Pair", expect: "Faster", status: "running" }],
    readings: [],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...over,
  };
}

describe("improve's next steps", () => {
  it("asks for the coaching talk on its day and after, not before", () => {
    const kata = improvement({ id: "improve_k", nextCoachingAt: "2026-11-20" });
    pinNow("2026-11-19T12:00:00");
    expect(ids({ improvements: [kata] })).toEqual([]);
    pinNow("2026-11-20T12:00:00");
    expect(steps({ improvements: [kata] })).toEqual([
      {
        id: "improve-coach",
        label: "Coach “Improve improve_k”: the talk is due",
        detail: "A few minutes on what the last try showed and what to try next.",
        href: "/improve?item=improve_k",
      },
    ]);
    pinNow("2026-11-25T12:00:00");
    expect(ids({ improvements: [kata] })).toEqual(["improve-coach"]);
  });

  it("asks to measure an A3 again once every countermeasure is done, there or here", () => {
    const a3 = improvement({
      id: "improve_a",
      method: "a3",
      obstacles: [],
      steps: [
        {
          id: "s1",
          text: "Automate checks",
          status: "planned",
          sentTo: [{ route: "retro-action", targetId: "c1", at: "2026-11-02T09:00:00.000Z" }],
        },
      ],
      readings: [{ id: "r1", date: "2026-11-01", value: 6 }],
    });
    const open = [{ id: "retro:current", cards: [{ id: "c1", isActionItem: true }] }];
    const done = [
      {
        id: "retro:current",
        cards: [{ id: "c1", isActionItem: true, done: true, doneAt: "2026-11-10T09:00:00.000Z" }],
      },
    ];
    pinNow("2026-11-20T12:00:00");
    expect(ids({ improvements: [a3], retroBoards: open as unknown as RetroBoard[] })).toEqual([]);
    expect(steps({ improvements: [a3], retroBoards: done as unknown as RetroBoard[] })).toEqual([
      expect.objectContaining({
        id: "improve-check",
        label: "Measure “Improve improve_a” again: did it work?",
        href: "/improve?item=improve_a",
      }),
    ]);
    const measured = {
      ...a3,
      readings: [...a3.readings, { id: "r2", date: "2026-11-12", value: 3 }],
    };
    expect(ids({ improvements: [measured], retroBoards: done as unknown as RetroBoard[] })).toEqual(
      []
    );
  });

  it("asks a Kata to name or pick its obstacle, then to plan the next experiment", () => {
    pinNow("2026-11-20T12:00:00");
    const none = improvement({ id: "improve_n", obstacles: [] });
    expect(steps({ improvements: [none] })[0]).toMatchObject({
      id: "improve-obstacle",
      label: "Name what's in the way of “Improve improve_n”",
    });
    const unpicked = improvement({
      id: "improve_p",
      obstacles: [{ id: "o1", text: "One reviewer", status: "open" }],
    });
    expect(steps({ improvements: [unpicked] })[0].label).toBe(
      "Pick what's in the way of “Improve improve_p”"
    );
    const idle = improvement({
      id: "improve_i",
      steps: [{ id: "s1", text: "Pair", expect: "Faster", status: "done" }],
    });
    expect(steps({ improvements: [idle] })).toEqual([
      expect.objectContaining({
        id: "improve-next-experiment",
        label: "Plan the next experiment for “Improve improve_i”",
        href: "/improve?item=improve_i",
      }),
    ]);
  });

  it("leaves out examples, closed and dropped ones, picks the newest, and reads odd rows safely", () => {
    pinNow("2026-11-20T12:00:00");
    const due = { nextCoachingAt: "2026-11-01" };
    expect(
      ids({
        improvements: [
          improvement({ id: "example-improve-k", ...due }),
          improvement({ id: "improve_c", status: "closed", ...due }),
          improvement({ id: "improve_d", status: "dropped", ...due }),
        ],
      })
    ).toEqual([]);
    const newer = improvement({ id: "improve_new", ...due, updatedAt: "2026-11-15T09:00:00.000Z" });
    const older = improvement({ id: "improve_old", ...due });
    expect(steps({ improvements: [older, newer] })[0].href).toBe("/improve?item=improve_new");
    const odd = [
      null,
      { id: 3 },
      { id: "improve_odd", method: "kata", status: "open", nextCoachingAt: "2026-11-01" },
    ];
    expect(() => steps({ improvements: odd as unknown as Improvement[] })).not.toThrow();
    expect(ids({ improvements: odd as unknown as Improvement[] })).toEqual([
      "improve-coach",
      "improve-obstacle",
    ]);
    expect(ids({})).toEqual([]);
  });
});
