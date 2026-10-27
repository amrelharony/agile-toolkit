import { beforeEach, describe, expect, it, vi } from "vitest";

const undo: { last: { revert: () => void; label: string } | null } = { last: null };
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void; revert: () => void; label: string }) => {
    a.apply();
    undo.last = { revert: a.revert, label: a.label };
  },
}));

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink } from "@/lib/stores/workspace-types";
import { sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
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
