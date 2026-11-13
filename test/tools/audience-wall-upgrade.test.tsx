import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { NOW, fakeVoteCrypto, type FakeVoteCrypto } from "../realtime/vote-room-fixtures";

/**
 * Audience Wall: five kinds of wall run live through the wall-room kit (the
 * word cloud, duplicate questions merged after a preview, the next speaker,
 * Yes, and…, 25/10 scoring and its top ten), saved anonymously in the
 * tool's store or typed in by hand; per saved wall a list, a word cloud or
 * the top ten, themes and duplicates and backlog items drafted (by Amr, or
 * by the word rules here) and added only when the host accepts each, with
 * Undo; the example, the export and the history.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() })
);
const exported = vi.hoisted(() => ({ byFile: {} as Record<string, string | undefined> }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const cheers = vi.hoisted(() => ({ cheer: vi.fn() }));
const rt = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ filename, markdown }: { filename: string; markdown?: string }) => {
    exported.byFile[filename] = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: cheers.cheer }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => rt.on, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));

import { AudienceWallClient } from "@/app/(tools)/audience-wall/audience-wall-client";
import { LiveWall } from "@/app/(tools)/audience-wall/live-wall";
import { buildExample } from "@/app/(tools)/audience-wall/example";
import { toMarkdown } from "@/app/(tools)/audience-wall/markdown";
import { WALL_KIND_SETUP } from "@/app/(tools)/audience-wall/kinds";
import { saveWallRound } from "@/app/(tools)/audience-wall/save";
import { isExampleId } from "@/lib/utils/example-id";
import { useAudienceWallStore } from "@/lib/audience-wall/store";
import { liveWall } from "@/lib/audience-wall/live";
import { WALL_KINDS, type WallSession } from "@/lib/audience-wall/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

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

const walls = () => useAudienceWallStore.getState().sessions;
const undoOf = (label: string | RegExp) => {
  const call = [...toastSpy.mock.calls]
    .reverse()
    .find((c) => (typeof label === "string" ? c[0] === label : label.test(String(c[0]))));
  expect(call, `toast ${String(label)}`).toBeTruthy();
  return () => act(() => call![1].action.onClick());
};
const logged = (action: string) =>
  history.log.mock.calls.filter((c) => c[0] === action).map((c) => c[1]);

const OWN: WallSession = {
  id: "wall_own",
  kind: "questions",
  prompt: "What should we ask the CTO?",
  savedAt: "2026-11-11T10:00:00.000Z",
  source: "room",
  posts: [
    { id: "p1", text: "When is the next release?", votes: 4, merged: [] },
    { id: "p2", text: "When do we release next?", votes: 1, merged: [] },
    { id: "p3", text: "Who owns onboarding?", votes: 6, merged: [], answered: true },
  ],
  themes: [],
  sent: [],
};

beforeEach(() => {
  toastSpy.mockReset();
  history.log.mockReset();
  cheers.cheer.mockReset();
  exported.byFile = {};
  localStorage.clear();
  sessionStorage.clear();
  useAudienceWallStore.setState({ sessions: [] });
  useWorkspaceStore.setState({ stories: [] });
  rt.on = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function mount() {
  const view = wrap(<AudienceWallClient />);
  await flush();
  return view;
}

/** A saved wall's card, by its prompt. */
const card = (prompt: string) =>
  screen.getByRole("heading", { name: prompt }).closest("article") as HTMLElement;

async function openCard(prompt: string) {
  await act(async () => {
    fireEvent.click(within(card(prompt)).getByRole("button", { name: /^Open/ }));
  });
  return card(prompt);
}

// ─────────────────────────────────────────────────────────────
describe("the page", () => {
  it("starts empty, loads the example, and clears only the example", async () => {
    useAudienceWallStore.setState({ sessions: [] });
    await mount();
    expect(screen.getByText(/No saved walls yet/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    });
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(walls()).toHaveLength(3);
    act(() => useAudienceWallStore.setState({ sessions: [...walls(), OWN] }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    });
    expect(walls().map((s) => s.id)).toEqual(["wall_own"]);
    expect(screen.queryByText("Example data.")).toBeNull();
  });

  it("offers no wall typed in by hand for a raise-hand queue", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Add a wall by hand" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /^Raised hands/ }));
    });
    expect(screen.queryByRole("button", { name: "Add a wall by hand" })).toBeNull();
  });

  it("offers the five kinds of wall, each with what it does", async () => {
    await mount();
    const kinds = screen.getByRole("group", { name: "Kind of wall" });
    for (const label of ["Open answers", "Questions", "Raised hands", "Brainwriting", "25/10"]) {
      expect(
        within(kinds).getByRole("radio", { name: new RegExp(`^${label}`) })
      ).toBeInTheDocument();
    }
    expect(within(kinds).getByRole("radio", { name: /^Open answers/ })).toBeChecked();
    expect(within(kinds).getByText(/scores five others from 1 to 5/)).toBeInTheDocument();
    expect(WALL_KINDS).toHaveLength(5);
  });

  it("checks a wall typed in by hand, then saves it anonymously and logs it", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add a wall by hand" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as open answers" }));
    });
    expect(screen.getByText("Write the question you asked.")).toBeInTheDocument();
    expect(screen.getByText("Add at least one answer, one per line.")).toBeInTheDocument();
    expect(walls()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/^Question(?!s)/), {
      target: { value: "What would make retros a ten?" },
    });
    fireEvent.change(screen.getByLabelText(/^Answers/), {
      target: { value: "Owners for actions\n\nStart on time" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as open answers" }));
    });
    expect(walls()).toHaveLength(1);
    expect(walls()[0]).toMatchObject({ kind: "answers", source: "manual" });
    expect(walls()[0].posts.map((p) => p.text)).toEqual(["Owners for actions", "Start on time"]);
    expect(card("What would make retros a ten?")).toHaveTextContent("typed in");
    expect(logged("wall_saved")).toEqual([{ kind: "answers", mode: "manual", posts: 2 }]);
  });

  it("exports every saved wall as Markdown", async () => {
    useAudienceWallStore.setState({ sessions: [OWN] });
    await mount();
    expect(exported.byFile["audience-wall"]).toBe(toMarkdown([OWN]));
    expect(exported.byFile["audience-wall"]).toContain("## What should we ask the CTO?");
    expect(exported.byFile["audience-wall-2026-11-11"]).toContain("# Audience Wall");
  });
});

describe("a saved wall", () => {
  it("lists questions best first, answered ones last", async () => {
    useAudienceWallStore.setState({ sessions: [OWN] });
    await mount();
    const c = await openCard(OWN.prompt);
    const items = within(c)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(items[0]).toContain("When is the next release?");
    expect(items[items.length - 1]).toContain("Who owns onboarding?");
    expect(within(c).getByText("Answered")).toBeInTheDocument();
  });

  it("shows a word cloud, and a 25/10 wall's top ten by average", async () => {
    useAudienceWallStore.setState({ sessions: buildExample(new Date(NOW)) });
    await mount();
    let c = await openCard("What would make our retros a ten?");
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Word cloud" }));
    });
    const cloud = within(c).getByRole("list", { name: /Word cloud of/ });
    expect(within(cloud).getByText("actions")).toBeInTheDocument();
    c = await openCard("What's the boldest thing we could do this quarter?");
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Top ten" }));
    });
    const top = within(c).getByRole("list", { name: "Top ten" });
    const rows = within(top).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Ship to production every day");
    expect(rows[0]).toHaveTextContent("4.4 average, 5 scores");
  });

  it("moves focus to the next wall after a delete", async () => {
    const second: WallSession = { ...OWN, id: "wall_two", prompt: "What slows us down?" };
    useAudienceWallStore.setState({ sessions: [OWN, second] });
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Delete the wall “What should we ask/ }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(
      within(card("What slows us down?")).getByRole("button", { name: /^Open/ })
    );
  });

  it("deletes a wall with Undo", async () => {
    useAudienceWallStore.setState({ sessions: [OWN] });
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Delete the wall/ }));
    });
    expect(walls()).toEqual([]);
    expect(logged("wall_removed")).toEqual([{ kind: "questions", posts: 3 }]);
    undoOf(/^Deleted the wall/)();
    expect(walls().map((s) => s.id)).toEqual(["wall_own"]);
  });

  it("drafts themes from shared words and adds each only when accepted, with Undo", async () => {
    const wall: WallSession = {
      ...OWN,
      id: "wall_themes",
      kind: "answers",
      prompt: "What slows us down?",
      posts: [
        { id: "p1", text: "Code reviews take days", votes: 2, merged: [] },
        { id: "p2", text: "Waiting on reviews", votes: 1, merged: [] },
        { id: "p3", text: "Flaky tests on CI", votes: 3, merged: [] },
        { id: "p4", text: "The tests are flaky", votes: 0, merged: [] },
        { id: "p5", text: "Too many meetings", votes: 0, merged: [] },
      ],
    };
    useAudienceWallStore.setState({ sessions: [wall] });
    await mount();
    const c = await openCard("What slows us down?");
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Group by shared words" }));
    });
    const draft = within(c).getByRole("heading", { name: "Themes to add" }).closest("section")!;
    expect(walls()[0].themes).toEqual([]);
    expect(draft).toHaveTextContent("Suggested without AI");
    const add = within(draft as HTMLElement).getAllByRole("button", { name: /^Add/ })[0];
    await act(async () => {
      fireEvent.click(add);
    });
    expect(walls()[0].themes).toHaveLength(1);
    expect(logged("themes_accepted")).toEqual([{ themes: 1 }]);
    undoOf(/^Added the theme/)();
    expect(walls()[0].themes).toEqual([]);
  });

  it("undoes the theme it added only, even when an older theme has the same name", async () => {
    const wall: WallSession = {
      ...OWN,
      id: "wall_names",
      kind: "answers",
      prompt: "What slows us down?",
      posts: [
        { id: "p1", text: "Code reviews take days", votes: 2, merged: [] },
        { id: "p2", text: "Waiting on reviews", votes: 1, merged: [] },
        { id: "p3", text: "Flaky tests on CI", votes: 3, merged: [] },
        { id: "p4", text: "The tests are flaky", votes: 0, merged: [] },
      ],
      themes: [{ name: "reviews", postIds: ["p3"] }],
    };
    useAudienceWallStore.setState({ sessions: [wall] });
    await mount();
    const c = await openCard("What slows us down?");
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Group by shared words" }));
    });
    const draft = within(c).getByRole("heading", { name: "Themes to add" }).closest("section")!;
    await act(async () => {
      fireEvent.click(within(draft as HTMLElement).getAllByRole("button", { name: /^Add/ })[0]);
    });
    expect(walls()[0].themes).toHaveLength(2);
    undoOf(/^Added the theme/)();
    expect(walls()[0].themes).toEqual([{ name: "reviews", postIds: ["p3"] }]);
  });

  it("clears a wall's themes with Undo", async () => {
    useAudienceWallStore.setState({ sessions: buildExample(new Date(NOW)) });
    await mount();
    const c = await openCard("What would make our retros a ten?");
    expect(within(c).getByText("Follow through on actions")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Clear themes" }));
    });
    const after = () => walls().find((s) => s.prompt === "What would make our retros a ten?")!;
    expect(after().themes).toEqual([]);
    undoOf("Cleared the themes")();
    expect(after().themes.map((t) => t.name)).toEqual([
      "Follow through on actions",
      "Keep the format fresh",
    ]);
  });

  it("merges duplicate questions only on Merge, with Undo", async () => {
    useAudienceWallStore.setState({ sessions: [OWN] });
    await mount();
    const c = await openCard(OWN.prompt);
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Find duplicates without AI" }));
    });
    const draft = within(c)
      .getByRole("heading", { name: "Duplicates to merge" })
      .closest("section")!;
    expect(draft).toHaveTextContent("Keep: When is the next release?");
    expect(walls()[0].posts).toHaveLength(3);
    await act(async () => {
      fireEvent.click(within(draft as HTMLElement).getByRole("button", { name: /^Merge/ }));
    });
    expect(walls()[0].posts.map((p) => p.text)).toEqual([
      "When is the next release?",
      "Who owns onboarding?",
    ]);
    expect(walls()[0].posts[0]).toMatchObject({ votes: 5, merged: ["When do we release next?"] });
    // Something else happens to the wall after the merge: Undo keeps it.
    act(() =>
      useAudienceWallStore.setState({
        sessions: [{ ...walls()[0], themes: [{ id: "t_later", name: "Later", postIds: ["p3"] }] }],
      })
    );
    undoOf(/^Merged 1 post/)();
    expect(walls()[0].posts).toHaveLength(3);
    expect(walls()[0].posts[0]).toMatchObject({ votes: 4, merged: [] });
    expect(walls()[0].themes).toEqual([{ id: "t_later", name: "Later", postIds: ["p3"] }]);
  });

  it("sends two items in another script as two stories, both listed", async () => {
    const arabic: WallSession = {
      ...OWN,
      id: "wall_ar",
      kind: "answers",
      prompt: "ما الذي يجب أن نحسنه؟",
      posts: [
        { id: "p1", text: "تسهيل العثور على كود الخصم", votes: 3, merged: [] },
        { id: "p2", text: "توضيح رسائل خطأ البطاقة", votes: 2, merged: [] },
      ],
    };
    useAudienceWallStore.setState({ sessions: [arabic] });
    await mount();
    const c = await openCard("ما الذي يجب أن نحسنه؟");
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Draft items without AI" }));
    });
    const draft = () =>
      within(c).getByRole("heading", { name: "Backlog items to add" }).closest("section")!;
    await act(async () => {
      fireEvent.click(
        within(draft() as HTMLElement).getAllByRole("button", { name: /^Add to backlog/ })[0]
      );
    });
    await act(async () => {
      fireEvent.click(
        within(draft() as HTMLElement).getAllByRole("button", { name: /^Add to backlog/ })[0]
      );
    });
    const stories = useWorkspaceStore.getState().stories;
    expect(stories.map((st) => st.title)).toEqual([
      "تسهيل العثور على كود الخصم",
      "توضيح رسائل خطأ البطاقة",
    ]);
    expect(walls()[0].sent).toHaveLength(2);
    expect(within(c).getAllByRole("link", { name: /^On the backlog/ })).toHaveLength(2);
  });

  it("sends feedback to the backlog through the hand-off, never from the example", async () => {
    useAudienceWallStore.setState({ sessions: [OWN, ...buildExample(new Date(NOW))] });
    await mount();
    const ex = await openCard("What do you want to ask about the new release train?");
    expect(
      within(ex).getByText(/example's feedback doesn't go to your backlog/)
    ).toBeInTheDocument();
    expect(within(ex).queryByRole("button", { name: /Draft items/ })).toBeNull();

    const c = await openCard(OWN.prompt);
    await act(async () => {
      fireEvent.click(within(c).getByRole("button", { name: "Draft items without AI" }));
    });
    const draft = within(c)
      .getByRole("heading", { name: "Backlog items to add" })
      .closest("section")!;
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    await act(async () => {
      fireEvent.click(
        within(draft as HTMLElement).getAllByRole("button", { name: /^Add to backlog/ })[0]
      );
    });
    const [story] = useWorkspaceStore.getState().stories;
    expect(story).toMatchObject({
      title: "Who owns onboarding",
      status: "backlog",
      sourceRef: { tool: "audience-wall", id: "wall_own" },
    });
    expect(walls().find((s) => s.id === "wall_own")!.sent[0].sentTo[0].targetId).toBe(story.id);
    expect(
      within(c).getByRole("link", { name: /On the backlog: “Who owns onboarding”/ })
    ).toBeInTheDocument();
    expect(logged("items_sent")).toEqual([{ count: 1 }]);
    // The hand-off's own Undo takes the story and the link back.
    undoOf("Added to the backlog")();
    expect(useWorkspaceStore.getState().stories).toEqual([]);
  });
});

describe("saving a live round and the kinds' setup", () => {
  const RESULT = {
    roundId: "round_000001",
    tool: "audience-wall" as const,
    prompt: "Ideas for onboarding",
    closedAt: "2026-11-12T10:00:00.000Z",
    mode: "live" as const,
    posts: [
      { text: "A buddy for each joiner", votes: 2, merged: [] },
      { text: "and a first-week checklist", votes: 1, merged: [], re: 0 },
    ],
  };

  it("saves the round as a wall of the room's kind, logs counts only, cheers, and undoes", () => {
    const undo = saveWallRound(RESULT, "brainwriting", { log: history.log });
    expect(typeof undo).toBe("function");
    expect(walls()).toHaveLength(1);
    expect(walls()[0]).toMatchObject({ kind: "brainwriting", prompt: "Ideas for onboarding" });
    expect(walls()[0].posts[1].re).toBe(walls()[0].posts[0].id);
    expect(logged("wall_saved")).toEqual([{ kind: "brainwriting", mode: "live", posts: 2 }]);
    expect(JSON.stringify(history.log.mock.calls)).not.toContain("buddy");
    expect(cheers.cheer).toHaveBeenCalledWith("audience-wall", "result");
    (undo as () => void)();
    expect(walls()).toEqual([]);
    expect(saveWallRound({ ...RESULT, posts: [] }, "answers", { log: history.log })).toBe(false);
  });

  it("nests a saved Yes, and… under the post it builds on", async () => {
    saveWallRound(RESULT, "brainwriting", { log: history.log });
    await mount();
    const c = await openCard("Ideas for onboarding");
    const parent = within(c).getByText("A buddy for each joiner").closest("li")!;
    expect(within(parent as HTMLElement).getByText("Yes, and…")).toBeInTheDocument();
    expect(
      within(parent as HTMLElement).getByText("and a first-week checklist")
    ).toBeInTheDocument();
  });

  it("sets each kind up as it runs: questions live and answerable, brainwriting building, 25/10 hidden", () => {
    expect(WALL_KIND_SETUP.questions).toMatchObject({ mode: "live", answerable: true });
    expect(WALL_KIND_SETUP.brainwriting.roundOptions).toEqual({ build: true });
    expect(WALL_KIND_SETUP.hands.roundOptions).toEqual({ takePosts: false });
    expect(WALL_KIND_SETUP.crowd.mode).toBe("hidden");
    expect(WALL_KIND_SETUP.answers.starters).toContain(
      "What would make this session a ten for you?"
    );
    for (const k of WALL_KINDS) {
      expect(WALL_KIND_SETUP[k].starters, k).toContain(WALL_KIND_SETUP[k].prompt);
    }
  });

  it("marks every example wall as example data", () => {
    const ex = buildExample(new Date(NOW));
    expect(ex.map((s) => s.kind).sort()).toEqual(["answers", "crowd", "questions"]);
    expect(ex.every((s) => isExampleId(s.id))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// The live room, through the kit, on a fake channel and a fake VoteCrypto.

const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };

type State = WallStateBody & { sig: string };
const states = (ch: FakeChannel) => ch.sent(WALL_ROOM_EVENTS.state) as State[];

async function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

let iidN = 0;
async function send(ch: FakeChannel, crypto: FakeVoteCrypto, by: string, intent: WallIntent) {
  const s = states(ch).at(-1)!;
  const iid = `iidu_${String(++iidN).padStart(7, "0")}`;
  const sealed = await crypto.seal(s.keys.ecdh, intentAad(by, iid), padIntent(intent)!);
  act(() => ch.deliver(WALL_ROOM_EVENTS.intent, { v: 1, by, iid, ...sealed }));
  await flush();
  await tick(600);
}

describe("the live wall", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: NOW,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    fakeRealtime.reset();
    rt.on = true;
  });

  async function openLive(kind: (typeof WALL_KINDS)[number], onSave = vi.fn(() => undefined)) {
    const crypto = fakeVoteCrypto();
    const onLiveChange = vi.fn();
    wrap(<LiveWall kind={kind} onSave={onSave} onLiveChange={onLiveChange} crypto={crypto} />);
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: WALL_KIND_SETUP[kind].startLabel }));
    });
    const dialog = screen.getByRole("dialog");
    const name = dialog.querySelector("input:not([type=checkbox])") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(name, { target: { value: "Hana Ito" } });
      fireEvent.click(dialog.querySelector("input[type=checkbox]")!);
      fireEvent.click(screen.getByRole("button", { name: "Start room" }));
    });
    await flush();
    const ch = fakeRealtime.last();
    act(() => ch.connect());
    await flush();
    const hostId = (ch.track.mock.calls.at(-1) as unknown as [{ id: string }])[0].id;
    act(() =>
      ch.setPresence([{ id: hostId, name: "Hana Ito", joinedAt: "2026-10-26T09:00:00Z" }, A, B])
    );
    await flush();
    await tick(600);
    expect(screen.getByLabelText(/Prompt/)).toHaveValue(WALL_KIND_SETUP[kind].prompt);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open the wall" }));
    });
    await tick(600);
    return { ch, crypto, onSave, onLiveChange, round: states(ch).at(-1)!.round!.id };
  }

  const post = (r: string, pid: string, text: string, key: string, re?: string): WallIntent => ({
    t: "post",
    r,
    pid,
    text,
    lock: lockOf(key),
    ...(re ? { re } : {}),
  });

  it("opens questions live, registers the room for Amr (counts only), and logs the round", async () => {
    const { ch, crypto, round, onLiveChange } = await openLive("questions");
    expect(onLiveChange).toHaveBeenCalledWith(true);
    expect(states(ch).at(-1)!.round).toMatchObject({
      mode: "live",
      prompt: "What do you want to ask?",
    });
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_q0000001", "When is the next release?", "keyA_0123456789abcdef")
    );
    expect(liveWall()!.status()).toMatchObject({ kind: "questions", posts: 1, people: 3 });
    expect(JSON.stringify(liveWall()!.status())).not.toContain("release");
    expect(logged("wall_opened")).toEqual([{ kind: "questions", mode: "live" }]);
  });

  it("marks a question answered for the room", async () => {
    const { ch, crypto, round } = await openLive("questions");
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_q0000001", "Who owns onboarding?", "keyA_0123456789abcdef")
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Answered: Who owns onboarding/ }));
    });
    await tick(600);
    expect(states(ch).at(-1)!.round!.posts![0]).toMatchObject({ answered: true });
  });

  it("previews duplicate questions, and merges in the room only on Merge", async () => {
    const { ch, crypto, round } = await openLive("questions");
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_q0000001", "When is the next release?", "keyA_0123456789abcdef")
    );
    await send(
      ch,
      crypto,
      B.id,
      post(round, "pid_q0000002", "when is the NEXT release", "keyB_0123456789abcdef")
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Find duplicates without AI" }));
    });
    expect(screen.getByText(/Only you see this draft/)).toBeInTheDocument();
    expect(states(ch).at(-1)!.round!.count).toBe(2);
    const draft = () =>
      screen.getByRole("heading", { name: "Duplicates to merge" }).closest("section")!;
    // Merge asks first, naming the posts: a merge can't be split again.
    await act(async () => {
      fireEvent.click(within(draft() as HTMLElement).getByRole("button", { name: /^Merge/ }));
    });
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Merge these questions for everyone?");
    expect(dialog).toHaveTextContent(/can't be split again/);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    await tick(600);
    expect(states(ch).at(-1)!.round!.count).toBe(2);
    // A "no" puts the group back in the draft.
    await act(async () => {
      fireEvent.click(within(draft() as HTMLElement).getByRole("button", { name: /^Merge/ }));
    });
    dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Merge questions" }));
    });
    await tick(600);
    const shared = states(ch).at(-1)!.round!;
    expect(shared.count).toBe(1);
    expect(shared.posts![0].merged).toHaveLength(1);
  });

  it("tells Amr the round isn't saved, until Save round", async () => {
    const { ch, crypto, round } = await openLive("questions");
    expect(liveWall()!.status().unsaved).toBe(false);
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_q0000001", "When is the next release?", "keyA_0123456789abcdef")
    );
    expect(liveWall()!.status().unsaved).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    });
    expect(liveWall()!.status().unsaved).toBe(false);
  });

  it("shows the next speaker, and lowers their hand when done", async () => {
    const { ch, crypto } = await openLive("hands");
    // A queue to speak: phones get Raise my hand, not a post box.
    expect(states(ch).at(-1)!.round!.open).toBe(false);
    await send(ch, crypto, A.id, { t: "hand", up: true });
    expect(screen.getByTestId("live-polite")).toHaveTextContent(
      "Alex raised a hand: 1 in the queue."
    );
    await send(ch, crypto, B.id, { t: "hand", up: true });
    expect(screen.getByText("Next: Alex")).toBeInTheDocument();
    expect(screen.getByText("Then: Bo")).toBeInTheDocument();
    await act(async () => {
      // The name stays out of the button, so a long one can't push it past a phone's edge.
      fireEvent.click(screen.getByRole("button", { name: "Done, call the next" }));
    });
    await tick(600);
    expect(states(ch).at(-1)!.hands).toEqual([B.id]);
    // The last one: the button goes, and focus stays on the queue's line.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    await tick(600);
    expect(document.activeElement).toHaveTextContent(/^No hands up/);
    await send(ch, crypto, B.id, { t: "hand", up: true });
    await send(ch, crypto, A.id, { t: "hand", up: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Lower all" }));
    });
    await tick(600);
    expect(states(ch).at(-1)!.hands).toEqual([]);
  });

  it("opens brainwriting with Yes, and… on, and shows a reply under its post", async () => {
    const { ch, crypto, round } = await openLive("brainwriting");
    expect(states(ch).at(-1)!.round!.build).toBe(true);
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_b0000001", "A buddy for each joiner", "keyA_0123456789abcdef")
    );
    await send(
      ch,
      crypto,
      B.id,
      post(
        round,
        "pid_b0000002",
        "and a first-week checklist",
        "keyB_0123456789abcdef",
        "pid_b0000001"
      )
    );
    const thread = screen.getByRole("list", { name: /Yes, and… on: A buddy/ });
    expect(within(thread).getByText("and a first-week checklist")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, and…" }));
    });
    await tick(600);
    expect(states(ch).at(-1)!.round!.build).toBeUndefined();
  });

  it("runs a 25/10 round: scoring, then the top ten, then a save with the averages", async () => {
    const onSave = vi.fn(() => undefined);
    const { ch, crypto, round } = await openLive("crowd", onSave);
    expect(screen.getByRole("button", { name: "Start the scoring" })).toBeDisabled();
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_c0000001", "Ship every day", "keyA_0123456789abcdef")
    );
    await send(
      ch,
      crypto,
      B.id,
      post(round, "pid_c0000002", "No meetings on Wednesdays", "keyB_0123456789abcdef")
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start the scoring" }));
    });
    await tick(600);
    expect(states(ch).at(-1)!.round).toMatchObject({
      scoring: "open",
      open: false,
      revealed: true,
    });
    await send(ch, crypto, B.id, {
      t: "score",
      r: round,
      pid: "pid_c0000001",
      value: 5,
      lock: lockOf("keyB2_0123456789abcd"),
    });
    expect(screen.getByText(/1 of up to 10 scores in/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show the top ten" }));
    });
    await tick(600);
    const top = screen.getByRole("region", { name: "Top ten" });
    expect(within(top).getByText("Ship every day")).toBeInTheDocument();
    expect(within(top).getByText("5 on average from 1 person")).toBeInTheDocument();
    // The button went: focus is on the list's heading.
    expect(document.activeElement).toBe(within(top).getByRole("heading", { name: "Top ten" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    });
    const saved = (onSave.mock.calls[0] as unknown as [{ posts: object[] }])[0];
    expect(saved.posts[0]).toMatchObject({ text: "Ship every day", score: 5, scorers: 1 });
    expect(JSON.stringify(saved)).not.toContain(A.id);
  });

  it("keeps a scored post the host hid off the top ten", async () => {
    const { ch, crypto, round } = await openLive("crowd");
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_c0000001", "Ship every day", "keyA_0123456789abcdef")
    );
    await send(
      ch,
      crypto,
      B.id,
      post(round, "pid_c0000002", "No meetings on Wednesdays", "keyB_0123456789abcdef")
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start the scoring" }));
    });
    await tick(600);
    await send(ch, crypto, B.id, {
      t: "score",
      r: round,
      pid: "pid_c0000001",
      value: 5,
      lock: lockOf("keyB2_0123456789abcd"),
    });
    await send(ch, crypto, A.id, {
      t: "score",
      r: round,
      pid: "pid_c0000002",
      value: 3,
      lock: lockOf("keyA2_0123456789abcd"),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide: Ship every day" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show the top ten" }));
    });
    await tick(600);
    const top = screen.getByRole("region", { name: "Top ten" });
    expect(within(top).queryByText("Ship every day")).toBeNull();
    expect(within(top).getByText("No meetings on Wednesdays")).toBeInTheDocument();
  });

  it("shows the word cloud of open answers on demand", async () => {
    const { ch, crypto, round } = await openLive("answers");
    await send(
      ch,
      crypto,
      A.id,
      post(round, "pid_a0000001", "Clear actions with owners", "keyA_0123456789abcdef")
    );
    await send(
      ch,
      crypto,
      B.id,
      post(round, "pid_a0000002", "Owners for every action", "keyB_0123456789abcdef")
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal posts" }));
    });
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Word cloud" }));
    });
    const cloud = screen.getByRole("list", { name: "Word cloud of the posts" });
    expect(within(cloud).getByText("owners")).toBeInTheDocument();
  });
});
