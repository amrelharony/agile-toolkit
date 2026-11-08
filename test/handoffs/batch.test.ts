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
import { sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
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
