import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { blankReview } from "@/lib/sprints/review-doc";
import type { SprintReview } from "@/lib/stores/workspace-types";
import {
  WALL_ROOM_EVENTS,
  intentAad,
  lockOf,
  padIntent,
  type WallIntent,
  type WallRoundResult,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { NOW, fakeVoteCrypto, type FakeVoteCrypto } from "../realtime/vote-room-fixtures";

/**
 * Sprint Review's "Run a feedback room": an Audience Wall room (its room
 * kind and channel, not one of Sprint Review's own) with a prompt per demo
 * item. The posts join the Feedback tab only on Save round, filed as the
 * kind the host picks (no default), from "Feedback room" (no names), and
 * the kit's Undo takes the round back out. The example review offers no
 * room.
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
  FEEDBACK_ROOM_STAKEHOLDER,
  FeedbackRoom,
  feedbackFromRound,
  feedbackRoomPrompts,
} from "@/app/(tools)/sprint-review/components/feedback-room";
import { FeedbackTab } from "@/app/(tools)/sprint-review/components/feedback-tab";
import type { ReviewSource } from "@/app/(tools)/sprint-review/types";

const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };

function source(extra: Partial<SprintReview> = {}, example = false) {
  let doc: SprintReview = {
    ...blankReview({ id: "s12", name: "Sprint 12" }),
    features: [
      {
        id: "f1",
        name: "One-tap checkout",
        description: "",
        acceptanceCriteria: "",
        timeMinutes: 5,
      },
      { id: "f2", name: "  ", description: "", acceptanceCriteria: "", timeMinutes: 0 },
    ],
    ...extra,
  };
  const src: ReviewSource = {
    get doc() {
      return doc;
    },
    stored: true,
    facts: null,
    stories: [],
    example,
    writer: {
      read: () => doc,
      update: (change) => {
        doc = change(doc);
      },
    },
  };
  return { src, doc: () => doc };
}

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

beforeEach(() => {
  toastSpy.mockReset();
  history.log.mockReset();
  sessionStorage.clear();
});

describe("the feedback room's pure parts", () => {
  it("offers the whole increment and one prompt per named demo item", () => {
    expect(
      feedbackRoomPrompts([{ name: "One-tap checkout" }, { name: " " }, { name: "Receipts" }])
    ).toEqual([
      "What do you think of what we showed today?",
      "What do you think of “One-tap checkout”?",
      "What do you think of “Receipts”?",
    ]);
  });

  it("turns a round into feedback from the room, the duplicates kept with it", () => {
    const result: WallRoundResult = {
      roundId: "round_000001",
      tool: "audience-wall",
      prompt: "What do you think of “One-tap checkout”?",
      closedAt: "2026-11-12T10:00:00.000Z",
      mode: "hidden",
      posts: [
        { text: "Faster than before", votes: 3, merged: ["So quick"] },
        { text: "Where is the receipt?", votes: 1, merged: [] },
      ],
    };
    let n = 0;
    expect(feedbackFromRound(result, "positive", () => `id${++n}`)).toEqual([
      {
        id: "id1",
        stakeholder: FEEDBACK_ROOM_STAKEHOLDER,
        feedback: "Faster than before (also: So quick)",
        category: "positive",
      },
      {
        id: "id2",
        stakeholder: FEEDBACK_ROOM_STAKEHOLDER,
        feedback: "Where is the receipt?",
        category: "positive",
      },
    ]);
  });
});

describe("the Feedback tab", () => {
  it("offers the room on a real review only, loaded when asked for", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    const ex = source({}, true);
    const view = wrap(<FeedbackTab source={ex.src} />);
    expect(screen.getByText(/the example keeps nothing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a feedback room" })).toBeNull();
    view.unmount();

    const real = source();
    wrap(<FeedbackTab source={real.src} />);
    const run = screen.getByRole("button", { name: "Run a feedback room" });
    expect(run).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      fireEvent.click(run);
    });
    expect(run).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(screen.queryByText("Loading the feedback room…")).toBeNull());
    vi.unstubAllEnvs();
  });
});

describe("the feedback room", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    fakeRealtime.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("imports the round into the feedback only on Save round, filed as the kind picked, with Undo", async () => {
    const crypto = fakeVoteCrypto();
    const s = source({
      feedbackItems: [{ id: "fb0", stakeholder: "Marco", feedback: "Nice", category: "positive" }],
    });
    wrap(<FeedbackRoom source={s.src} crypto={crypto} />);
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open the feedback room" }));
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Audience Wall");
    const name = dialog.querySelector("input:not([type=checkbox])") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(name, { target: { value: "Pat" } });
      fireEvent.click(dialog.querySelector("input[type=checkbox]")!);
      fireEvent.click(screen.getByRole("button", { name: "Start room" }));
    });
    await flush();
    const ch = fakeRealtime.last();
    // The Audience Wall's channel: Sprint Review hosts no room of its own.
    expect(ch.name).toMatch(/^visitor:audience-wall:/);
    act(() => ch.connect());
    await flush();
    const hostId = (ch.track.mock.calls.at(-1) as unknown as [{ id: string }])[0].id;
    act(() => ch.setPresence([{ id: hostId, name: "Pat", joinedAt: "2026-10-26T09:00:00Z" }, A]));
    await flush();
    await tick(600);
    // A prompt per demo item, to pick.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "What do you think of “One-tap checkout”?" })
      );
    });
    expect(screen.getByLabelText(/Prompt/)).toHaveValue("What do you think of “One-tap checkout”?");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open the wall" }));
    });
    await tick(600);
    const round = states(ch).at(-1)!.round!.id;
    await send(ch, crypto, A.id, {
      t: "post",
      r: round,
      pid: "pid_fb000001",
      text: "Faster than the old flow",
      lock: lockOf("keyA_0123456789abcdef"),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal posts" }));
    });
    await flush();
    // Nothing reaches the tab before Save round.
    expect(s.doc().feedbackItems).toHaveLength(1);
    // No kind picked: refused, and said why.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Pick what kind of feedback/);
    expect(s.doc().feedbackItems).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/File each round's posts as/), {
      target: { value: "positive" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    });
    expect(s.doc().feedbackItems).toHaveLength(2);
    expect(s.doc().feedbackItems[1]).toMatchObject({
      stakeholder: "Feedback room",
      feedback: "Faster than the old flow",
      category: "positive",
    });
    expect(JSON.stringify(s.doc())).not.toContain(A.id);
    expect(history.log).toHaveBeenCalledWith("feedback_added", {
      category: "positive",
      count: 1,
      from: "room",
    });
    // The next round asks for its kind again.
    expect(screen.getByLabelText(/File each round's posts as/)).toHaveValue("");
    const undo = [...toastSpy.mock.calls].reverse().find((c) => c[0] === "Saved the round");
    act(() => undo![1].action.onClick());
    expect(s.doc().feedbackItems.map((f) => f.id)).toEqual(["fb0"]);
  });
});
