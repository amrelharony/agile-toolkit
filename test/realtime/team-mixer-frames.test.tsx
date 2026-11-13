/**
 * Team Mixer's show-room frames: the parsers accept exactly what the host
 * builds (and nothing hidden, oversized or malformed), the biggest mix fits
 * one frame, and the phone view draws the groups or the café round with a
 * "Find your name" box that says where someone is, sending nothing.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ShowFrameView } from "@/components/collab/show-room/show-frame-view";
import { MIXER_LIMITS } from "@/lib/team-mixer/model";
import {
  TEAM_MIXER_FRAME_LIMITS,
  cafeFrame,
  groupsFrame,
  parseCafeFrame,
  parseGroupsFrame,
} from "@/lib/realtime/show-room/frames/team-mixer";
import {
  encodeShowPayload,
  parseShowPayload,
  showFrameKinds,
} from "@/lib/realtime/show-room/frames";
import { showRendererFor } from "@/lib/realtime/show-room/renderers";
import type { ShowFrame } from "@/lib/realtime/show-room/use-show-room";

const GROUPS = {
  title: "Retro breakouts",
  round: 2,
  unit: "group" as const,
  groups: [
    { name: "Oak", people: ["Ana", "Bo"] },
    { name: "", people: ["Cy", "Dee", "Anabel"] },
  ],
  sitOut: [],
};

const CAFE = {
  title: "",
  round: 1,
  rounds: 3,
  tables: [
    { name: "", host: "Ana", guests: ["Bo", "Cy"] },
    { name: "Ideas", host: "Dee", guests: ["Eve"] },
  ],
};

describe("the frame kinds", () => {
  it("are groups and cafe, beside the text frame", () => {
    expect(showFrameKinds("team-mixer").sort()).toEqual(["cafe", "groups", "text"]);
    expect(showRendererFor("team-mixer", "groups")).not.toBeNull();
    expect(showRendererFor("team-mixer", "cafe")).not.toBeNull();
    expect(showRendererFor("picker", "groups")).toBeNull();
  });
});

describe("parseGroupsFrame", () => {
  it("accepts a clean frame as it is", () => {
    expect(parseGroupsFrame(GROUPS)).toEqual(GROUPS);
    expect(parseGroupsFrame({ ...GROUPS, title: undefined, sitOut: undefined })).toEqual({
      ...GROUPS,
      title: "",
      sitOut: [],
    });
  });

  it("refuses hidden characters, a bad shape and too much", () => {
    const bad = (over: Record<string, unknown>) => parseGroupsFrame({ ...GROUPS, ...over });
    expect(bad({ round: 0 })).toBeNull();
    expect(bad({ round: 1.5 })).toBeNull();
    expect(bad({ unit: "table" })).toBeNull();
    expect(bad({ title: "Retro‮" })).toBeNull();
    expect(bad({ groups: [] })).toBeNull();
    expect(bad({ groups: [{ name: "", people: [] }] })).toBeNull();
    expect(bad({ groups: [{ name: "", people: ["Ana‏"] }] })).toBeNull();
    expect(bad({ groups: [{ name: "", people: [7] }] })).toBeNull();
    expect(bad({ groups: "Ana" })).toBeNull();
    expect(bad({ sitOut: "Eve" })).toBeNull();
    const crowd = Array.from({ length: 121 }, (_, i) => `P${i}`);
    expect(bad({ groups: [{ name: "", people: crowd }] })).toBeNull();
    expect(parseGroupsFrame("Ana")).toBeNull();
  });

  it("drops unknown fields and cuts long names to the cap", () => {
    const r = parseGroupsFrame({
      ...GROUPS,
      extra: 1,
      groups: [{ name: "x".repeat(60), people: ["y".repeat(80)], secret: true }],
    })!;
    expect(r).not.toHaveProperty("extra");
    expect(r.groups[0]).toEqual({
      name: "x".repeat(TEAM_MIXER_FRAME_LIMITS.maxGroupNameChars),
      people: ["y".repeat(TEAM_MIXER_FRAME_LIMITS.maxNameChars)],
    });
  });
});

describe("parseCafeFrame", () => {
  it("accepts a clean round, and refuses a round past the last or one table", () => {
    expect(parseCafeFrame(CAFE)).toEqual(CAFE);
    expect(parseCafeFrame({ ...CAFE, round: 4 })).toBeNull();
    expect(parseCafeFrame({ ...CAFE, tables: CAFE.tables.slice(0, 1) })).toBeNull();
    expect(
      parseCafeFrame({ ...CAFE, tables: [{ host: "", guests: [] }, CAFE.tables[1]] })
    ).toBeNull();
  });
});

describe("the host's builders", () => {
  it("strip hidden characters instead of refusing the host's own text", () => {
    const f = groupsFrame({
      title: "Retro‮ breakouts",
      round: 1,
      unit: "pair",
      groups: [{ people: ["Ana‏", "  Bo  "] }, { people: [] }],
    })!;
    expect(f.title).toBe("Retro breakouts");
    expect(f.groups).toEqual([{ name: "", people: ["Ana", "Bo"] }]);
    expect(cafeFrame({ round: 1, rounds: 1, tables: CAFE.tables })).toEqual({ ...CAFE, rounds: 1 });
  });

  it("fit the biggest mix, every name at its cap, in one frame", () => {
    const name = (i: number) => `${i}`.padEnd(40, "x");
    const pairs = Array.from({ length: 60 }, (_, g) => ({
      name: "n".repeat(40),
      people: [name(g * 2), name(g * 2 + 1)],
    }));
    const frame = groupsFrame({ title: "t".repeat(200), round: 999, unit: "pair", groups: pairs })!;
    expect(frame).not.toBeNull();
    const data = encodeShowPayload("team-mixer", "groups", frame);
    expect(data).not.toBeNull();
    expect(parseShowPayload("team-mixer", "groups", data)).toEqual(frame);
    // Full names would not fit, so these are cut short.
    expect(frame.groups[0].people[0]).toHaveLength(TEAM_MIXER_FRAME_LIMITS.shortNameChars);
  });

  it("send a name in full, as the page keeps it, when the frame fits", () => {
    expect(TEAM_MIXER_FRAME_LIMITS.maxNameChars).toBe(MIXER_LIMITS.name);
    const long = "Maria Fernanda Rodriguez-Gonzalez de la Cruz";
    const f = groupsFrame({ round: 1, unit: "group", groups: [{ people: [long, "Bo"] }] })!;
    expect(f.groups[0].people).toEqual([long, "Bo"]);
    const c = cafeFrame({
      round: 1,
      rounds: 1,
      tables: [{ host: long, guests: ["Bo"] }, CAFE.tables[1]],
    })!;
    expect(c.tables[0].host).toBe(long);
  });
});

function frameOf(kind: string, payload: unknown, n = 1): ShowFrame {
  return { n, kind, payload, supported: true, at: 1_000 + n };
}

const renderFrame = (frame: ShowFrame, surface: "phone" | "host" = "phone") =>
  render(
    <LiveAnnouncerProvider>
      <ShowFrameView tool="team-mixer" frame={frame} surface={surface} />
    </LiveAnnouncerProvider>
  );

describe("the groups view", () => {
  it("shows every group by name or number, and who sits out", () => {
    renderFrame(frameOf("groups", { ...GROUPS, sitOut: ["Eve"] }));
    expect(screen.getByText("Retro breakouts")).toBeInTheDocument();
    expect(screen.getByText("Round 2: 2 groups")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Oak" })).getAllByRole("listitem")).toHaveLength(
      2
    );
    expect(
      within(screen.getByRole("list", { name: "Group 2" })).getByText("Anabel")
    ).toBeInTheDocument();
    expect(screen.getByText("Sitting out this round: Eve.")).toBeInTheDocument();
  });

  it("says 1 pair, not 1 pairs", () => {
    renderFrame(
      frameOf("groups", { round: 1, unit: "pair", groups: [{ people: ["Ana", "Bo"] }], sitOut: [] })
    );
    expect(screen.getByText("Round 1: 1 pair")).toBeInTheDocument();
  });

  it("finds a name and says which group it's in", () => {
    renderFrame(frameOf("groups", GROUPS));
    const box = screen.getByLabelText("Find your name");
    fireEvent.change(box, { target: { value: "b" } });
    // One letter lights up nothing.
    expect(screen.queryByText(/ is in /)).toBeNull();
    fireEvent.change(box, { target: { value: "bo" } });
    expect(screen.getByText("Bo is in Oak.")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "ana" } });
    expect(
      screen.getByText("2 names match: Ana is in Oak.; Anabel is in Group 2.")
    ).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "zed" } });
    expect(screen.getByText("Nobody by that name in this round.")).toBeInTheDocument();
  });

  it("finds a long name by its last word, or typed in full when names were cut", () => {
    const long = "Maria Fernanda Rodriguez-Gonzalez de la Cruz";
    const view = renderFrame(
      frameOf(
        "groups",
        groupsFrame({ round: 1, unit: "group", groups: [{ people: [long, "Bo"] }] })
      )
    );
    const box = screen.getByLabelText("Find your name");
    fireEvent.change(box, { target: { value: "cruz" } });
    expect(screen.getByText(`${long} is in Group 1.`)).toBeInTheDocument();
    view.unmount();
    // The biggest mixes go with names cut short; the full name still finds its own.
    const cut = long.slice(0, TEAM_MIXER_FRAME_LIMITS.shortNameChars);
    renderFrame(
      frameOf("groups", {
        round: 1,
        unit: "group",
        groups: [{ name: "", people: [cut, "Bo"] }],
        sitOut: [],
      })
    );
    fireEvent.change(screen.getByLabelText("Find your name"), { target: { value: long } });
    expect(screen.getByText(`${cut} is in Group 1.`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find your name"), { target: { value: "" } });
  });

  it("keeps the typed name, and the box's focus, when the next round comes", () => {
    const view = render(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="team-mixer" frame={frameOf("groups", GROUPS, 1)} surface="phone" />
      </LiveAnnouncerProvider>
    );
    const box = screen.getByLabelText("Find your name");
    box.focus();
    fireEvent.change(box, { target: { value: "bo" } });
    expect(screen.getByText("Bo is in Oak.")).toBeInTheDocument();
    const next = {
      ...GROUPS,
      round: 3,
      groups: [
        { name: "", people: ["Cy", "Bo"] },
        { name: "Oak", people: ["Ana", "Dee"] },
      ],
    };
    view.rerender(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="team-mixer" frame={frameOf("groups", next, 2)} surface="phone" />
      </LiveAnnouncerProvider>
    );
    const again = screen.getByLabelText("Find your name");
    expect(again).not.toBe(box);
    expect(again).toHaveValue("bo");
    expect(again).toHaveFocus();
    expect(screen.getByText("Bo is in Group 1.")).toBeInTheDocument();
    // Not typing when the round after comes: the name stays, and the new
    // box leaves focus where it is.
    again.blur();
    view.rerender(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="team-mixer" frame={frameOf("groups", GROUPS, 3)} surface="phone" />
      </LiveAnnouncerProvider>
    );
    const third = screen.getByLabelText("Find your name");
    expect(third).not.toBe(again);
    expect(third).toHaveValue("bo");
    expect(third).not.toHaveFocus();
    expect(screen.getByText("Bo is in Oak.")).toBeInTheDocument();
    fireEvent.change(third, { target: { value: "" } });
  });

  it("has no find box on the host's preview", () => {
    renderFrame(frameOf("groups", GROUPS), "host");
    expect(screen.queryByLabelText("Find your name")).toBeNull();
    expect(screen.getByText("Round 2: 2 groups")).toBeInTheDocument();
  });

  it("has no find box, and lights up nobody, where nothing is a control (the Big screen)", () => {
    // A name typed on this page's phone view before.
    const phone = renderFrame(frameOf("groups", GROUPS));
    fireEvent.change(screen.getByLabelText("Find your name"), { target: { value: "bo" } });
    expect(phone.container.querySelector(".border-accent")).not.toBeNull();
    phone.unmount();
    for (const kind of ["groups", "cafe"] as const) {
      const view = render(
        <LiveAnnouncerProvider>
          <ShowFrameView
            tool="team-mixer"
            frame={frameOf(kind, kind === "groups" ? GROUPS : CAFE)}
            surface="phone"
            interactive={false}
          />
        </LiveAnnouncerProvider>
      );
      expect(screen.queryByLabelText("Find your name")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(view.container.querySelector(".border-accent")).toBeNull();
      expect(view.container.querySelector("li.font-bold")).toBeNull();
      view.unmount();
    }
    // Leave the phone's box empty for the tests after this one.
    renderFrame(frameOf("groups", GROUPS));
    fireEvent.change(screen.getByLabelText("Find your name"), { target: { value: "" } });
  });
});

describe("the café view", () => {
  it("shows each table's host and guests, and finds where someone goes", () => {
    renderFrame(frameOf("cafe", CAFE));
    expect(screen.getByText("World Café, round 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Host: Ana")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Ideas guests" })).getByText("Eve")
    ).toBeInTheDocument();
    const box = screen.getByLabelText("Find your name");
    fireEvent.change(box, { target: { value: "dee" } });
    expect(screen.getByText("Dee hosts Ideas and stays there.")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "cy" } });
    expect(screen.getByText("Cy goes to Table 1.")).toBeInTheDocument();
  });
});
