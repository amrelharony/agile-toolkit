/**
 * The strip's tool steps (src/components/agent/chat/tool-steps.tsx): one
 * narration caption per run of calls, a line per call in words after a 20 px
 * state slot that is always there; a pen at work while a call runs, and an
 * ink tick (DNA-SPEC section 9) for a change that worked. The tick inks only
 * for a result that came live, once per step and at most once a turn (the
 * store's in-memory inkedToolIds), and is drawn still on a remount, in a
 * loaded thread and on later renders; a read, an error or a "no" gets none.
 * Only the owner gets Details, with the raw arguments and result. The
 * confirm card sits under the caption of the step it asks about.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatProvider } from "@/components/agent/chat/chat-context";
import { ChatItemView } from "@/components/agent/chat/chat-items";
import { ChatLog } from "@/components/agent/chat/chat-log";
import { useChatItems } from "@/components/agent/chat/chat-strip";
import { StepDetails } from "@/components/agent/chat/step-details";
import { useAgentStore, type ChatProfile } from "@/lib/agent/store";
import type { ChatMessage, PendingToolUse, ToolResultBlock, ToolUseBlock } from "@/lib/agent/types";

const AT = "2026-11-16T09:00:00Z";

const user = (id: string, text = "Tidy the retro"): ChatMessage => ({
  id,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: AT,
});
const assistant = (id: string, ...content: ToolUseBlock[]): ChatMessage => ({
  id,
  role: "assistant",
  content,
  createdAt: AT,
});
const toolMsg = (id: string, ...content: ToolResultBlock[]): ChatMessage => ({
  id,
  role: "tool",
  content,
  createdAt: AT,
});
const add = (id: string, text = "flaky CI"): ToolUseBlock => ({
  type: "tool_use",
  id,
  name: "tool_retro_add_card",
  input: { text },
});
const read = (id: string): ToolUseBlock => ({
  type: "tool_use",
  id,
  name: "tool_retro_list_state",
  input: {},
});
const ok = (callId: string, content = '{"added":true}', isError = false): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: callId,
  content,
  ...(isError && { is_error: true }),
});

const store = () => useAgentStore.getState();

/** The strip as both containers feed it, with the owner's Details handed in as agent-conversation does. */
function StoreStrip({ profile = "owner" }: { profile?: ChatProfile }) {
  const items = useChatItems();
  return (
    <ChatProvider profile={profile} stepDetails={StepDetails}>
      <div data-testid="log">
        {items.map((item) => (
          <ChatItemView key={item.key} item={item} />
        ))}
      </div>
    </ChatProvider>
  );
}

const log = () => screen.getByTestId("log");
/** The line drawn for each step, in order. */
const lines = () => Array.from(log().querySelectorAll<HTMLElement>("[data-tool-step]"));
const slotOf = (line: Element) => line.querySelector<HTMLElement>("[data-step-slot]")!;
const tickIn = (el: Element) => el.querySelector<SVGElement>('[data-ink="tick"]');
const ticks = () => Array.from(log().querySelectorAll<SVGElement>('[data-ink="tick"]'));
/** A tick inking in now: drawn without the still class. */
const inking = (tick: Element | null) => !!tick && !tick.classList.contains("ink-still");

/** A turn under way with these calls in its latest reply. */
function running(messages: ChatMessage[]) {
  act(() => {
    useAgentStore.setState({ streaming: true, messages });
  });
}

/** Results arrive, live. */
function arrive(message: ChatMessage) {
  act(() => store().appendMessage(message));
}

afterEach(() => {
  store().reset();
  store().inkedToolIds.clear();
});

describe("the state slot", () => {
  it("is always there, 20 px, and the same box as a call goes from one state to the next", () => {
    running([user("u1"), assistant("a1", { ...add("c1"), input: { _partial: true } })]);
    render(<StoreStrip />);
    const slot = slotOf(lines()[0]);
    expect(slot).toHaveClass("h-5", "w-5", "shrink-0");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(lines()[0]).toHaveAttribute("data-tool-step", "preparing");

    const seen: string[] = [];
    const check = () => {
      seen.push(lines()[0].getAttribute("data-tool-step")!);
      expect(slotOf(lines()[0])).toBe(slot);
    };
    act(() => store().patchMessage("a1", [add("c1")]));
    check();
    act(() =>
      store().setPendingToolUse({
        toolUseId: "c1",
        actionId: "tool_retro_add_card",
        resolvedActionId: "tool.retro.add_card",
        input: { text: "flaky CI" },
        prompt: {
          verb: "Add card",
          title: "Retro Board",
          question: "Add a card to Retro Board?",
          detail: "Text: “flaky CI”",
          destructive: false,
        },
        resolve: () => {},
      })
    );
    check();
    act(() => store().setPendingToolUse(null));
    arrive(toolMsg("t1", ok("c1")));
    check();
    expect(seen).toEqual(["working", "waiting", "done"]);
  });

  it("shows a pen at work while a call gets ready or runs, and nothing while it waits for an OK", () => {
    running([user("u1"), assistant("a1", { ...add("c1"), input: { _partial: true } })]);
    render(<StoreStrip />);
    const pen = () => slotOf(lines()[0]).querySelector('[data-ink="step-running"]');
    expect(pen()).not.toBeNull();
    expect(pen()).toHaveClass("ink-scribble");
    act(() => store().patchMessage("a1", [add("c1")]));
    expect(lines()[0]).toHaveAttribute("data-tool-step", "working");
    expect(pen()).not.toBeNull();
    act(() =>
      store().setPendingToolUse({
        toolUseId: "c1",
        actionId: "tool_retro_add_card",
        resolvedActionId: "tool.retro.add_card",
        input: {},
        prompt: {
          verb: "Add card",
          title: "Retro Board",
          question: "Add?",
          detail: "",
          destructive: false,
        },
        resolve: () => {},
      })
    );
    expect(slotOf(lines()[0]).childElementCount).toBe(0);
  });

  it("says the state in words beside the marks, which say nothing of their own", () => {
    running([user("u1"), assistant("a1", add("c1"))]);
    render(<StoreStrip profile="visitor" />);
    arrive(toolMsg("t1", ok("c1")));
    const line = lines()[0];
    expect(line.querySelector("p")).toHaveTextContent("Retro Board · Add card · Done · “flaky CI”");
    expect(slotOf(line).textContent).toBe("");
    expect(tickIn(line)).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the caption's line", () => {
  const caption = () => log().querySelector("[data-tool-steps]")!;
  /** A loaded thread whose one call came back with this. */
  const loaded = (...results: ToolResultBlock[]) =>
    act(() => {
      useAgentStore.setState({
        messages: [
          user("u1"),
          assistant("a1", ...results.map((r) => add(r.tool_use_id))),
          toolMsg("t1", ...results),
        ],
      });
    });

  it.each([
    ["failed", "Handler error: Retro not found"],
    ["unavailable", "Tool not available: tool_retro_add_card"],
    ["timeout", "Handler error: Handler timeout after 30000ms"],
  ])("takes the danger line for a step that %s, and still says it in words", (state, content) => {
    loaded(ok("c1", content, true));
    render(<StoreStrip />);
    expect(lines()[0]).toHaveAttribute("data-tool-step", state);
    expect(caption()).toHaveAttribute("data-tone", "error");
    expect(lines()[0].querySelector(".text-danger")?.textContent).toMatch(/\w/);
  });

  it("takes it for a run where one step of several went wrong", () => {
    loaded(ok("c1"), ok("c2", "Handler error: boom", true));
    render(<StoreStrip />);
    expect(lines().map((l) => l.getAttribute("data-tool-step"))).toEqual(["done", "failed"]);
    expect(caption()).toHaveAttribute("data-tone", "error");
  });

  it("stays quiet for a change that worked, a no and a stop", () => {
    loaded(
      ok("c1"),
      ok("c2", "User denied execution of tool.retro.add_card.", true),
      ok("c3", "Cancelled.", true)
    );
    render(<StoreStrip />);
    expect(lines().map((l) => l.getAttribute("data-tool-step"))).toEqual([
      "done",
      "denied",
      "stopped",
    ]);
    expect(caption()).toHaveAttribute("data-tone", "note");
  });
});

describe("the ink tick", () => {
  it("inks for a change that worked while it was on screen, and is still on a remount", () => {
    running([user("u1"), assistant("a1", add("c1"))]);
    const first = render(<StoreStrip />);
    expect(ticks()).toEqual([]);
    arrive(toolMsg("t1", ok("c1")));
    const tick = tickIn(lines()[0]);
    expect(inking(tick)).toBe(true);
    expect(store().inkedToolIds.has("a1:s0")).toBe(true);

    // Later renders keep the same mark: it never inks in again.
    act(() => store().setStreaming(false));
    expect(tickIn(lines()[0])).toBe(tick);

    // The panel closed and opened again: the same chat, drawn finished.
    first.unmount();
    render(<StoreStrip />);
    expect(ticks()).toHaveLength(1);
    expect(inking(ticks()[0])).toBe(false);
  });

  it("draws a loaded thread's ticks still, and takes no ink for them", () => {
    act(() => {
      useAgentStore.setState({
        messages: [user("u1"), assistant("a1", add("c1")), toolMsg("t1", ok("c1"))],
      });
    });
    render(<StoreStrip />);
    expect(ticks()).toHaveLength(1);
    expect(inking(ticks()[0])).toBe(false);
    expect(store().inkedToolIds.size).toBe(0);
  });

  it("inks a result that came while the panel was closed still, on opening", () => {
    running([user("u1"), assistant("a1", add("c1"))]);
    const open = render(<StoreStrip />);
    open.unmount();
    arrive(toolMsg("t1", ok("c1")));
    render(<StoreStrip />);
    expect(inking(ticks()[0])).toBe(false);
  });

  it("gives a read no tick, though its slot stays", () => {
    running([user("u1"), assistant("a1", read("c1"))]);
    render(<StoreStrip />);
    arrive(toolMsg("t1", ok("c1", '{"cards":[]}')));
    const line = lines()[0];
    expect(line).toHaveAttribute("data-tool-step", "done");
    expect(line.querySelector("p")).toHaveTextContent("Retro Board · Read · Done");
    expect(tickIn(line)).toBeNull();
    expect(slotOf(line)).toHaveClass("h-5", "w-5");
    expect(slotOf(line).childElementCount).toBe(0);
  });

  it("gives an error, a no, a stop and a change that didn't take no tick", () => {
    const results: Array<[string, boolean]> = [
      ["Handler error: Retro not found", true],
      ["User denied execution of tool.retro.add_card.", true],
      ["Cancelled.", true],
      ["Tool not available: tool_retro_add_card", true],
      ["Handler error: Handler timeout after 30000ms", true],
      ['{"added":false,"reason":"no_retro"}', false],
    ];
    running([user("u1"), assistant("a1", ...results.map((_, n) => add(`c${n}`)))]);
    render(<StoreStrip />);
    arrive(toolMsg("t1", ...results.map(([content, err], n) => ok(`c${n}`, content, err))));
    expect(lines().map((l) => l.getAttribute("data-tool-step"))).toEqual([
      "failed",
      "denied",
      "stopped",
      "unavailable",
      "timeout",
      "failed",
    ]);
    expect(ticks()).toEqual([]);
    expect(store().inkedToolIds.size).toBe(0);
  });

  it("inks at most once a turn: the turn's later changes are drawn still", () => {
    running([user("u1"), assistant("a1", add("c1"), add("c2", "slow build"))]);
    render(<StoreStrip />);
    // Two changes in one round, their results together.
    arrive(toolMsg("t1", ok("c1"), ok("c2")));
    expect(ticks()).toHaveLength(2);
    expect(ticks().map(inking)).toEqual([true, false]);

    // A later round of the same turn: still.
    arrive(assistant("a2", add("c3", "retro notes")));
    arrive(toolMsg("t2", ok("c3")));
    expect(ticks()).toHaveLength(3);
    expect(ticks().map(inking)).toEqual([true, false, false]);

    // The next turn has an ink of its own.
    arrive(user("u2", "And one more"));
    arrive(assistant("a3", add("c4", "pairing")));
    arrive(toolMsg("t3", ok("c4")));
    expect(ticks().map(inking)).toEqual([true, false, false, true]);
  });

  it("never inks a step twice, though the same chat is drawn twice", () => {
    running([user("u1"), assistant("a1", add("c1"))]);
    render(
      <>
        <StoreStrip />
        <StoreStrip />
      </>
    );
    arrive(toolMsg("t1", ok("c1")));
    const all = Array.from(document.querySelectorAll('[data-ink="tick"]'));
    expect(all).toHaveLength(2);
    expect(all.filter(inking)).toHaveLength(1);
  });
});

describe("Details", () => {
  const thread = () =>
    act(() => {
      useAgentStore.setState({
        messages: [user("u1"), assistant("a1", add("c1")), toolMsg("t1", ok("c1"))],
      });
    });

  it("is the owner's: the raw arguments and result, in the data face", () => {
    thread();
    render(<StoreStrip profile="owner" />);
    const details = log().querySelector("[data-step-details]")!;
    expect(details).toHaveTextContent("Details for Retro Board · Add card “flaky CI”");
    const [input, output] = Array.from(details.querySelectorAll('pre[role="region"]'));
    expect(input.textContent).toContain('"text": "flaky CI"');
    expect(output.textContent).toBe('{"added":true}');
    for (const block of [input, output]) expect(block).toHaveClass("font-data");
    // The step's own line stays in words.
    expect(log().querySelector("[data-tool-step] p")?.textContent).not.toMatch(/[{}]/);
  });

  it("is never a visitor's, even when it is handed in", () => {
    thread();
    render(<StoreStrip profile="visitor" />);
    expect(screen.queryByText("Details")).toBeNull();
    expect(log().querySelector("[data-step-details], details")).toBeNull();
    expect(log().textContent).not.toMatch(/[{}]|"added"/);
  });

  it("waits while a call's arguments still stream", () => {
    running([user("u1"), assistant("a1", { ...add("c1"), input: { _partial: true } })]);
    render(<StoreStrip profile="owner" />);
    expect(log().querySelector("[data-step-details]")).toBeNull();
    expect(log()).toHaveTextContent("Retro Board · Add card · Getting ready…");
  });
});

describe("the confirm card", () => {
  /** The chat's real log, fed from the store, as both containers draw it. */
  function StoreLog({ profile = "owner" }: { profile?: ChatProfile }) {
    const items = useChatItems();
    return (
      <ChatProvider profile={profile}>
        <ChatLog items={items} />
      </ChatProvider>
    );
  }
  const card = (toolUseId: string): PendingToolUse => ({
    toolUseId,
    actionId: "tool_retro_add_card",
    resolvedActionId: "tool.retro.add_card",
    input: { text: "flaky CI" },
    prompt: {
      verb: "Add card",
      title: "Retro Board",
      question: "Add a card to Retro Board?",
      detail: "Text: “flaky CI”",
      destructive: false,
    },
    resolve: () => {},
  });
  const conversation = () => screen.getByRole("log", { name: "Conversation" });
  const cards = () => Array.from(conversation().querySelectorAll("[data-confirm-card]"));

  it("sits right under the caption of the step it asks about", () => {
    running([
      user("u1"),
      assistant("a1", read("c0")),
      toolMsg("t0", ok("c0", "{}")),
      assistant("a2", add("c1")),
    ]);
    render(<StoreLog />);
    expect(cards()).toEqual([]);
    act(() => store().setPendingToolUse(card("c1")));

    expect(cards()).toHaveLength(1);
    const item = cards()[0].closest('[data-chat-item="steps"]')!;
    const caption = item.querySelector("[data-tool-steps]")!;
    expect(caption.nextElementSibling).toBe(cards()[0]);
    expect(caption).toHaveTextContent("Retro Board · Add card · Waiting for you · “flaky CI”");
    // Approve all is the owner's.
    expect(
      screen.getByRole("button", { name: "Add card, and don't ask again until I close" })
    ).toBeInTheDocument();

    // Answered: the card goes, and the step runs on.
    act(() => store().setPendingToolUse(null));
    expect(cards()).toEqual([]);
    expect(caption).toHaveTextContent("Retro Board · Add card · Working…");
  });

  it("offers a visitor no Approve all", () => {
    running([user("u1"), assistant("a1", add("c1"))]);
    render(<StoreLog profile="visitor" />);
    act(() => store().setPendingToolUse(card("c1")));
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /don't ask again/ })).toBeNull();
  });

  it("shows a card whose call isn't in the chat after the log's items, once", () => {
    running([user("u1"), assistant("a1", add("c1"))]);
    render(<StoreLog />);
    act(() => store().setPendingToolUse(card("c9")));
    expect(cards()).toHaveLength(1);
    expect(cards()[0].closest("[data-chat-item]")).toBeNull();
    const items = conversation().querySelectorAll("[data-chat-item]");
    const last = items[items.length - 1];
    expect(
      last.compareDocumentPosition(cards()[0]) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
