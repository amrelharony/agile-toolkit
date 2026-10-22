import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Ceremony Timer gap-filling: Markdown edges, presets and the custom
 * duration, the countdown (start / pause / resume / reset, time's up), the
 * speaker rotation and adding participants. (The example, Load team, Undo
 * and the dock are covered by the other ceremony-timer tests.)
 */

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  sonify: vi.fn(),
  markdown: undefined as string | undefined,
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    spies.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => spies.sonify,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
}));

import { CeremonyTimerClient } from "@/app/(tools)/ceremony-timer/ceremony-timer-client";
import { toMarkdown } from "@/app/(tools)/ceremony-timer/markdown";
import { useDockTimer } from "@/lib/timer/dock-timer";
import { CEREMONY_TIMER_ACTIONS } from "@/lib/history/event-actions";

const NOW = new Date(2026, 9, 18);
const people = (...names: string[]) => names.map((name, i) => ({ id: `p${i}`, name }));

const startButton = () => screen.getByRole("button", { name: /^(Start|Pause) timer$/ });
const resetButton = () => screen.getByRole("button", { name: "Reset timer" });
const clock = (text: string) => screen.getByText(text, { selector: "span.font-data" });

function setCustom(value: string, via: "enter" | "set" = "set") {
  if (!screen.queryByRole("spinbutton", { name: "Custom duration in minutes" })) {
    fireEvent.click(screen.getByRole("button", { name: /^Custom/ }));
  }
  const input = screen.getByRole("spinbutton", { name: "Custom duration in minutes" });
  fireEvent.change(input, { target: { value } });
  if (via === "enter") fireEvent.keyDown(input, { key: "Enter" });
  else fireEvent.click(screen.getByRole("button", { name: "Set" }));
}

function addParticipants(...names: string[]) {
  const input = screen.getByRole("textbox", { name: "Participant name" });
  for (const name of names) {
    fireEvent.change(input, { target: { value: name } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
}

const speakers = () =>
  screen
    .queryAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")!.replace(/^Remove /, ""));
const row = (name: string) =>
  screen.getByRole("button", { name: `Remove ${name}` }).parentElement as HTMLElement;

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  spies.log.mockClear();
  spies.sonify.mockClear();
  spies.markdown = undefined;
  useDockTimer.setState({ timer: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ceremony timer toMarkdown edges", () => {
  it("lists the speaking order without times while no time-box is set", () => {
    const md = toMarkdown(
      { totalSeconds: 0, rotationMode: true, participants: people("Ann", "Bo") },
      NOW
    );
    expect(md).toContain("**Time-box:** not set yet");
    expect(md).toContain("## Speaking order\n");
    expect(md).not.toContain("each)");
    expect(md).toContain("| 1 | Ann | — | — |");
    expect(md).toContain("| 2 | Bo | — | — |");
  });

  it("shares one time-box when rotation is on but nobody is listed, or rotation is off", () => {
    const shared = "One shared time-box, no speaker rotation.";
    expect(toMarkdown({ totalSeconds: 600, rotationMode: true, participants: [] }, NOW)).toContain(
      shared
    );
    const off = toMarkdown(
      { totalSeconds: 600, rotationMode: false, participants: people("Ann") },
      NOW
    );
    expect(off).toContain(shared);
    expect(off).not.toContain("Ann");
  });

  it("keeps the ceremony name and speaker names on one line, pipes escaped", () => {
    const md = toMarkdown(
      {
        ceremony: "Retro | Q4",
        totalSeconds: 60,
        rotationMode: true,
        participants: people("Ann\nLee"),
      },
      NOW
    );
    expect(md).toContain("**Retro \\| Q4:** 01:00 time-box");
    expect(md).toContain("| 1 | Ann Lee | 00:00 | 01:00 |");
  });

  it("gives every speaker zero seconds but the last when the time-box is shorter than the list", () => {
    const md = toMarkdown(
      { totalSeconds: 2, rotationMode: true, participants: people("A", "B", "C") },
      NOW
    );
    expect(md).toContain("## Speaking order (00:00 each)");
    expect(md).toContain("| 3 | C | 00:00 | 00:02 |");
  });
});

describe("Ceremony Timer presets and custom duration", () => {
  it("shows the preset's time-box, marks it pressed and logs the change", () => {
    render(<CeremonyTimerClient />);
    expect(startButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect(clock("01:00:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Review/ })).toHaveAttribute("aria-pressed", "true");
    expect(startButton()).toBeEnabled();
    expect(resetButton()).toBeDisabled();
    expect(spies.log).toHaveBeenCalledWith(CEREMONY_TIMER_ACTIONS.PRESET_CHANGED, {
      minutes: 60,
    });
    expect(spies.markdown).toContain("**Review:** 1:00:00 time-box");
  });

  it("applies a custom duration with Set or Enter and empties the box", () => {
    render(<CeremonyTimerClient />);
    setCustom("25", "enter");
    expect(clock("25:00")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Custom duration in minutes" })).toBeNull();

    setCustom("480");
    expect(clock("08:00:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Custom/ }));
    expect(screen.getByRole("spinbutton", { name: "Custom duration in minutes" })).toHaveValue(
      null
    );
  });

  it("ignores zero, negative, blank and over-8-hour durations", () => {
    render(<CeremonyTimerClient />);
    for (const bad of ["0", "-5", "", "481"]) {
      setCustom(bad);
      expect(clock("00:00")).toBeInTheDocument();
      expect(
        screen.getByRole("spinbutton", { name: "Custom duration in minutes" })
      ).toBeInTheDocument();
    }
    expect(spies.log).not.toHaveBeenCalled();
  });

  // Bug: a fractional custom duration became fractional seconds — 1.33 min
  // showed "01:19.8", and 0.001 min a time-box of 0.06 s ("00:0.06").
  it("rounds a fractional duration to whole seconds and refuses one under a second", () => {
    render(<CeremonyTimerClient />);
    setCustom("1.33");
    expect(clock("01:20")).toBeInTheDocument();
    expect(spies.markdown).toContain("01:20 time-box");

    setCustom("0.001");
    expect(clock("01:20")).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Custom duration in minutes" })
    ).toBeInTheDocument();
  });
});

describe("Ceremony Timer countdown", () => {
  it("counts down from the wall clock, pauses without losing a second, and resets", () => {
    vi.useFakeTimers();
    render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("button", { name: /^Standup/ }));

    fireEvent.click(startButton());
    // The first start shows the first second gone straight away.
    expect(clock("14:59")).toBeInTheDocument();
    expect(startButton()).toHaveAccessibleName("Pause timer");
    expect(startButton()).toHaveAttribute("aria-pressed", "true");
    expect(spies.sonify).toHaveBeenCalledWith("start");
    expect(spies.log).toHaveBeenCalledWith(CEREMONY_TIMER_ACTIONS.TIMER_STARTED, {
      remainingSeconds: 900,
    });

    tick(2000);
    expect(clock("14:57")).toBeInTheDocument();

    fireEvent.click(startButton());
    expect(startButton()).toHaveAccessibleName("Start timer");
    tick(5000);
    expect(clock("14:57")).toBeInTheDocument();

    // Resuming doesn't take another second off.
    fireEvent.click(startButton());
    expect(clock("14:57")).toBeInTheDocument();
    tick(1000);
    expect(clock("14:56")).toBeInTheDocument();

    fireEvent.click(resetButton());
    expect(clock("15:00")).toBeInTheDocument();
    expect(startButton()).toHaveAccessibleName("Start timer");
    expect(resetButton()).toBeDisabled();
    expect(spies.log).toHaveBeenLastCalledWith(CEREMONY_TIMER_ACTIONS.TIMER_RESET, {
      totalSeconds: 900,
    });
  });

  it("stops at zero with a time's-up banner and the finish sound, once", () => {
    vi.useFakeTimers();
    render(<CeremonyTimerClient />);
    setCustom("0.25"); // 15 seconds
    expect(clock("00:15")).toBeInTheDocument();
    fireEvent.click(startButton());

    tick(3000);
    expect(spies.sonify).not.toHaveBeenCalledWith("ten-seconds");
    tick(1000);
    expect(clock("00:10")).toBeInTheDocument();
    expect(spies.sonify).toHaveBeenCalledWith("ten-seconds");
    tick(20_000);
    expect(clock("00:00")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Time's up!");
    expect(startButton()).toHaveAccessibleName("Start timer");
    expect(spies.sonify.mock.calls.filter(([e]) => e === "finish")).toHaveLength(1);
    expect(document.title).toMatch(/Time's up/);

    // Start does nothing at zero; Reset brings the time-box back.
    fireEvent.click(startButton());
    expect(startButton()).toHaveAccessibleName("Start timer");
    fireEvent.click(resetButton());
    expect(clock("00:15")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Ceremony Timer rotation", () => {
  it("adds participants with Enter or +, skipping blanks and repeated names", () => {
    render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("switch", { name: "Rotation mode" }));
    expect(screen.getByText("Add names to split time equally among participants.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add participant" })).toBeDisabled();

    addParticipants("Ann", "  Bo  ", "Ann", "   ");
    fireEvent.change(screen.getByRole("textbox", { name: "Participant name" }), {
      target: { value: "Cy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    expect(speakers()).toEqual(["Ann", "Bo", "Cy"]);
    expect(screen.getByRole("textbox", { name: "Participant name" })).toHaveValue("");
  });

  it("splits the time-box equally and hands over to the next speaker on time", () => {
    vi.useFakeTimers();
    render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("switch", { name: "Rotation mode" }));
    addParticipants("Ann", "Bo", "Cy");
    setCustom("3");
    fireEvent.click(startButton());

    expect(screen.getByText(/1 \/ 3/)).toHaveTextContent("1 / 3 · 01:00 per person");
    expect(row("Ann")).toHaveAttribute("aria-current", "step");
    // No one can be removed mid-countdown.
    expect(screen.getByRole("button", { name: "Remove Bo" })).toBeDisabled();

    tick(60_000);
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();
    expect(row("Bo")).toHaveAttribute("aria-current", "step");
    expect(row("Ann")).not.toHaveAttribute("aria-current");
    expect(spies.sonify).toHaveBeenCalledWith("rotate");

    tick(60_000);
    expect(row("Cy")).toHaveAttribute("aria-current", "step");
    expect(spies.markdown).toContain("## Speaking order (01:00 each)");
    expect(spies.markdown).toContain("| 3 | Cy | 02:00 | 01:00 |");
  });
});
