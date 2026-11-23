import { beforeEach, describe, expect, it, vi } from "vitest";

type Undo = { revert: () => void; label: string; kind?: string; id?: string };
const undo: { last: Undo | null } = { last: null };
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: Undo & { apply: () => void }) => {
    a.apply();
    undo.last = { revert: a.revert, label: a.label, kind: a.kind, id: a.id };
  },
}));

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink } from "@/lib/stores/workspace-types";
import { sendHandoff, sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { findRetroCard } from "@/lib/handoffs/targets/retro-board";
import { blankRetroBoard } from "@/lib/retro/board";
import { retroFormats } from "@/lib/constants/retro-formats";

/** Sending several items with one Undo, and finding a sent retro card on any board. */

function linkStore(initial: HandoffLink[] = []): HandoffLinkStore & { links: HandoffLink[] } {
  const s = {
    links: initial,
    getLinks: () => s.links,
    setLinks: (update: (l: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      s.links = update(s.links);
    },
  };
  return s;
}

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({ risks: [], retroBoards: [] });
});

describe("sendHandoffBatch", () => {
  it("sends several items with one Undo that takes them all back", () => {
    const a = linkStore();
    const b = linkStore();
    const blank = linkStore();
    // Rated: the risk route refuses an unrated risk rather than score it 3 × 3.
    const rated = { likelihood: 3, impact: 4 };
    const sent = sendHandoffBatch(
      "risk",
      [
        {
          src: { title: "Payments outage", ...rated, sourceRef: { tool: "premortem", id: "c1" } },
          links: a,
        },
        {
          src: { title: "Vendor late", ...rated, sourceRef: { tool: "premortem", id: "c2" } },
          links: b,
        },
        { src: { title: "  ", sourceRef: { tool: "premortem", id: "c3" } }, links: blank },
      ],
      "Sent 2 risks to the Risk Register"
    );
    expect(sent).toHaveLength(2);
    expect(undo.last?.label).toBe("Sent 2 risks to the Risk Register");
    // Sending destroys nothing: a success with Undo, and an id of its own so
    // it never merges with another send.
    expect(undo.last).toMatchObject({
      kind: "success",
      id: expect.stringMatching(/^handoff:risk:\d+$/),
    });
    expect(useWorkspaceStore.getState().risks.map((r) => r.title)).toEqual(
      expect.arrayContaining(["Payments outage", "Vendor late"])
    );
    expect(a.links).toHaveLength(1);
    expect(blank.links).toEqual([]);

    // A second batch skips the ones already sent.
    expect(
      sendHandoffBatch("risk", [
        {
          src: { title: "Payments outage", ...rated, sourceRef: { tool: "premortem", id: "c1" } },
          links: a,
        },
      ])
    ).toEqual([]);

    undo.last!.revert();
    expect(useWorkspaceStore.getState().risks).toEqual([]);
    expect(a.links).toEqual([]);
    expect(b.links).toEqual([]);
  });

  it("skips an item the route can't take (an unrated risk after a rated one); the rest send with Undo", () => {
    const rated = linkStore();
    const unrated = linkStore();
    const sent = sendHandoffBatch("risk", [
      {
        src: {
          title: "Payments outage",
          likelihood: 3,
          impact: 4,
          sourceRef: { tool: "premortem", id: "c1" },
        },
        links: rated,
      },
      {
        src: { title: "Vendor late", likelihood: 2, sourceRef: { tool: "premortem", id: "c2" } },
        links: unrated,
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(useWorkspaceStore.getState().risks.map((r) => r.title)).toEqual(["Payments outage"]);
    expect(rated.links).toHaveLength(1);
    expect(unrated.links).toEqual([]);
    // The one Undo covers what was sent.
    expect(undo.last).not.toBeNull();
    undo.last!.revert();
    expect(useWorkspaceStore.getState().risks).toEqual([]);
    expect(rated.links).toEqual([]);
    // Only unrated items: nothing to send, no toast.
    undo.last = null;
    expect(
      sendHandoffBatch("risk", [
        { src: { title: "Unrated", sourceRef: { tool: "premortem", id: "c3" } }, links: unrated },
      ])
    ).toEqual([]);
    expect(undo.last).toBeNull();
  });

  it("a send that still throws mid-batch takes back the ones sent before it", () => {
    const route = getHandoffRoute("risk");
    const a = linkStore();
    const b = linkStore();
    const items = [
      {
        src: {
          title: "First",
          likelihood: 3,
          impact: 3,
          sourceRef: { tool: "premortem", id: "c1" },
        },
        links: a,
      },
      {
        src: {
          title: "Second",
          likelihood: 3,
          impact: 3,
          sourceRef: { tool: "premortem", id: "c2" },
        },
        links: b,
      },
    ];
    const real = route.send;
    const spy = vi
      .spyOn(route, "send")
      .mockImplementationOnce((src) => real(src))
      .mockImplementationOnce(() => {
        throw new Error("store unavailable");
      });
    expect(() => sendHandoffBatch("risk", items)).toThrow("store unavailable");
    spy.mockRestore();
    expect(useWorkspaceStore.getState().risks).toEqual([]);
    expect(a.links).toEqual([]);
    expect(b.links).toEqual([]);
  });
});

describe("a source that can't hold another link (canLink)", () => {
  const rated = { likelihood: 3, impact: 4 };
  const src = (id: string) => ({
    title: `Risk ${id}`,
    ...rated,
    sourceRef: { tool: "premortem", id },
  });

  it("sendHandoff makes nothing and shows no toast when canLink says no", () => {
    const full = Object.assign(linkStore(), { canLink: () => false });
    expect(sendHandoff("risk", src("c1"), full)).toBeNull();
    expect(useWorkspaceStore.getState().risks).toEqual([]);
    expect(full.links).toEqual([]);
    expect(undo.last).toBeNull();
    // A store with room (or no canLink at all) sends as before.
    expect(
      sendHandoff("risk", src("c1"), Object.assign(linkStore(), { canLink: () => true }))
    ).not.toBeNull();
    expect(useWorkspaceStore.getState().risks).toHaveLength(1);
  });

  it("sendHandoffBatch skips only the items that can't hold their link", () => {
    const room = linkStore();
    const full = Object.assign(linkStore(), { canLink: () => false });
    const sent = sendHandoffBatch("risk", [
      { src: src("c1"), links: full },
      { src: src("c2"), links: room },
    ]);
    expect(sent).toHaveLength(1);
    expect(useWorkspaceStore.getState().risks.map((r) => r.title)).toEqual(["Risk c2"]);
    expect(room.links).toHaveLength(1);
    expect(full.links).toEqual([]);
    expect(sendHandoffBatch("risk", [{ src: src("c3"), links: full }])).toEqual([]);
    expect(useWorkspaceStore.getState().risks).toHaveLength(1);
  });
});

describe("findRetroCard", () => {
  it("finds a sent card on an archived copy too, so its link stays live after New Retro", () => {
    const card = {
      id: "c1",
      columnKey: "start",
      text: "From the review",
      votes: 0,
      groupedWith: null,
      isActionItem: true,
      assignee: "",
      discussing: false,
    };
    useWorkspaceStore.setState({
      retroBoards: [
        {
          ...blankRetroBoard(retroFormats[0]),
          id: "retro:2026-10-09",
          archivedAt: "2026-10-09",
          cards: [card],
        },
      ],
    });
    expect(findRetroCard("c1")?.text).toBe("From the review");
    expect(findRetroCard("nope")).toBeUndefined();
  });
});
