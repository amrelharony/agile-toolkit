import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ShowFrameView } from "@/components/collab/show-room/show-frame-view";
import { spinWheel, freshProgress } from "@/lib/picker/model";
import { SPIN_MS, sliceAtPointer, spinMotion, wheelSlices } from "@/lib/picker/wheel";
import { SHOW_ROOM_EVENTS } from "@/lib/realtime/show-room/protocol";
import { PICKER_WHEEL_KIND, wheelFrame } from "@/lib/realtime/show-room/frames/picker";
import { createRng } from "@/lib/utils/random";
import { fakeRealtime, type FakeMember } from "./fake-realtime";
import { CODE, NOW, fakeVoteCrypto } from "./vote-room-fixtures";

/**
 * Picker's live spin end to end through the room kit: the host spins with
 * the page's rules, shows the wheel frame through useShowRoom, the signed
 * state crosses a fake Realtime channel to a participant's useShowRoom, and
 * the participant's ShowFrameView draws the wheel turning and stopping on
 * the name the host's spin picked.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useShowRoom } from "@/lib/realtime/show-room/use-show-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const ident = (m: FakeMember) => ({ id: m.id, name: m.name });

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

async function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  fakeRealtime.reset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Spin for the room", () => {
  it("stops on the host's name on a participant's phone", async () => {
    const crypto = fakeVoteCrypto();

    // The host opens the room.
    const host = renderHook(() =>
      useShowRoom({
        role: "host",
        tool: "picker",
        code: CODE,
        identity: ident(HOST),
        startedAt: NOW,
        crypto,
      })
    );
    await flush();
    const hostChannel = fakeRealtime.last();
    act(() => {
      hostChannel.connect();
      hostChannel.setPresence([HOST, A]);
    });
    await flush();
    await tick(600);
    expect(host.result.current.status).toBe("live");
    const fingerprint = /#k=([A-Za-z0-9_-]+)$/.exec(host.result.current.joinPath ?? "")?.[1];
    expect(fingerprint).toBeTruthy();

    // A participant joins with the link's key.
    const phone = renderHook(() =>
      useShowRoom({
        role: "participant",
        tool: "picker",
        code: CODE,
        identity: ident(A),
        hostFingerprint: fingerprint!,
        crypto,
      })
    );
    const phoneChannel = fakeRealtime.last();
    act(() => {
      phoneChannel.connect();
      phoneChannel.setPresence([HOST, A]);
    });
    await flush();

    // The host spins the team the way the page does, and shows it.
    const entries = ["Amina", "Ben", "Chloé", "Dev"].map((name, i) => ({
      name,
      weight: i === 1 ? 2 : 1,
    }));
    const rng = createRng(7);
    const outcome = spinWheel(
      entries,
      { ...freshProgress("team"), drawn: ["amina"] },
      { everyoneOnce: true, removePicked: false },
      rng
    )!;
    const frame = wheelFrame({
      names: outcome.shown.map((e) => e.name),
      weights: outcome.shown.map((e) => e.weight),
      out: [0],
      winner: outcome.winner,
      ...spinMotion(rng),
    })!;
    expect(frame).not.toBeNull();
    let shown = false;
    act(() => {
      shown = host.result.current.show(PICKER_WHEEL_KIND, frame);
    });
    expect(shown).toBe(true);
    await tick(400);

    // The signed state crosses the channel to the phone.
    const state = hostChannel.sent(SHOW_ROOM_EVENTS.state).at(-1);
    act(() => phoneChannel.deliver(SHOW_ROOM_EVENTS.state, state));
    await flush();
    const got = phone.result.current.frame;
    expect(got).toMatchObject({ kind: PICKER_WHEEL_KIND, supported: true });
    expect(got!.payload).toEqual(frame);

    // The phone draws it: turning first, then stopped on the host's name.
    render(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="picker" frame={got} />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByRole("status")).toHaveTextContent("Spinning…");
    await tick(SPIN_MS - 100);
    expect(screen.getByRole("status")).toHaveTextContent("Spinning…");
    await tick(200);
    expect(screen.getByRole("status")).toHaveTextContent(outcome.entry.name);
    const rotation = Number(screen.getByTestId("picker-wheel-disc").getAttribute("data-rotation"));
    expect(sliceAtPointer(wheelSlices(frame.weights), rotation)).toBe(outcome.winner);
    expect(frame.names[frame.winner]).toBe(outcome.entry.name);
  });
});
