import { vi } from "vitest";

/**
 * A stand-in for the Supabase Realtime client, for the Retro room tests.
 *
 * Mock `@/lib/realtime/supabase-client` with a factory that imports this
 * module and returns `fakeRealtime.client`. Each `channel()` call records a
 * FakeChannel whose broadcasts, presence and subscribe status the test drives
 * by hand.
 */

export interface FakeMember {
  id: string;
  name: string;
  joinedAt: string;
  color?: string;
}

type Listener = { type: string; event: string; cb: (payload?: unknown) => void };

export class FakeChannel {
  readonly listeners: Listener[] = [];
  private presence: Record<string, unknown[]> = {};
  private status: ((s: string) => void) | null = null;
  removed = false;

  constructor(readonly name: string) {}

  on = vi.fn((type: string, filter: { event: string }, cb: (payload?: unknown) => void) => {
    this.listeners.push({ type, event: filter.event, cb });
    return this;
  });
  subscribe = vi.fn((cb: (s: string) => void) => {
    this.status = cb;
    return this;
  });
  track = vi.fn(async () => "ok");
  untrack = vi.fn(async () => "ok");
  unsubscribe = vi.fn(async () => "ok");
  send = vi.fn<(message: { type: string; event: string; payload: unknown }) => Promise<string>>(
    async () => "ok"
  );
  presenceState = vi.fn(() => this.presence);

  /** The server confirmed the subscription. */
  connect() {
    this.status?.("SUBSCRIBED");
  }

  /** Replace who is present and fire a presence sync. */
  setPresence(members: FakeMember[]) {
    this.presence = Object.fromEntries(members.map((m) => [m.id, [{ color: "#00f0ff", ...m }]]));
    for (const l of this.listeners) if (l.type === "presence" && l.event === "sync") l.cb();
  }

  /** Deliver a broadcast from a peer. */
  deliver(event: string, payload: unknown) {
    for (const l of this.listeners)
      if (l.type === "broadcast" && l.event === event) l.cb({ payload });
  }

  /** Payloads this client broadcast on `event`, oldest first. */
  sent(event: string): unknown[] {
    return this.send.mock.calls
      .map((c) => c[0])
      .filter((m) => m.event === event)
      .map((m) => m.payload);
  }
}

export const fakeRealtime = {
  channels: [] as FakeChannel[],
  client: {
    channel: vi.fn((name: string) => {
      const ch = new FakeChannel(name);
      fakeRealtime.channels.push(ch);
      return ch;
    }),
    removeChannel: vi.fn(async (ch: FakeChannel) => {
      ch.removed = true;
      return "ok";
    }),
  },
  reset() {
    fakeRealtime.channels.length = 0;
    fakeRealtime.client.channel.mockClear();
    fakeRealtime.client.removeChannel.mockClear();
  },
  /** The most recently opened channel. */
  last(): FakeChannel {
    const ch = fakeRealtime.channels.at(-1);
    if (!ch) throw new Error("no channel was opened");
    return ch;
  },
};
