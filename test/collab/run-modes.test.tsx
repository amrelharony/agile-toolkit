import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The two named ways to run a session (components/collab/run-modes): the
 * same names everywhere, "One screen" first, and our own live-room limits
 * beside the live choice, taken from VISITOR_LIMITS.
 */

const limits = vi.hoisted(() => ({ maxMembers: 20, hardTtlMs: 3 * 60 * 60 * 1000 }));
vi.mock("@/lib/realtime/visitor-rooms", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/realtime/visitor-rooms")>();
  return {
    ...real,
    get VISITOR_LIMITS() {
      return { ...real.VISITOR_LIMITS, ...limits };
    },
  };
});

import {
  LiveRoomLimits,
  RUN_MODES,
  RunModeChoice,
  liveRoomLimits,
} from "@/components/collab/run-modes";

afterEach(() => {
  limits.maxMembers = 20;
  limits.hardTtlMs = 3 * 60 * 60 * 1000;
});

describe("the two ways to run it", () => {
  it("has the same two names everywhere", () => {
    expect(RUN_MODES).toEqual({
      oneScreen: "One screen",
      ownDevice: "Everyone on their own device",
    });
  });

  it("states our own limits only: no account, 20 people, 3 hours, nothing stored", () => {
    expect(liveRoomLimits()).toEqual([
      "No account needed, for you or your guests.",
      "Up to 20 people, for up to 3 hours.",
      "We store nothing.",
    ]);
  });

  it("takes the numbers from the constants", () => {
    limits.maxMembers = 12;
    limits.hardTtlMs = 2 * 60 * 60 * 1000;
    expect(liveRoomLimits()[1]).toBe("Up to 12 people, for up to 2 hours.");
    render(<LiveRoomLimits id="limits" />);
    expect(document.getElementById("limits")).toHaveTextContent("Up to 12 people");
  });

  it("names no one else", () => {
    const text = liveRoomLimits().join(" ");
    for (const rival of ["Estimioo", "Parabol", "EasyRetro", "TeamRetro", "Kollabe", "unlimited"]) {
      expect(text).not.toMatch(new RegExp(rival, "i"));
    }
  });

  it("shows One screen first, then Everyone on their own device with the limits beside it", () => {
    render(
      <RunModeChoice
        oneScreen={{ description: "Here on this screen.", action: <button>Start here</button> }}
        ownDevice={{ description: "On their phones.", action: <button>Start a live room</button> }}
      />
    );
    const choice = screen.getByRole("group", { name: "How will you run it?" });
    const [one, own] = within(choice).getAllByRole("group");
    expect(one).toHaveAccessibleName("One screen");
    expect(own).toHaveAccessibleName("Everyone on their own device");

    expect(within(one).getByText("Here on this screen.")).toBeInTheDocument();
    expect(within(one).getByRole("button", { name: "Start here" })).toBeInTheDocument();
    expect(within(one).queryByText(/No account needed/)).toBeNull();

    expect(within(own).getByText("On their phones.")).toBeInTheDocument();
    expect(within(own).getByRole("button", { name: "Start a live room" })).toBeInTheDocument();
    expect(within(own).getByText(liveRoomLimits().join(" "))).toBeInTheDocument();
  });
});
