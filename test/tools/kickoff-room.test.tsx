import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import {
  WALL_ROOM_EVENTS,
  intentAad,
  lockOf,
  padIntent,
  type WallIntent,
  type WallRoundResult,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import { liveWall } from "@/lib/audience-wall/live";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kickoff, KickoffItem } from "@/lib/stores/workspace-types";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { NOW, fakeVoteCrypto, type FakeVoteCrypto } from "../realtime/vote-room-fixtures";

/**
 * Kickoff's "Collect from the room": an Audience Wall room (its room kind
 * and channel, not one of Kickoff's own) whose posts become lines of a
 * section the host picks (there is no default). Sections with an owner
 * column are never offered: a line there would name its poster. A round
 * lands most upvoted first, with merged duplicates as "(also: …)", cut to
 * the section's room (the page says how many didn't fit), and the kit's
 * Undo takes it back out. While live, Amr's room verbs reach it through the
 * live-wall registry (counts only).
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() })
);
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));

import {
  CollectRoom,
  KICKOFF_ROOM_KIND,
  lineFromPost,
  linesFromRound,
  roomTargets,
} from "@/app/(tools)/kickoff/collect-room";
import type { KickoffHandle } from "@/app/(tools)/kickoff/kickoff-handle";
import { KICKOFF_FORMAT_DEFS } from "@/lib/kickoff/formats";
import { normalizeKickoff } from "@/lib/kickoff/model";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";

const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bea", joinedAt: "2026-10-26T09:02:00Z" };
const AT = "2026-11-20T09:00:00.000Z";

const ws = () => useWorkspaceStore.getState();
const row = (id: string) => normalizeKickoff((ws().kickoffs ?? []).find((k) => k.id === id))!;

function handleFor(id: string): KickoffHandle {
  const kickoff = row(id);
  return {
    kickoff,
    example: false,
    read: () => row(id),
    write: (fn) => {
      const next = fn(row(id), new Date().toISOString());
      if (!next) return { ok: false, message: null };
      ws().upsertKickoff(next);
      return { ok: true, kickoff: next };
    },
    log: history.log,
  };
}

const item = (id: string, text: string): KickoffItem => ({ id, text });

const wrap = (ui: ReactNode) =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>
    </TooltipProvider>
  );

async function flush() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

async function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

/** The open room loads only once it opens (next/dynamic): wait for it in real time. */
async function settle(done: () => boolean) {
  await vi.waitFor(
    async () => {
      await act(async () => {
        vi.advanceTimersByTime(20);
      });
      expect(done()).toBe(true);
    },
    { timeout: 10_000, interval: 20 }
  );
}

beforeAll(() => import("@/components/collab/wall-room/host-wall-room"));

type State = WallStateBody & { sig: string };
const states = (ch: FakeChannel) => ch.sent(WALL_ROOM_EVENTS.state) as State[];

async function send(ch: FakeChannel, crypto: FakeVoteCrypto, by: string, intent: WallIntent) {
  const s = states(ch).at(-1)!;
  const iid = `iidr_${Math.random().toString(36).slice(2, 9).padEnd(7, "0")}`;
  const sealed = await crypto.seal(s.keys.ecdh, intentAad(by, iid), padIntent(intent)!);
  act(() => ch.deliver(WALL_ROOM_EVENTS.intent, { v: 1, by, iid, ...sealed }));
  await flush();
  await tick(600);
}

/** Start the room as Pat, with Alex in it. */
async function openRoom() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open the room" }));
  });
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Audience Wall");
  const name = dialog.querySelector("input:not([type=checkbox])") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(name, { target: { value: "Pat" } });
    fireEvent.click(dialog.querySelector("input[type=checkbox]")!);
    fireEvent.click(screen.getByRole("button", { name: "Start room" }));
  });
  await settle(() => fakeRealtime.channels.length > 0);
  const ch = fakeRealtime.last();
  act(() => ch.connect());
  await flush();
  const hostId = (ch.track.mock.calls.at(-1) as unknown as [{ id: string }])[0].id;
  act(() => ch.setPresence([{ id: hostId, name: "Pat", joinedAt: "2026-10-26T09:00:00Z" }, A, B]));
  await flush();
  await tick(600);
  return ch;
}

beforeEach(() => {
  toastSpy.mockReset();
  history.log.mockReset();
  sessionStorage.clear();
});

describe("the room's pure parts", () => {
  it("offers only list sections with no owner column", () => {
    expect(roomTargets(KICKOFF_FORMAT_DEFS["team-canvas"]).map((d) => d.id)).toEqual([
      "goals",
      "values",
      "rules",
      "strengths",
      "weaknesses",
    ]);
    // People, personal goals and needs would name their posters; the purpose is one answer.
    expect(roomTargets(KICKOFF_FORMAT_DEFS["alignment-map"]).map((d) => d.id)).toEqual([
      "objectives",
      "resources",
      "risks",
    ]);
    expect(roomTargets(KICKOFF_FORMAT_DEFS.inception).map((d) => d.id)).not.toContain("needs");
  });

  it("turns a round into lines, merged duplicates kept, cut to the room left", () => {
    const result: WallRoundResult = {
      roundId: "round_000001",
      tool: "audience-wall",
      prompt: "What do we hold to?",
      closedAt: AT,
      mode: "hidden",
      posts: [
        { text: "Kindness", votes: 4, merged: ["Be kind"] },
        { text: "Ship small", votes: 2, merged: [] },
        { text: "Honesty", votes: 1, merged: [] },
        { text: "kindness (also: be kind)", votes: 0, merged: [] },
      ],
    };
    expect(lineFromPost(result.posts[0])).toBe("Kindness (also: Be kind)");
    expect(lineFromPost({ text: "x".repeat(600), votes: 0, merged: [] })).toHaveLength(500);
    const values = KICKOFF_FORMAT_DEFS["team-canvas"].sections.find((d) => d.id === "values")!;
    let n = 0;
    const current = Array.from({ length: 8 }, (_, i) => item(`v${i}`, `Value ${i}`));
    expect(linesFromRound(result, values, current, () => `id${++n}`)).toEqual({
      items: [item("id1", "Kindness (also: Be kind)"), item("id2", "Ship small")],
      left: 1,
    });
  });
});

describe("collecting from the room", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    fakeRealtime.reset();
    const k: Kickoff = {
      id: "k1",
      title: "Checkout squad",
      format: "team-canvas",
      sections: {
        values: Array.from({ length: 9 }, (_, i) => item(`v${i}`, `Value ${i}`)),
      },
      status: "draft",
      createdAt: AT,
      updatedAt: AT,
    };
    useWorkspaceStore.setState({ kickoffs: [k] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("saves a round only into the section picked, cut to its room, with Undo", async () => {
    const crypto = fakeVoteCrypto();
    wrap(<CollectRoom handle={handleFor("k1")} crypto={crypto} />);
    await flush();
    const picker = screen.getByLabelText("Put the answers in") as HTMLSelectElement;
    const offered = Array.from(picker.options).map((o) => o.value);
    expect(offered).toEqual(["", "goals", "values", "rules", "strengths", "weaknesses"]);
    expect(picker.value).toBe("");
    const ch = await openRoom();
    // The Audience Wall's channel: Kickoff hosts no room of its own.
    expect(ch.name).toMatch(/^visitor:audience-wall:/);
    // Each target section's prompt is on offer; an owner section's never is.
    expect(
      screen.getByRole("button", {
        name: "The few things the team won't give up, however busy it gets.",
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "What each person needs from the others to do their best work.",
      })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "The few things the team won't give up, however busy it gets.",
      })
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open the wall" }));
    });
    await tick(600);
    const round = states(ch).at(-1)!.round!.id;
    await send(ch, crypto, A.id, {
      t: "post",
      r: round,
      pid: "pid_ko000001",
      text: "We tell each other early",
      lock: lockOf("keyA_0123456789abcdef"),
    });
    await send(ch, crypto, B.id, {
      t: "post",
      r: round,
      pid: "pid_ko000002",
      text: "Ship small",
      lock: lockOf("keyB_0123456789abcdef"),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal posts" }));
    });
    await flush();
    expect(row("k1").sections.values).toHaveLength(9);
    // No section picked: refused, and said why.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Pick the section these answers go in/);
    expect(row("k1").sections.values).toHaveLength(9);
    fireEvent.change(picker, { target: { value: "values" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    });
    // One line had room (values hold 10): the other is reported.
    const values = row("k1").sections.values;
    expect(values).toHaveLength(10);
    expect(values.at(-1)!.text).toMatch(/^(We tell each other early|Ship small)$/);
    expect(
      screen.getByText(/1 answer didn't fit: “What we hold to” holds 10\./)
    ).toBeInTheDocument();
    expect(JSON.stringify(row("k1"))).not.toContain(A.id);
    expect(JSON.stringify(row("k1"))).not.toContain("Alex");
    expect(JSON.stringify(row("k1"))).not.toContain(B.id);
    expect(history.log).toHaveBeenCalledWith(KICKOFF_ACTIONS.ITEMS_COLLECTED, {
      kickoffId: "k1",
      section: "values",
      count: 1,
    });
    const undo = [...toastSpy.mock.calls].reverse().find((c) => c[0] === "Saved the round");
    act(() => undo![1].action.onClick());
    expect(row("k1").sections.values).toHaveLength(9);
  });

  it("registers with Amr's live-wall registry while open, counts only", async () => {
    const crypto = fakeVoteCrypto();
    const view = wrap(<CollectRoom handle={handleFor("k1")} crypto={crypto} />);
    await flush();
    expect(liveWall()).toBeNull();
    const ch = await openRoom();
    expect(liveWall()?.status()).toMatchObject({
      kind: KICKOFF_ROOM_KIND,
      prompt: null,
      posts: 0,
      people: 3,
      unsaved: false,
    });
    let opened = false;
    act(() => {
      opened = liveWall()!.openRound("What are we good at?", "hidden");
    });
    expect(opened).toBe(true);
    await tick(600);
    const round = states(ch).at(-1)!.round!;
    await send(ch, crypto, A.id, {
      t: "post",
      r: round.id,
      pid: "pid_ko000003",
      text: "Testing early",
      lock: lockOf("keyA_0123456789abcdef"),
    });
    const status = liveWall()!.status();
    expect(status).toMatchObject({ posts: 1, shown: false, unsaved: true });
    expect(JSON.stringify(status)).not.toContain("Testing");
    view.unmount();
    expect(liveWall()).toBeNull();
    expect(within(document.body).queryByText("Testing early")).toBeNull();
  });

  it("tells the page while it is live, with unsaved answers, and when it ends", async () => {
    const crypto = fakeVoteCrypto();
    const onLiveChange = vi.fn();
    const view = wrap(
      <CollectRoom handle={handleFor("k1")} crypto={crypto} onLiveChange={onLiveChange} />
    );
    await flush();
    // Not live before it opens.
    expect(onLiveChange).not.toHaveBeenCalled();
    const ch = await openRoom();
    expect(onLiveChange).toHaveBeenLastCalledWith({ unsaved: false });
    act(() => {
      liveWall()!.openRound("What are we good at?", "hidden");
    });
    await tick(600);
    await send(ch, crypto, A.id, {
      t: "post",
      r: states(ch).at(-1)!.round!.id,
      pid: "pid_ko000004",
      text: "Testing early",
      lock: lockOf("keyA_0123456789abcdef"),
    });
    // A hidden round holding a post: a switch would lose it.
    expect(onLiveChange).toHaveBeenLastCalledWith({ unsaved: true });
    view.unmount();
    expect(onLiveChange).toHaveBeenLastCalledWith(null);
  });
});
