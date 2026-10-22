import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KUDOS_ACTIONS } from "@/lib/history/event-actions";

/**
 * Kudos gap-filling, tool directory only: the theme helper, the wall's feed
 * (order, dedup stacks, replies, orphans, limit, highlight), the card
 * (dates, reaction strip, reply chevron), the reply composer, the compose
 * form's validation and reset, the settings dialog, the realtime room hook
 * (local, broadcast, inbound, snapshot heartbeat, guest cap) and the page
 * for a visitor and the owner. (lib/kudos — parse, LLM, cloud sync, beacon
 * signals — and the reaction hook have their own tests in test/kudos.)
 */

const h = vi.hoisted(() => ({
  log: vi.fn(),
  emit: vi.fn(),
  exportPng: vi.fn<(node: unknown, filename: string) => Promise<void>>(async () => {}),
  dispatch: vi.fn(),
  analyseSentiment: vi.fn(async (): Promise<unknown> => null),
  detectDuplicate: vi.fn(async (): Promise<unknown> => null),
  computeFairness: vi.fn(async (): Promise<unknown> => null),
  auth: { value: null as unknown },
  reducedMotion: { value: true },
  room: {
    isLocalOnly: true,
    isConnected: false,
    members: [] as { id: string }[],
    userId: "me",
    lastRoomId: null as string | null,
    broadcast: vi.fn(),
    handlers: new Map<string, (payload: unknown) => void>(),
  },
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children, description }: { children: ReactNode; description: string }) => (
    <div>
      <p>{description}</p>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/collab/session-share-button", () => ({ SessionShareButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));
vi.mock("@/lib/sonification/emit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sonification/emit")>()),
  emit: h.emit,
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/whiteboard/export", () => ({ exportPng: h.exportPng }));
vi.mock("@/lib/gamification/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gamification/engine")>()),
  dispatch: h.dispatch,
}));
vi.mock("@/lib/kudos/llm", () => ({
  analyseSentiment: h.analyseSentiment,
  detectDuplicate: h.detectDuplicate,
  computeFairness: h.computeFairness,
  installFairnessInvalidator: () => () => {},
  primeRecipientSuggestion: async () => {},
  getLastFairnessResult: () => null,
}));
vi.mock("@/lib/kudos/llm/sentiment", () => ({ analyseSentiment: h.analyseSentiment }));
vi.mock("@/lib/predictions/use-predicted-default", () => ({
  usePredictedDefault: () => ({ value: "", confidence: "none" }),
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => h.auth.value,
}));
vi.mock("@/lib/realtime/supabase-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/realtime/supabase-client")>()),
  isRealtimeAvailable: () => false,
}));
vi.mock("@/lib/realtime/use-room", () => ({
  useRoom: (_tool: string, roomId: string | null) => {
    h.room.lastRoomId = roomId;
    return {
      state: null,
      setState: () => {},
      members: h.room.members,
      isConnected: h.room.isConnected,
      isLocalOnly: h.room.isLocalOnly,
      authFailed: false,
      roomId,
      userId: h.room.userId,
      broadcast: h.room.broadcast,
      subscribeToEvent: (event: string, handler: (payload: unknown) => void) => {
        h.room.handlers.set(event, handler);
        return () => h.room.handlers.delete(event);
      },
      roomFull: false,
    };
  },
}));
// Plain elements instead of animation; reduced motion is switchable.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const drop = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const cache = new Map<string, unknown>();
  const motion = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        if (!cache.has(tag)) {
          const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
            React.createElement(tag, {
              ...Object.fromEntries(Object.entries(props).filter(([k]) => !drop.has(k))),
              ref,
            })
          );
          C.displayName = `Motion(${tag})`;
          cache.set(tag, C);
        }
        return cache.get(tag);
      },
    }
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    useReducedMotion: () => h.reducedMotion.value,
  };
});

import { getKudosTheme } from "@/app/(tools)/kudos/types";
import { useKudosThread } from "@/app/(tools)/kudos/use-kudos-thread";
import { KudosWall } from "@/app/(tools)/kudos/components/kudos-wall";
import { KudosCard } from "@/app/(tools)/kudos/components/kudos-card";
import { KudosThreadReply } from "@/app/(tools)/kudos/components/kudos-thread-reply";
import { KudosForm, type RecipientOption } from "@/app/(tools)/kudos/components/kudos-form";
import { KudosSettings } from "@/app/(tools)/kudos/components/kudos-settings";
import { useKudosRoom, useOwnerKudosRoomKey } from "@/app/(tools)/kudos/use-kudos-room";
import { KudosClient } from "@/app/(tools)/kudos/kudos-client";

let seq = 0;
function kudo(extra: Partial<Kudos> = {}): Kudos {
  seq += 1;
  return {
    id: `kud_${seq}`,
    theme: "thank-you",
    toName: "Bob",
    fromName: "Alice",
    message: `Thanks for the review ${seq}`,
    sentAt: new Date(Date.UTC(2026, 9, 1, 9, seq)).toISOString(),
    ...extra,
  };
}
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const stored = () => useWorkspaceStore.getState().kudos ?? [];

const SETTINGS = {
  aiSentiment: false,
  aiDedup: false,
  aiFairness: false,
  beaconAmbient: false,
  beaconHeader: false,
  customThemes: [],
};

beforeEach(() => {
  h.log.mockClear();
  h.emit.mockClear();
  h.exportPng.mockClear();
  h.dispatch.mockClear();
  h.analyseSentiment.mockReset().mockResolvedValue(null);
  h.detectDuplicate.mockReset().mockResolvedValue(null);
  h.computeFairness.mockReset().mockResolvedValue(null);
  h.auth.value = null;
  h.reducedMotion.value = true;
  Object.assign(h.room, {
    isLocalOnly: true,
    isConnected: false,
    members: [],
    userId: "me",
    lastRoomId: null,
  });
  h.room.broadcast.mockClear();
  h.room.handlers.clear();
  useKudosSettingsStore.setState(SETTINGS);
  useWorkspaceStore.setState({ kudos: [], teamMembers: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("kudos helpers", () => {
  it("resolves a custom theme object to its own title, emoji and colour", () => {
    expect(
      getKudosTheme({ id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#123456" })
    ).toEqual({
      id: "ship-day",
      title: "Ship Day",
      emoji: "🚢",
      accent: "border-border",
      headerBg: "",
      hex: "#123456",
    });
  });

  it("toggles one reply composer per kudos", () => {
    const { result } = renderHook(() => useKudosThread());
    act(() => result.current.toggleExpand("a"));
    act(() => result.current.toggleExpand("b"));
    expect(result.current.isExpanded("a")).toBe(true);
    act(() => result.current.toggleExpand("a"));
    expect(result.current.isExpanded("a")).toBe(false);
    expect(Array.from(result.current.expandedKudosIds)).toEqual(["b"]);
  });
});

describe("KudosWall", () => {
  /** The top-level cards' kudos ids, in feed order. */
  const feedIds = () =>
    Array.from(screen.getByRole("feed").children).map((a) =>
      a.querySelector("[data-kudos-id]")?.getAttribute("data-kudos-id")
    );

  it("says there are no kudos yet", () => {
    render(<KudosWall kudos={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No kudos yet");
  });

  it.each([true, false])("shows the newest first (reduced motion: %s)", (reduced) => {
    h.reducedMotion.value = reduced;
    const [a, b, c] = [kudo(), kudo(), kudo()];
    render(<KudosWall kudos={[b, c, a]} />);
    const ids = reduced
      ? feedIds()
      : Array.from(screen.getByRole("feed").querySelectorAll(":scope > div > article")).map((art) =>
          art.querySelector("[data-kudos-id]")?.getAttribute("data-kudos-id")
        );
    expect(ids).toEqual([c.id, b.id, a.id]);
  });

  it("labels each card for screen readers, shortening a long message", () => {
    const long = kudo({ message: "x".repeat(130), theme: "you-rock", toName: "Cy" });
    render(<KudosWall kudos={[long]} />);
    expect(screen.getByRole("article")).toHaveAccessibleName(
      `You Rock! kudos from Alice to Cy: ${"x".repeat(117)}…`
    );
  });

  it("folds near-duplicates into the newest card with an expandable stack", () => {
    const older = kudo({ llmDedupGroup: "g1", message: "Great demo" });
    const solo = kudo();
    const newer = kudo({ llmDedupGroup: "g1", message: "Great demo!!" });
    render(<KudosWall kudos={[older, solo, newer]} />);
    expect(feedIds()).toEqual([newer.id, solo.id]);

    const toggle = screen.getByRole("button", { name: "Show +1 similar" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Great demo")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide +1 similar" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("Great demo")).toBeInTheDocument();
  });

  it("nests replies under their parent in send order, and surfaces orphaned replies", () => {
    const parent = kudo({ message: "Parent" });
    const late = kudo({ replyTo: parent.id, message: "Second reply" });
    const early = kudo({
      replyTo: parent.id,
      message: "First reply",
      sentAt: new Date(Date.UTC(2026, 9, 1, 9, 0, 30)).toISOString(),
    });
    const orphan = kudo({ replyTo: "kud_gone", message: "Orphan" });
    render(<KudosWall kudos={[parent, late, early, orphan]} />);
    expect(feedIds()).toEqual([orphan.id, parent.id]);
    const parentArticle = screen.getByText("Parent").closest("article")!;
    const replies = within(parentArticle)
      .getAllByRole("article")
      .map((a) => a.querySelector("p")?.textContent);
    expect(replies).toEqual(["First reply", "Second reply"]);
  });

  it("caps the feed and rings kudos addressed to the viewer", () => {
    const [a, b] = [kudo(), kudo()];
    const mine = kudo({ toProfileId: "p-me" }); // the newest
    render(<KudosWall kudos={[a, b, mine]} limit={2} highlightToProfileId="p-me" />);
    expect(feedIds()).toHaveLength(2);
    const first = screen.getByRole("feed").children[0];
    expect(first).toHaveClass("ring-2");
    expect(screen.getByRole("feed").children[1]).not.toHaveClass("ring-2");
  });

  it("opens a reply composer that posts a reply and closes", async () => {
    const parent = kudo({ toProfileId: "p-bob", teamName: "Platform", theme: "great-job" });
    const onSendReply = vi.fn();
    render(<KudosWall kudos={[parent]} onSendReply={onSendReply} replyFromName="Dana" />);
    fireEvent.click(screen.getByRole("button", { name: "Reply to this kudos" }));
    const input = screen.getByRole("textbox", { name: "Reply to kudos for Bob" });
    fireEvent.change(input, { target: { value: "  Seconded!  " } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(onSendReply).toHaveBeenCalledTimes(1));
    expect(onSendReply.mock.calls[0][0]).toMatchObject({
      replyTo: parent.id,
      theme: "great-job",
      toName: "Bob",
      toProfileId: "p-bob",
      teamName: "Platform",
      fromName: "Dana",
      message: "Seconded!",
    });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Reply to kudos for Bob" })).toBeNull()
    );
  });

  it("offers no reply without a reply handler", () => {
    render(<KudosWall kudos={[kudo()]} />);
    expect(screen.queryByRole("button", { name: "Reply to this kudos" })).toBeNull();
  });
});

describe("KudosCard", () => {
  it("shows a dash for an unreadable date and the team after the sender", () => {
    render(<KudosCard kudos={kudo({ sentAt: "lol", teamName: "Platform" })} />);
    expect(screen.getByText("Date: —")).toBeInTheDocument();
    expect(screen.getByText(/^Signed:/)).toHaveTextContent("Signed: Alice, Platform");
  });

  it("groups reactions by emoji, marks the viewer's own and adds from the picker", () => {
    const onAddReaction = vi.fn();
    const k = kudo({
      reactions: [
        { emoji: "🎉", byProfileId: "a", at: "2026-10-01T09:00:00.000Z" },
        { emoji: "👏", byProfileId: "b", at: "2026-10-01T09:01:00.000Z" },
        { emoji: "🎉", byProfileId: "me", at: "2026-10-01T09:02:00.000Z" },
      ],
    });
    render(<KudosCard kudos={k} viewerProfileId="me" onAddReaction={onAddReaction} />);
    const party = screen.getByRole("button", { name: "React with 🎉, 2 so far — you reacted" });
    expect(party).toHaveAttribute("aria-pressed", "true");
    const clap = screen.getByRole("button", { name: "React with 👏, 1 so far" });
    expect(clap).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(clap);
    expect(onAddReaction).toHaveBeenLastCalledWith(k.id, "👏");

    fireEvent.click(screen.getByRole("button", { name: "Add a reaction" }));
    fireEvent.click(screen.getByRole("button", { name: "React with 🚀" }));
    expect(onAddReaction).toHaveBeenLastCalledWith(k.id, "🚀");
  });

  it("hides the reply chevron on a reply, and all chrome on the export copy", () => {
    const { rerender } = render(
      <KudosCard kudos={kudo({ replyTo: "kud_x" })} onToggleReply={() => {}} />
    );
    expect(screen.queryByRole("button", { name: "Reply to this kudos" })).toBeNull();

    rerender(
      <KudosCard
        kudos={kudo({
          reactions: [{ emoji: "🎉", byProfileId: "a", at: "2026-10-01T09:00:00.000Z" }],
        })}
        excludeInteractive
        onToggleReply={() => {}}
        onAddReaction={() => {}}
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
    // A read-only card still shows its reactions.
    rerender(
      <KudosCard
        kudos={kudo({
          reactions: [{ emoji: "🎉", byProfileId: "a", at: "2026-10-01T09:00:00.000Z" }],
        })}
      />
    );
    expect(screen.getByRole("button", { name: "React with 🎉, 1 so far" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a reaction" })).toBeNull();
  });

  it("renders a custom theme's title", () => {
    render(
      <KudosCard
        kudos={kudo({ theme: { id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#123456" } })}
      />
    );
    expect(screen.getByRole("heading", { name: "Ship Day" })).toBeInTheDocument();
  });
});

describe("KudosThreadReply", () => {
  const parent = kudo();

  it("needs one to fifty words", () => {
    render(<KudosThreadReply parent={parent} fromName="" onSend={() => {}} />);
    const send = screen.getByRole("button", { name: "Reply" });
    expect(send).toBeDisabled();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: words(51) } });
    expect(send).toBeDisabled();
    expect(screen.getByText("51/50 words")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: words(50) } });
    expect(send).toBeEnabled();
  });

  it("signs a nameless reply with a dash, and keeps the text when sending fails", async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
    const onSent = vi.fn();
    render(<KudosThreadReply parent={parent} fromName="  " onSend={onSend} onSent={onSent} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Nice one" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    expect(onSent).not.toHaveBeenCalled();
    expect(input).toHaveValue("Nice one");

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[1][0]).toMatchObject({ fromName: "—", replyTo: parent.id });
    expect(input).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("KudosForm", () => {
  const recipients: RecipientOption[] = [
    { id: "squad:p1", displayName: "Ana Lima", profileId: "p1", source: "squad" },
    { id: "team:t1", displayName: "Sam", source: "team" },
  ];
  const toSelect = () => screen.getByLabelText("To") as HTMLSelectElement;
  const sendButton = () => screen.getByRole("button", { name: /Send kudos/ });

  function renderForm(props: Partial<Parameters<typeof KudosForm>[0]> = {}) {
    const onSubmit = vi.fn();
    const onDownload = vi.fn();
    const view = render(
      <KudosForm
        defaultFromName="Olivia"
        recipients={recipients}
        onSubmit={onSubmit}
        onDownload={onDownload}
        {...props}
      />
    );
    return { onSubmit, onDownload, ...view };
  }

  it("picks the predicted recipient, else the first one", () => {
    const more = [
      ...recipients,
      { id: "squad:p3", displayName: "Cara", profileId: "p3", source: "squad" as const },
    ];
    const first = renderForm({ recipients: more, predictedRecipientId: "p3" });
    expect(toSelect()).toHaveValue("squad:p3");
    first.unmount();
    renderForm({ recipients: more, predictedRecipientId: "p-unknown" });
    expect(toSelect()).toHaveValue("squad:p1");
  });

  it("enforces the word limits on message, team and recipient", () => {
    renderForm();
    const message = screen.getByLabelText("Message");
    expect(sendButton()).toBeDisabled();
    fireEvent.change(message, { target: { value: words(51) } });
    expect(screen.getByText("51/50 words")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    fireEvent.change(message, { target: { value: words(50) } });
    expect(sendButton()).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Team (optional)"), {
      target: { value: "Data Gov Team X" },
    });
    expect(sendButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Team (optional)"), { target: { value: "Data Gov" } });
    expect(sendButton()).toBeEnabled();

    fireEvent.change(toSelect(), { target: { value: "free" } });
    expect(sendButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Recipient name"), {
      target: { value: "Mary Ann de la Cruz" },
    });
    expect(screen.getByText("Up to 4 words.")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /Download PNG/ })).toBeDisabled();
  });

  it("sends to a typed name with the chosen theme, then resets for the next one", async () => {
    const { onSubmit } = renderForm({ defaultTeamName: "Platform" });
    fireEvent.click(screen.getByRole("button", { name: /Thank You/ }));
    expect(screen.getByRole("button", { name: /Thank You/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.change(toSelect(), { target: { value: "free" } });
    fireEvent.change(screen.getByLabelText("Recipient name"), { target: { value: "  Dana  " } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Great pairing  " } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const sent = onSubmit.mock.calls[0][0] as Kudos;
    expect(sent).toMatchObject({
      theme: "thank-you",
      toName: "Dana",
      fromName: "Olivia",
      teamName: "Platform",
      message: "Great pairing",
    });
    expect(sent.toProfileId).toBeUndefined();
    expect(sent.id).toMatch(/^kud_/);
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
    expect(toSelect()).toHaveValue("");
    expect(screen.getByRole("button", { name: /Thank You/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.change(toSelect(), { target: { value: "squad:p1" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Again" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const second = onSubmit.mock.calls[1][0] as Kudos;
    expect(second).toMatchObject({ toName: "Ana Lima", toProfileId: "p1" });
    expect(second.id).not.toBe(sent.id);
  });

  it("shows why a send failed and keeps the message", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("Server said no");
    });
    renderForm({ onSubmit });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks" } });
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Server said no");
    expect(screen.getByLabelText("Message")).toHaveValue("Thanks");
    expect(sendButton()).toBeEnabled();
  });

  it("offers custom themes from settings and sends them inline", async () => {
    useKudosSettingsStore.setState({
      customThemes: [{ id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#123456" }],
    });
    const { onSubmit } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Ship Day/ }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Shipped" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].theme).toEqual({
      id: "ship-day",
      title: "Ship Day",
      emoji: "🚢",
      hex: "#123456",
    });
  });

  it("snaps to a forced recipient whenever its token changes", () => {
    const { rerender, onSubmit, onDownload } = renderForm();
    fireEvent.change(toSelect(), { target: { value: "team:t1" } });
    const props = { defaultFromName: "Olivia", recipients, onSubmit, onDownload };
    rerender(<KudosForm {...props} forcedRecipient={{ id: "squad:p1", token: 1 }} />);
    expect(toSelect()).toHaveValue("squad:p1");
    fireEvent.change(toSelect(), { target: { value: "team:t1" } });
    rerender(<KudosForm {...props} forcedRecipient={{ id: "squad:p1", token: 1 }} />);
    expect(toSelect()).toHaveValue("team:t1");
    rerender(<KudosForm {...props} forcedRecipient={{ id: "squad:p1", token: 2 }} />);
    expect(toSelect()).toHaveValue("squad:p1");
  });

  it("downloads the live preview and notes a long sender name without blocking", () => {
    const { onDownload } = renderForm({ defaultFromName: "Olivia Maria de la Cruz" });
    expect(screen.getByText("Long names render small on the card.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks" } });
    expect(sendButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Download PNG/ }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    const [preview, el] = onDownload.mock.calls[0];
    expect(preview).toMatchObject({ toName: "Ana Lima", message: "Thanks" });
    expect(el).toHaveAttribute("data-kudos-id", preview.id);
  });

  it("warns about a sarcastic-sounding message when sentiment analysis is on", async () => {
    useKudosSettingsStore.setState({ aiSentiment: true });
    h.analyseSentiment.mockResolvedValue({
      label: "backhanded",
      confidence: 0.9,
      tone: ["sarcastic"],
    });
    renderForm();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Short" } });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Wow, you finally finished it" },
    });
    expect(
      await screen.findByText(/This reads as sarcastic — send anyway\?/, {}, { timeout: 2000 })
    ).toHaveTextContent("(tone: sarcastic)");
    expect(h.analyseSentiment).toHaveBeenCalledTimes(1);
    expect(sendButton()).toBeEnabled();
  });
});

describe("KudosSettings", () => {
  it("switches each feature off and on", () => {
    useKudosSettingsStore.setState({ ...SETTINGS, aiSentiment: true, beaconHeader: true });
    render(<KudosSettings open onOpenChange={() => {}} />);
    const sentiment = screen.getByRole("switch", { name: /^Sentiment analysis/ });
    expect(sentiment).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sentiment);
    expect(useKudosSettingsStore.getState().aiSentiment).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: /^Duplicate detection/ }));
    fireEvent.click(screen.getByRole("switch", { name: /^Ambient beacon/ }));
    fireEvent.click(screen.getByRole("switch", { name: /^Header beacon/ }));
    expect(useKudosSettingsStore.getState()).toMatchObject({
      aiDedup: true,
      beaconAmbient: true,
      beaconHeader: false,
    });
  });

  it("adds a valid custom theme, rejects a bad one, and deletes", () => {
    render(<KudosSettings open onOpenChange={() => {}} />);
    expect(screen.getByText("No custom themes yet.")).toBeInTheDocument();
    const add = screen.getByRole("button", { name: /Add theme/ });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Id (lowercase, hyphens)"), {
      target: { value: "Ship Day" },
    });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship Day" } });
    fireEvent.change(screen.getByLabelText("Emoji"), { target: { value: "🚢" } });
    fireEvent.click(add);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't add: invalid_theme");
    expect(useKudosSettingsStore.getState().customThemes).toEqual([]);

    fireEvent.change(screen.getByLabelText("Id (lowercase, hyphens)"), {
      target: { value: " ship-day " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Theme color hex" }), {
      target: { value: "#ff8800" },
    });
    fireEvent.click(add);
    expect(useKudosSettingsStore.getState().customThemes).toEqual([
      { id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#ff8800" },
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Id (lowercase, hyphens)")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Delete theme Ship Day" }));
    expect(useKudosSettingsStore.getState().customThemes).toEqual([]);
  });
});

describe("useKudosRoom", () => {
  const opts = {
    isHost: true,
    roomKey: null,
    persistence: "workspace" as const,
    role: "editor" as const,
  };

  it("writes to the workspace locally without broadcasting, and refuses a viewer", () => {
    const { result } = renderHook(() => useKudosRoom(opts));
    const k = kudo();
    act(() => result.current.sendKudos(k));
    expect(stored().map((x) => x.id)).toEqual([k.id]);
    expect(result.current.kudos.map((x) => x.id)).toEqual([k.id]);
    expect(h.room.broadcast).not.toHaveBeenCalled();
    expect(h.room.lastRoomId).toBeNull();

    const viewer = renderHook(() => useKudosRoom({ ...opts, role: "viewer" }));
    act(() => viewer.result.current.sendKudos(kudo()));
    expect(stored()).toHaveLength(1);
  });

  it("keeps a guest's kudos in memory, deduped by id and capped at 500", () => {
    const { result } = renderHook(() => useKudosRoom({ ...opts, persistence: "ephemeral" }));
    const k = kudo();
    act(() => {
      result.current.sendKudos(k);
      result.current.sendKudos({ ...k, message: "Edited" });
    });
    expect(result.current.kudos).toHaveLength(1);
    expect(result.current.kudos[0].message).toBe("Edited");
    expect(stored()).toEqual([]);

    act(() => {
      for (let i = 0; i < 501; i++) result.current.sendKudos(kudo());
    });
    expect(result.current.kudos).toHaveLength(500);
    expect(result.current.kudos.some((x) => x.id === k.id)).toBe(false);
  });

  it("broadcasts sends and applies valid kudos from other peers only", () => {
    Object.assign(h.room, { isLocalOnly: false, isConnected: true });
    const { result } = renderHook(() => useKudosRoom({ ...opts, roomKey: "key-1234567890abcd" }));
    expect(h.room.lastRoomId).toBe("workspace-key-1234567890abcd");
    const mine = kudo();
    act(() => result.current.sendKudos(mine));
    expect(h.room.broadcast).toHaveBeenCalledWith("kudos:created", { kudos: mine, by: "me" });

    const created = h.room.handlers.get("kudos:created")!;
    const fromPeer = kudo({ message: "From a peer" });
    act(() => {
      created({ kudos: kudo({ message: "My own echo" }), by: "me" });
      created({ kudos: { ...kudo(), theme: "nope" }, by: "peer" });
      created(null);
      created({ kudos: fromPeer, by: "peer" });
    });
    expect(stored().map((x) => x.message)).toEqual([mine.message, "From a peer"]);

    const snapshot = h.room.handlers.get("kudos:snapshot")!;
    const batch = Array.from({ length: 25 }, () => kudo());
    act(() => {
      snapshot({ kudos: "not a list", by: "peer" });
      snapshot({ kudos: batch, by: "peer" });
    });
    expect(stored()).toHaveLength(2 + 20);
    expect(stored().some((x) => x.id === batch[20].id)).toBe(false);
  });

  it("tells a guest when a kudos for them arrives", () => {
    Object.assign(h.room, { isLocalOnly: false, isConnected: true, userId: "p-guest" });
    renderHook(() =>
      useKudosRoom({
        ...opts,
        isHost: false,
        roomKey: "key-1234567890abcd",
        persistence: "ephemeral",
      })
    );
    const created = h.room.handlers.get("kudos:created")!;
    act(() => created({ kudos: kudo({ toProfileId: "p-guest", fromProfileId: "p-x" }), by: "x" }));
    expect(h.emit).toHaveBeenCalledWith("kudos", "received");
    h.emit.mockClear();
    act(() => created({ kudos: kudo({ toProfileId: "p-other" }), by: "x" }));
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("sends a snapshot heartbeat only to a room with peers, and only when something changed", () => {
    vi.useFakeTimers();
    Object.assign(h.room, { isLocalOnly: false, isConnected: true, members: [{ id: "me" }] });
    useWorkspaceStore.setState({ kudos: [] });
    const { rerender } = renderHook(() => useKudosRoom({ ...opts, roomKey: "key-1234567890abcd" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(h.room.broadcast).not.toHaveBeenCalled(); // empty wall

    act(() => useWorkspaceStore.getState().upsertKudos(kudo()));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(h.room.broadcast).not.toHaveBeenCalled(); // alone in the room

    h.room.members = [{ id: "me" }, { id: "peer" }];
    rerender();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(h.room.broadcast).toHaveBeenCalledTimes(1);
    expect(h.room.broadcast).toHaveBeenCalledWith("kudos:snapshot", {
      kudos: stored(),
      by: "me",
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(h.room.broadcast).toHaveBeenCalledTimes(1); // nothing new
  });
});

describe("useOwnerKudosRoomKey", () => {
  it("fetches the owner's room key and ignores a malformed one", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ roomKey: "abcdefghijklmnop1234" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ id }) => useOwnerKudosRoomKey(id), {
      initialProps: { id: "owner-1" as string | null },
    });
    await waitFor(() => expect(result.current).toBe("abcdefghijklmnop1234"));

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ roomKey: "bad key!" }) });
    rerender({ id: "owner-2" });
    await act(async () => {});
    expect(result.current).toBeNull();

    rerender({ id: null });
    expect(result.current).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Kudos page", () => {
  function ownerAuth() {
    h.auth.value = {
      status: "authenticated",
      user: { id: "owner-1", user_metadata: { full_name: "Olivia Full" } },
      profile: { display_name: "Olivia Owner" },
    };
  }

  function stubOwnerApi() {
    const fetchMock = vi.fn(async (url: string) => {
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.startsWith("/api/realtime/kudos-room"))
        return json({ roomKey: "abcdefghijklmnop1234" });
      if (url === "/api/squads") return json({ squads: [{ id: "s1" }, { id: "s2" }] });
      if (url === "/api/squads/s1/profiles")
        return json({
          profiles: [
            { id: "p1", displayName: "Ana Lima" },
            { id: "p2", displayName: "Ben Okafor" },
          ],
        });
      if (url === "/api/squads/s2/profiles")
        return json({ profiles: [{ id: "p1", displayName: "Ana Lima" }] });
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("lets a visitor sign and send a kudos kept in this browser", async () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "t1", name: "Sam" }] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<KudosClient />);
    expect(screen.getByText("Browser-only — saved on this device")).toBeInTheDocument();
    expect(screen.getByText(/Saved in this browser/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "Vic" } });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Thanks for the help" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send kudos/ }));

    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({
      toName: "Sam",
      fromName: "Vic",
      message: "Thanks for the help",
    });
    expect(h.log).toHaveBeenCalledWith(
      KUDOS_ACTIONS.KUDOS_SENT,
      expect.objectContaining({ kudosId: stored()[0].id, toName: "Sam", messageWords: 4 })
    );
    expect(h.emit).toHaveBeenCalledWith("kudos", "sent");
    expect(within(screen.getByRole("feed")).getByText("Thanks for the help")).toBeInTheDocument();
    // AI features are off: the message never left the device.
    expect(h.analyseSentiment).not.toHaveBeenCalled();
    expect(h.detectDuplicate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stamps sentiment and a duplicate group when those features are on", async () => {
    useKudosSettingsStore.setState({ aiSentiment: true, aiDedup: true });
    const prior = kudo({ toProfileId: undefined });
    useWorkspaceStore.setState({ teamMembers: [{ id: "t1", name: "Sam" }], kudos: [prior] });
    const sentiment = { label: "positive", confidence: 0.8, tone: ["warm"] };
    h.analyseSentiment.mockResolvedValue(sentiment);
    h.detectDuplicate.mockResolvedValue({ isDup: true, dupId: prior.id });
    render(<KudosClient />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "Vic" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Ok" } });
    fireEvent.click(screen.getByRole("button", { name: /Send kudos/ }));
    await waitFor(() => expect(stored()).toHaveLength(2));
    expect(stored()[1]).toMatchObject({ sentiment, llmDedupGroup: prior.id });
  });

  it("signs the owner's kudos, lists squad profiles once, and acts on a fairness hint", async () => {
    ownerAuth();
    useKudosSettingsStore.setState({ aiFairness: true });
    stubOwnerApi();
    h.computeFairness.mockResolvedValue({
      underRecognised: [
        { profileId: "p-ghost", score: 0.05, reason: "not in any squad" },
        { profileId: "p2", score: 0.2, reason: "no kudos in three weeks" },
      ],
    });
    render(<KudosClient />);

    expect(screen.getByLabelText("From")).toHaveValue("Olivia Owner");
    expect(screen.getByLabelText("From")).toHaveAttribute("readonly");
    expect(screen.getByText(/Live updates across all peers/)).toBeInTheDocument();
    await waitFor(() => expect(h.room.lastRoomId).toBe("workspace-abcdefghijklmnop1234"));
    expect(
      screen.getByText("Local-only — set Supabase env vars to share live")
    ).toBeInTheDocument();
    const options = () =>
      within(screen.getByLabelText("To"))
        .getAllByRole("option")
        .map((o) => o.textContent);
    await waitFor(() =>
      expect(options()).toEqual(["Pick a recipient…", "Ana Lima", "Ben Okafor", "— Type a name…"])
    );

    // The hint skips the profile nobody can pick and names Ben.
    const hint = await screen.findByRole("button", { name: "Send to Ben" });
    expect(screen.getByText("no kudos in three weeks")).toBeInTheDocument();
    fireEvent.click(hint);
    expect(screen.getByLabelText("To")).toHaveValue("squad:p2");
    expect(h.dispatch).toHaveBeenCalledWith({
      name: "tool:kudos:llm-suggested-pick",
      meta: { suggested: true, profileId: "p2" },
    });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Great on-call week" } });
    fireEvent.click(screen.getByRole("button", { name: /Send kudos/ }));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({
      toName: "Ben Okafor",
      toProfileId: "p2",
      fromName: "Olivia Owner",
      fairnessScoreAtSend: 0.2,
    });
  });

  it("names the downloaded PNG after the recipient", async () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "t1", name: "Zoë O'Brien" }] });
    vi.stubGlobal("fetch", vi.fn());
    render(<KudosClient />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: /Download PNG/ }));
    await waitFor(() => expect(h.exportPng).toHaveBeenCalledTimes(1));
    expect(h.exportPng.mock.calls[0][1]).toBe("kudos-to-zo-o-brien.png");
  });

  it("shows the ambient beacon only when it is switched on, and opens settings", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { unmount } = render(<KudosClient />);
    expect(screen.queryByRole("button", { name: /Kudos beacon/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open kudos settings" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Kudos settings");
    unmount();

    useKudosSettingsStore.setState({ beaconAmbient: true });
    render(<KudosClient />);
    expect(screen.getByRole("button", { name: /Kudos beacon/ })).toBeInTheDocument();
  });
});
