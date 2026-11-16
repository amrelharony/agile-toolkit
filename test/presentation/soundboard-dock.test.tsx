/**
 * The soundboard while presenting (components/presentation/soundboard-dock):
 * off unless the facilitator turned it on in Facilitator Timers; then a
 * small button at the edge of Present mode opens the drumroll, gong,
 * applause, ding and Amr's cheer. Sound only, and only on a press.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const sounds = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock("@/lib/facilitator-timers/sounds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/facilitator-timers/sounds")>();
  return {
    ...actual,
    playSoundboard: (s: string) => {
      sounds.played.push(s);
      return true;
    },
  };
});
const cheers = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.calls.push(args),
}));

import {
  PresentationController,
  usePresentation,
} from "@/components/presentation/presentation-mode";
import { SoundboardDock } from "@/components/presentation/soundboard-dock";
import { FT_SETTINGS_INITIAL, useFacilitatorSettings } from "@/lib/facilitator-timers/store";

beforeEach(() => {
  sounds.played = [];
  cheers.calls = [];
  localStorage.clear();
  act(() => usePresentation.getState().set(false));
  useFacilitatorSettings.setState({ ...FT_SETTINGS_INITIAL });
});

describe("the presenting soundboard", () => {
  it("stays away unless it was turned on", () => {
    const { container } = render(<SoundboardDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the sounds from one button and plays them on a press", () => {
    useFacilitatorSettings.setState({ soundboardWhilePresenting: true });
    render(<SoundboardDock />);
    const toggle = screen.getByRole("button", { name: "Open the soundboard" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Soundboard" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close the soundboard" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Play gong" }));
    fireEvent.click(screen.getByRole("button", { name: "Play drumroll" }));
    expect(sounds.played).toEqual(["gong", "drumroll"]);
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr to cheer" }));
    expect(cheers.calls).toEqual([["facilitator-timers", "result", { sound: true }]]);
  });

  it("comes with Present mode, when it is on", async () => {
    useFacilitatorSettings.setState({ soundboardWhilePresenting: true });
    render(<PresentationController />);
    expect(screen.queryByRole("button", { name: "Open the soundboard" })).toBeNull();
    act(() => usePresentation.getState().set(true));
    expect(await screen.findByRole("button", { name: "Open the soundboard" })).toBeInTheDocument();
    act(() => usePresentation.getState().set(false));
    expect(screen.queryByRole("button", { name: "Open the soundboard" })).toBeNull();
  });
});
