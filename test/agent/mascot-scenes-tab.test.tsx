/**
 * Amr's scenes (src/components/agent/mascot/scenes-tab.tsx): the gallery of every
 * story he can act out on request, and the header button that opens it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import companion from "../../docs/mascot/companion-scenes.json";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  /** Scenes the test pretends have no pack yet. */
  unshipped: new Set<string>(),
  /** His sheet fails to load once his figure mounts. */
  figureFails: false,
}));

vi.mock("@/components/agent/mascot/engine/sprite-poses", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/components/agent/mascot/engine/sprite-poses")>();
  return {
    ...real,
    shippedScene: (name: string) => (h.unshipped.has(name) ? undefined : real.shippedScene(name)),
  };
});
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: vi.fn(async () => {}),
  abortInFlight: vi.fn(),
}));
vi.mock("@/components/agent/mascot/mascot-sprite", async () => {
  const { useEffect } = await import("react");
  return {
    default: function Sprite({ onLoadError }: { onLoadError?: () => void }) {
      useEffect(() => {
        if (h.figureFails) onLoadError?.();
      }, [onLoadError]);
      return <div data-testid="mascot-sprite" />;
    },
  };
});
// The owner's chat, with the real confirmation card in it.
vi.mock("@/components/agent/agent-conversation", async () => {
  const { ConfirmCard } = await import("@/components/agent/chat/confirm-card");
  return {
    AgentConversation: () => (
      <div data-testid="agent-conversation">
        <ConfirmCard allowApproveAll />
      </div>
    ),
  };
});
vi.mock("@/components/agent/conversation-list", () => ({
  ConversationList: () => <div data-testid="conversation-list" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({
  RateLimitBar: () => <div data-testid="rate-limit-bar" />,
}));

import ScenesTab, { COMPANION_TITLES } from "@/components/agent/mascot/scenes-tab";
import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { PANEL_SUBTITLE } from "@/components/agent/mascot/panel-chrome";
import VisitorAgentPanel from "@/components/agent/mascot/visitor-agent-panel";
import { focusComposerAfterNewChat } from "@/components/agent/chat/chat-composer";
import { ChatVisibleContext } from "@/components/agent/chat-visibility";
import { EXPANSION_SHEETS } from "@/components/agent/mascot/engine/expansion-table";
import { EXPANSION_TITLES } from "@/components/agent/mascot/engine/expansion-titles";
import { SCENE_THUMBS, THUMB_INDEX } from "@/components/agent/mascot/engine/scene-thumbs";
import { COMPANION_SCENES, SCENES, galleryScene } from "@/components/agent/mascot/engine/scenes";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useAgentStore } from "@/lib/agent/store";
import type { PendingToolUse } from "@/lib/agent/types";

const FAMILY_HEADINGS: Array<[string, string]> = [
  ["reading", "Reading"],
  ["tools", "Tool lab"],
  ["team", "Team and decisions"],
  ["cast", "Cast encounters"],
  ["guides", "Guides"],
  ["play", "Play"],
];

/** The scene buttons in one family's list, by their labels. */
const labelsIn = (list: HTMLElement) =>
  within(list)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

const play = (title: string) => screen.getByRole("button", { name: `Play: ${title}` });

beforeEach(() => {
  h.unshipped = new Set();
  h.figureFails = false;
  useMascotStore.getState().reset();
});

/** The build's GALLERY_HOLDS (scripts/build-mascot-expansion.py): {pack: the beat its thumbnail shows}. */
function galleryHolds(): Record<string, number> {
  const src = readFileSync(
    path.join(process.cwd(), "scripts", "build-mascot-expansion.py"),
    "utf8"
  );
  const table = src.match(/^GALLERY_HOLDS: dict\[str, int\] = \{([^}]*)\}/m);
  expect(table, "GALLERY_HOLDS in the build").not.toBeNull();
  return Object.fromEntries(
    Array.from(table![1].matchAll(/"(\w+)":\s*(\d+)/g)).map((m) => [m[1], Number(m[2])])
  );
}

describe("the companion stories' titles", () => {
  it("are the ones docs/mascot/companion-scenes.json gives the stories /play takes", () => {
    const titles = Object.fromEntries(companion.sheets.map((s) => [s.pack, s.title]));
    expect(COMPANION_TITLES).toEqual(
      Object.fromEntries(COMPANION_SCENES.play.map((name) => [name, titles[name]]))
    );
  });
});

describe("the Scenes tab", () => {
  it("lists the companion stories, then each expansion family in turn", () => {
    render(<ScenesTab onPlay={() => {}} />);
    expect(screen.getAllByRole("heading").map((el) => el.textContent)).toEqual([
      "Companion stories",
      ...FAMILY_HEADINGS.map(([, title]) => title),
    ]);
    expect(labelsIn(screen.getByRole("list", { name: "Companion stories" }))).toEqual(
      COMPANION_SCENES.play.map((name) => `Play: ${COMPANION_TITLES[name]}`)
    );
    for (const [family, title] of FAMILY_HEADINGS) {
      expect(labelsIn(screen.getByRole("list", { name: title })), family).toEqual(
        EXPANSION_SHEETS.filter((s) => s.family === family).map(
          (s) => `Play: ${EXPANSION_TITLES[s.pack]}`
        )
      );
    }
    expect(screen.getByRole("status")).toHaveTextContent(
      `${COMPANION_SCENES.play.length + EXPANSION_SHEETS.length} scenes.`
    );
  });

  it("leaves out a scene whose pack doesn't ship, and a family with none", () => {
    h.unshipped = new Set([
      "x002",
      "rabbit",
      ...EXPANSION_SHEETS.filter((s) => s.family === "guides").map((s) => galleryScene(s.pack)),
    ]);
    render(<ScenesTab onPlay={() => {}} />);
    expect(screen.queryByRole("button", { name: `Play: ${EXPANSION_TITLES.x002}` })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play: Deadline Rabbit Rush" })).toBeNull();
    expect(play(EXPANSION_TITLES.x001)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Guides" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Guides" })).toBeNull();
  });

  it("asks X112's pack for the filter variant it plays", () => {
    h.unshipped = new Set(["x112.filter"]);
    render(<ScenesTab onPlay={() => {}} />);
    expect(screen.queryByRole("button", { name: `Play: ${EXPANSION_TITLES.x112}` })).toBeNull();
  });

  it("narrows to the titles that match, and says how many", () => {
    render(<ScenesTab onPlay={() => {}} />);
    const filter = screen.getByLabelText("Find a scene");

    fireEvent.change(filter, { target: { value: "KEYSTONE" } });
    expect(screen.getAllByRole("button", { name: /^Play: / })).toHaveLength(1);
    expect(play(EXPANSION_TITLES.x120)).toBeInTheDocument();
    expect(screen.getAllByRole("heading").map((el) => el.textContent)).toEqual(["Play"]);
    expect(screen.getByRole("status")).toHaveTextContent("1 scene matches “KEYSTONE”.");

    // A straight apostrophe finds a curly one.
    fireEvent.change(filter, { target: { value: "model's limits" } });
    expect(play(EXPANSION_TITLES.x053)).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "story" } });
    const matching = [
      ...COMPANION_SCENES.play.map((n) => COMPANION_TITLES[n]),
      ...Object.values(EXPANSION_TITLES),
    ].filter((t) => t.toLowerCase().includes("story"));
    expect(matching.length).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: /^Play: / })).toHaveLength(matching.length);
    expect(screen.getByRole("status")).toHaveTextContent(
      `${matching.length} scenes match “story”.`
    );

    fireEvent.change(filter, { target: { value: "zzqx" } });
    expect(screen.queryAllByRole("button", { name: /^Play: / })).toEqual([]);
    expect(screen.queryAllByRole("list")).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("No scenes match “zzqx”.");
  });

  it("plays the scene tapped, then closes the panel so he's in view", () => {
    const onPlay = vi.fn();
    render(<ScenesTab onPlay={onPlay} />);

    fireEvent.click(play(EXPANSION_TITLES.x001));
    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:x001"]);
    expect(onPlay).toHaveBeenCalledTimes(1);

    // X112 plays its explanatory filter moment, not the reset after it.
    fireEvent.click(play(EXPANSION_TITLES.x112));
    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:x112.filter"]);

    fireEvent.click(play("AI Reviewer"));
    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:reviewer"]);
    expect(onPlay).toHaveBeenCalledTimes(3);
  });

  it("shows each scene's picture from the one atlas, scaled to fit", () => {
    render(<ScenesTab onPlay={() => {}} />);
    const thumb = (title: string) => play(title).querySelector<HTMLElement>("[data-amr-thumb]")!;
    const x025 = thumb(EXPANSION_TITLES.x025);
    expect(x025).toHaveAttribute("aria-hidden", "true");
    expect(x025.style.backgroundImage).toContain(SCENE_THUMBS.src);
    expect(x025.style.width).toBe("54px");
    expect(x025.style.height).toBe("63px");
    expect(x025.style.backgroundSize).toBe(
      `${SCENE_THUMBS.columns * 54}px ${SCENE_THUMBS.rows * 63}px`
    );
    const cell = THUMB_INDEX.x025;
    const col = cell % SCENE_THUMBS.columns;
    const row = Math.floor(cell / SCENE_THUMBS.columns);
    expect(x025.style.backgroundPosition).toBe(`-${col * 54}px -${row * 63}px`);
    expect(thumb("AI Reviewer").style.backgroundImage).toContain(SCENE_THUMBS.src);
  });

  it("pictures each expansion scene by the pose a tap leaves him in", () => {
    const holds = galleryHolds();
    // The build draws a variant's held beat for exactly the packs played as a variant…
    expect(Object.keys(holds).sort()).toEqual(
      EXPANSION_SHEETS.filter((s) => galleryScene(s.pack) !== s.pack)
        .map((s) => s.pack)
        .sort()
    );
    // …so every thumbnail is the still of the scene the tab plays (X112: its fifth beat).
    for (const s of EXPANSION_SHEETS) {
      const beat = holds[s.pack] ?? s.last ?? 8;
      expect(`${s.pack}.${beat}`, s.pack).toBe(SCENES[galleryScene(s.pack)].still);
    }
    expect(holds.x112).toBe(5);
  });

  it("empties the filter on Escape before Escape may close the panel", () => {
    const onDocEsc = vi.fn();
    document.addEventListener("keydown", onDocEsc);
    try {
      render(<ScenesTab onPlay={() => {}} />);
      const filter = screen.getByLabelText("Find a scene");
      fireEvent.change(filter, { target: { value: "story" } });

      fireEvent.keyDown(filter, { key: "Escape" });
      expect(filter).toHaveValue("");
      expect(onDocEsc).not.toHaveBeenCalled();

      fireEvent.keyDown(filter, { key: "Escape" });
      expect(onDocEsc).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onDocEsc);
    }
  });

  it("gives every scene a touch-sized button with a visible focus ring", () => {
    render(<ScenesTab onPlay={() => {}} />);
    for (const button of screen.getAllByRole("button", { name: /^Play: / })) {
      expect(button).toHaveClass("min-touch-coarse", "focus-visible:ring-2");
    }
  });

  it("moves through the list with the arrow keys, from the field and back to it", () => {
    render(<ScenesTab onPlay={() => {}} />);
    const filter = screen.getByLabelText("Find a scene");
    const buttons = screen.getAllByRole("button", { name: /^Play: / });

    filter.focus();
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1], { key: "End" });
    expect(buttons.at(-1)).toHaveFocus();
    fireEvent.keyDown(buttons.at(-1)!, { key: "Home" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
    expect(filter).toHaveFocus();
  });
});

function stubDesktop() {
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
}

describe("the Scenes button in Amr's panel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    stubDesktop();
    useAgentStore.getState().reset();
    useAgentStore.setState({ open: true, chatProfile: "owner", visitorQuota: null });
  });

  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.setState({ open: false, chatProfile: "owner", visitorQuota: null });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const scenesButton = () => screen.getByRole("button", { name: "Amr's scenes" });

  const confirmation = (resolve: (approved: boolean) => void): PendingToolUse => ({
    toolUseId: "c1",
    actionId: "workspace_sprint_create",
    resolvedActionId: "workspace.sprint.create",
    input: {},
    prompt: {
      verb: "Create sprint",
      title: "Workspace",
      question: "Create Sprint 47?",
      detail: "",
      destructive: false,
    },
    resolve,
  });

  it("goes back to the chat, not closing the panel, when a scene is tapped mid-turn", async () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    render(<MascotAssistant />);
    await screen.findByTestId("agent-conversation");
    act(() => useAgentStore.setState({ streaming: true }));

    fireEvent.click(scenesButton());
    await screen.findByTestId("mascot-scenes");
    fireEvent.click(play(EXPANSION_TITLES.x001));

    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:x001"]);
    // Closing the panel would stop the turn: it stays open, on the chat.
    expect(useAgentStore.getState().open).toBe(true);
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(screen.getByTestId("agent-conversation")).toBeVisible();
    expect(scenesButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("gives way to a confirmation, never leaving it hidden to be denied by Escape", async () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    render(<MascotAssistant />);
    await screen.findByTestId("agent-conversation");
    fireEvent.click(scenesButton());
    await screen.findByTestId("mascot-scenes");

    const resolve = vi.fn();
    act(() => useAgentStore.getState().setPendingToolUse(confirmation(resolve)));
    // The card shows in the chat, and the scenes can't cover it while it waits.
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(screen.getByText("Create Sprint 47?")).toBeVisible();
    expect(scenesButton()).toBeDisabled();
    fireEvent.click(scenesButton());
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(resolve).not.toHaveBeenCalled();

    // Answered, the panel stays on the chat; the scenes open again on request.
    fireEvent.click(screen.getByRole("button", { name: "Create sprint" }));
    expect(resolve).toHaveBeenCalledWith(true);
    act(() => useAgentStore.setState({ pendingToolUse: null }));
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(scenesButton()).toBeEnabled();
    fireEvent.click(scenesButton());
    expect(await screen.findByTestId("mascot-scenes")).toBeInTheDocument();
  });

  it("isn't offered once his figure fails to load: no one could act a scene out", async () => {
    h.auth = { status: "anonymous", user: null };
    h.figureFails = true;
    render(<MascotAssistant />);
    fireEvent.click(scenesButton());
    await screen.findByTestId("mascot-scenes");

    // A first key press starts loading his figure, which fails.
    fireEvent.keyDown(window, { key: "Shift" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Amr's scenes" })).toBeNull());
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(screen.getByTestId("mascot-visitor-guide")).toBeVisible();
  });

  it("stays away while his failed figure is tried again, and comes back once he is drawn", async () => {
    h.auth = { status: "anonymous", user: null };
    h.figureFails = true;
    render(<MascotAssistant />);
    await screen.findByTestId("mascot-visitor-guide");
    fireEvent.keyDown(window, { key: "Shift" });
    // It failed: the plate stands in, and a try of its own is to come.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Amr's scenes" })).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("mascot-sprite")).toBeNull());

    // The try mounts his figure again; until it is drawn the button stays away.
    h.figureFails = false;
    await waitFor(() => expect(screen.getByTestId("mascot-sprite")).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(screen.queryByRole("button", { name: "Amr's scenes" })).toBeNull();

    act(() => useMascotStore.setState({ ready: true }));
    expect(scenesButton()).toBeEnabled();
  });

  it("keeps the header to one line on a narrow phone", async () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    render(<MascotAssistant />);
    await screen.findByTestId("agent-conversation");
    // The owner's step fills the header's one subtitle line, which truncates.
    const subtitle = screen.getByText(PANEL_SUBTITLE.owner).closest("p");
    expect(subtitle).toHaveClass("truncate");
    expect(subtitle!.parentElement).toHaveClass("min-w-0");
    expect(scenesButton().parentElement).toHaveClass("shrink-0");
  });

  it("opens the scenes for the owner in place of the chat, and gives way to History", async () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    render(<MascotAssistant />);
    expect(await screen.findByTestId("agent-conversation")).toBeInTheDocument();
    expect(scenesButton()).toHaveAttribute("title", "Scenes");
    expect(scenesButton()).toHaveAttribute("aria-pressed", "false");
    // A header icon: 44 px on a touch screen.
    expect(scenesButton()).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");

    fireEvent.click(scenesButton());
    expect(await screen.findByTestId("mascot-scenes")).toBeInTheDocument();
    expect(scenesButton()).toHaveAttribute("aria-pressed", "true");
    // The chat stays mounted underneath, hidden, so a turn in flight goes on.
    expect(screen.getByTestId("agent-conversation")).not.toBeVisible();

    const history = screen.getByRole("button", { name: "Conversation history" });
    fireEvent.click(history);
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(scenesButton()).toHaveAttribute("aria-pressed", "false");
    // In History its one button leads back to the chat.
    expect(history).toHaveAccessibleName("Back to chat");
    expect(screen.getByTestId("conversation-list")).toBeVisible();

    fireEvent.click(scenesButton());
    expect(await screen.findByTestId("mascot-scenes")).toBeInTheDocument();
    expect(history).toHaveAccessibleName("Conversation history");
  });

  it("gives way to New chat, in the header's actions from the owner's chunk", async () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    render(<MascotAssistant />);
    await screen.findByTestId("agent-conversation");
    fireEvent.click(scenesButton());
    expect(await screen.findByTestId("mascot-scenes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(scenesButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("agent-conversation")).toBeVisible();
  });

  it("opens them for a visitor too, and toggles back to the guide", async () => {
    h.auth = { status: "anonymous", user: null };
    render(<MascotAssistant />);
    const guide = screen.getByTestId("mascot-visitor-guide");

    fireEvent.click(scenesButton());
    expect(await screen.findByTestId("mascot-scenes")).toBeInTheDocument();
    expect(guide).not.toBeVisible();

    fireEvent.click(scenesButton());
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(guide).toBeVisible();
  });

  it("shows for a visitor with Amr's AI, plays the scene tapped and closes the panel", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    h.auth = { status: "anonymous", user: null };
    const { rerender } = render(<MascotAssistant />);
    expect(screen.getByRole("button", { name: "Chat with Amr" })).toBeInTheDocument();

    fireEvent.click(scenesButton());
    await screen.findByTestId("mascot-scenes");
    fireEvent.click(play(EXPANSION_TITLES.x112));
    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:x112.filter"]);
    expect(useAgentStore.getState().open).toBe(false);

    // Opened again, the panel starts on the guide, not on the scenes.
    useAgentStore.setState({ open: true });
    rerender(<MascotAssistant />);
    expect(screen.getByTestId("mascot-visitor-guide")).toBeVisible();
    expect(screen.queryByTestId("mascot-scenes")).toBeNull();
    expect(scenesButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("closes the panel its one way for a scene tapped, so focus comes back to Amr", async () => {
    h.auth = { status: "anonymous", user: null };
    render(<MascotAssistant />);
    fireEvent.click(scenesButton());
    await screen.findByTestId("mascot-scenes");
    const scene = play(EXPANSION_TITLES.x112);
    scene.focus();
    fireEvent.click(scene);
    expect(useAgentStore.getState().open).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    // No opener held focus when the panel opened: his own button takes it.
    expect(document.querySelector("[data-amr-button]")).toHaveFocus();
  });
});

describe("a chat hidden under the scenes", () => {
  const scrollTo = vi.fn();
  const scrollIntoView = vi.fn();
  const original = {
    scrollTo: Element.prototype.scrollTo,
    scrollIntoView: Element.prototype.scrollIntoView,
  };

  beforeEach(() => {
    Element.prototype.scrollTo = scrollTo;
    Element.prototype.scrollIntoView = scrollIntoView;
    scrollTo.mockClear();
    scrollIntoView.mockClear();
    // The composer reads a media query (its narrow width), and the describe
    // above unstubs every global, test/setup's matchMedia among them.
    stubDesktop();
    useAgentStore.getState().reset();
  });

  afterEach(() => {
    Element.prototype.scrollTo = original.scrollTo;
    Element.prototype.scrollIntoView = original.scrollIntoView;
    vi.unstubAllGlobals();
    useAgentStore.getState().reset();
  });

  const panel = (visible: boolean) => (
    <ChatVisibleContext.Provider value={visible}>
      <VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />
    </ChatVisibleContext.Provider>
  );

  it("focuses the message box and scrolls to the latest message once it shows again", async () => {
    const { rerender } = render(panel(false));
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(box).not.toHaveFocus();
    // jsdom has no layout: the log holds 1000 px in a 200 px view, so a pin
    // to its end has somewhere to go.
    const log = screen.getByRole("log", { name: "Conversation" });
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 200 });

    act(() =>
      useAgentStore.getState().appendMessage({
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "Here's a retro idea." }],
        createdAt: "2026-11-16T08:00:00Z",
      })
    );
    // The frame the log's writes wait for has run, and wrote nothing.
    await act(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(panel(true));
    expect(box).toHaveFocus();
    // The chat frame follows the log from its newest line again, with the
    // log's own scrollTo, never scrollIntoView.
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "instant" }));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("puts focus in the box after a New chat from under the scenes once it shows, on a touch screen too", () => {
    // A touch screen: nothing but New chat puts focus in the box.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { rerender } = render(panel(true));
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(box).not.toHaveFocus();

    rerender(panel(false));
    act(() => focusComposerAfterNewChat());
    // Hidden, the box can't take it: the request waits for it to show.
    expect(box).not.toHaveFocus();
    rerender(panel(true));
    expect(box).toHaveFocus();
  });
});
