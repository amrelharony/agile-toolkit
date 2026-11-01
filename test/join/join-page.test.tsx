import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * `/join/<tool>/<code>`: the server page 404s anything but a visitor tool
 * with a 12-character code, says "Live rooms are off" with the flag off,
 * and otherwise asks for a name and consent before any channel opens. Each
 * tool lands in its own kind of room; a vote round's link must carry the
 * host key (`#k=`) before consent is even offered.
 */

const h = vi.hoisted(() => {
  const makeChannel = (name: string) => {
    const channel = {
      name,
      on: vi.fn(() => channel),
      subscribe: vi.fn((cb?: (status: string) => void) => {
        cb?.("SUBSCRIBED");
        return channel;
      }),
      track: vi.fn(async () => "ok"),
      untrack: vi.fn(async () => "ok"),
      unsubscribe: vi.fn(async () => "ok"),
      send: vi.fn(async () => "ok"),
      presenceState: vi.fn(() => ({})),
    };
    return channel;
  };
  return {
    client: {
      channel: vi.fn<(name: string, opts?: unknown) => ReturnType<typeof makeChannel>>((name) =>
        makeChannel(name)
      ),
      removeChannel: vi.fn(async () => "ok"),
    },
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
  };
});

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: h.notFound,
}));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => null,
}));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => true,
  getSupabaseClient: () => h.client,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// The Retro package owns the retro room; this page only mounts it.
vi.mock("@/app/(tools)/retro/room/visitor-retro-room", () => ({
  VisitorRetroRoom: (props: { code: string; identity: { name: string } }) => (
    <div data-testid="visitor-retro-room">
      {props.code} {props.identity.name}
    </div>
  ),
}));
// The vote-room kit owns the vote room; this page only routes to it.
vi.mock("@/components/collab/vote-room/vote-join-room", () => ({
  VoteJoinRoom: (props: { tool: string; code: string; identity: { name: string } }) => (
    <div data-testid="vote-join-room">
      {props.tool} {props.code} {props.identity.name}
    </div>
  ),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const cache = new Map<string, unknown>();
  const component = (tag: string) => {
    if (!cache.has(tag)) {
      const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
        const rest = { ...props };
        for (const k of ["initial", "animate", "exit", "transition", "layout"]) delete rest[k];
        return React.createElement(tag, { ...rest, ref });
      });
      C.displayName = `Motion(${tag})`;
      cache.set(tag, C);
    }
    return cache.get(tag);
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    MotionConfig: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => component(tag) }),
  };
});

import JoinRoomPage, { metadata } from "@/app/join/[tool]/[code]/page";

const CODE = "ABCDEFGHJKMN";

function renderPage(tool: string, code: string) {
  return render(JoinRoomPage({ params: { tool, code } }));
}

function consent(name: string) {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Join room" }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  h.client.channel.mockClear();
  h.client.removeChannel.mockClear();
  h.notFound.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("/join/[tool]/[code] page", () => {
  it.each([
    ["an unknown tool", "canvas", CODE],
    ["a tool name with a path in it", "planning-poker/..", CODE],
    ["an owner room's 6-character code", "planning-poker", "ABC234"],
    ["a lowercase code", "planning-poker", CODE.toLowerCase()],
    ["a code with ambiguous symbols", "retro", "ABCDEFGHJK0O"],
    ["a 13-character code", "retro", `${CODE}P`],
  ])("returns notFound() for %s", (_label, tool, code) => {
    expect(() => JoinRoomPage({ params: { tool, code } })).toThrow("NEXT_NOT_FOUND");
    expect(h.notFound).toHaveBeenCalledTimes(1);
  });

  it("is a 404 even with the flag off, before saying anything else", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    expect(() => JoinRoomPage({ params: { tool: "kudos", code: CODE } })).toThrow("NEXT_NOT_FOUND");
  });

  it("says live rooms are off (with a way home) when the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    renderPage("planning-poker", CODE);
    expect(screen.getByRole("heading", { name: "Live rooms are off" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the Agile Toolkit" })).toHaveAttribute(
      "href",
      "/"
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("is kept out of search indexes", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

// The rooms load lazily after consent: allow for a busy machine.
const LAZY = { timeout: 5000 };

describe("joining with the flag on", () => {
  it("asks for a name and consent first, with no channel open", () => {
    renderPage("planning-poker", CODE);
    const dialog = screen.getByRole("dialog", { name: "Join the live Planning Poker room" });
    expect(dialog).toHaveTextContent(/passes through our realtime provider \(Supabase\)/);
    // The dialog puts focus in the name field.
    expect(within(dialog).getByLabelText(/your name/i)).toHaveFocus();
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("connects to the visitor channel only after consent", async () => {
    renderPage("planning-poker", CODE);
    consent("Pat");
    expect(
      await screen.findByText("Waiting for the host to share the session…", {}, LAZY)
    ).toBeInTheDocument();
    expect(h.client.channel).toHaveBeenCalledTimes(1);
    expect(h.client.channel.mock.calls[0][0]).toBe(`visitor:planning-poker:${CODE}`);
    // The identity is kept for this tab only, under this room's code.
    const stored = JSON.parse(
      window.sessionStorage.getItem(`agile-toolkit:visitor-room:${CODE}`) ?? "null"
    ) as { id: string; name: string };
    expect(stored.name).toBe("Pat");
    expect(stored.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("mounts the retro room for /join/retro", async () => {
    renderPage("retro", CODE);
    expect(screen.getByRole("dialog", { name: "Join the live Retro room" })).toBeInTheDocument();
    expect(screen.queryByTestId("visitor-retro-room")).toBeNull();
    consent("Sam");
    expect(await screen.findByTestId("visitor-retro-room", {}, LAZY)).toHaveTextContent(
      `${CODE} Sam`
    );
  });

  it("cancelling consent opens nothing and moves focus to a way back in", () => {
    renderPage("planning-poker", CODE);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "You haven't joined the room" })).toHaveFocus();
    expect(h.client.channel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Join the room" }));
    expect(screen.getByRole("dialog", { name: "Join the live Planning Poker room" })).toBeVisible();
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("offers the name this tab used before in the room", () => {
    window.sessionStorage.setItem(
      `agile-toolkit:visitor-room:${CODE}`,
      JSON.stringify({ id: "abcdefghijklmnop", name: "Pat" })
    );
    renderPage("planning-poker", CODE);
    act(() => {});
    expect(within(screen.getByRole("dialog")).getByLabelText(/your name/i)).toHaveValue("Pat");
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it.each(["health-check", "psych-safety", "mood-tracker"])(
    "mounts the vote room (not Retro) for /join/%s with the host key",
    async (tool) => {
      window.history.replaceState(null, "", `#k=${"abcdefghijklmnopqrstuv"}`);
      renderPage(tool, CODE);
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(/Answers are encrypted in each person's browser/);
      expect(dialog).not.toHaveTextContent(/What you type passes through/);
      expect(h.client.channel).not.toHaveBeenCalled();
      consent("Sam");
      expect(await screen.findByTestId("vote-join-room", {}, LAZY)).toHaveTextContent(
        `${tool} ${CODE} Sam`
      );
      expect(screen.queryByTestId("visitor-retro-room")).toBeNull();
    }
  );

  it("says a vote link without #k= is incomplete, offers no consent and opens nothing", async () => {
    for (const hash of ["", "#k=short", "#x=abcdefghijklmnopqrstuv"]) {
      window.history.replaceState(null, "", hash || window.location.pathname);
      const { unmount } = renderPage("health-check", CODE);
      expect(await screen.findByRole("heading", { name: "This link is incomplete" })).toHaveFocus();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("button", { name: "Join the room" })).toBeNull();
      unmount();
    }
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("leaving the room closes the channel and offers to join again", async () => {
    renderPage("planning-poker", CODE);
    consent("Pat");
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }, LAZY));
    expect(h.client.removeChannel).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "You left the room" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Join again" })).toBeInTheDocument();
  });
});
