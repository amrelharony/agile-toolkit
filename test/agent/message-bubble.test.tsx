import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MessageBubble, useToolSteps } from "@/components/agent/message-bubble";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";

/**
 * The interim step rows: a call reads as words ("Retro Board · Add card ·
 * Done · “flaky CI”"), its result shows on its row, visitors never see JSON,
 * and only the owner gets Details with the raw arguments and result.
 */

const at = "2026-11-12T09:00:00Z";
const call = (input: Record<string, unknown>, id = "c1"): ChatMessage => ({
  id: "a1",
  role: "assistant",
  content: [{ type: "tool_use", id, name: "tool_retro_add_card", input }],
  createdAt: at,
});
const result = (content: string, isError = false, id = "c1"): ChatMessage => ({
  id: "t1",
  role: "tool",
  content: [{ type: "tool_result", tool_use_id: id, content, ...(isError && { is_error: true }) }],
  createdAt: at,
});

function Chat({
  messages,
  busy = false,
  owner = false,
}: {
  messages: ChatMessage[];
  busy?: boolean;
  owner?: boolean;
}) {
  const steps = useToolSteps(messages, busy);
  return (
    <div data-testid="log">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} steps={steps} details={owner} />
      ))}
    </div>
  );
}

afterEach(() => {
  useAgentStore.getState().reset();
});

describe("MessageBubble step rows", () => {
  it("shows a visitor a finished step in words, with no JSON and no Details", () => {
    render(
      <Chat
        messages={[
          call({ text: "flaky CI", column: "wentWell" }),
          result('{"added":true,"id":"k1"}'),
        ]}
      />
    );
    const log = screen.getByTestId("log");
    expect(log).toHaveTextContent("Retro Board · Add card · Done · “flaky CI”");
    expect(log.textContent).not.toMatch(/[{}]|tool_retro|wentWell|"added"/);
    expect(screen.queryByText("Details")).toBeNull();
    // The result shows on its call's row: no second box for the tool message.
    expect(log.querySelectorAll("[data-tool-step]")).toHaveLength(1);
    expect(log.querySelector("[data-tool-step]")).toHaveAttribute("data-tool-step", "done");
  });

  it("gives the owner Details with the raw arguments and result, 44 px on touch", () => {
    render(<Chat owner messages={[call({ text: "flaky CI" }), result('{"added":true}')]} />);
    const summary = screen.getByText("Details").closest("summary")!;
    expect(summary).toHaveClass("pointer-coarse:min-h-11");
    const raw = summary.parentElement!.querySelectorAll("pre");
    expect(raw).toHaveLength(2);
    expect(raw[0]).toHaveClass("font-data");
    expect(raw[0].textContent).toContain('"text": "flaky CI"');
    expect(raw[1].textContent).toBe('{"added":true}');
  });

  it("says each way a step can end, without the result string", () => {
    const cases: Array<[string, boolean, string]> = [
      ["User denied execution of tool.retro.add_card.", true, "You said no"],
      ["Handler error: Retro not found", true, "Didn't work"],
      ["Tool not available: tool_retro_add_card", true, "Not available here"],
      ["Cancelled.", true, "Stopped"],
      ["Handler error: Handler timeout after 30000ms", true, "Took too long"],
      ['{"added":false,"reason":"no_retro"}', false, "Didn't work"],
    ];
    for (const [content, isError, words] of cases) {
      const { unmount } = render(
        <Chat messages={[call({ text: "x" }), result(content, isError)]} />
      );
      const log = screen.getByTestId("log");
      expect(log).toHaveTextContent(`Retro Board · Add card · ${words}`);
      expect(log.textContent).not.toContain(content);
      unmount();
    }
  });

  it("marks trouble with the danger colour as well as the words", () => {
    render(<Chat messages={[call({ text: "x" }), result("Handler error: boom", true)]} />);
    expect(screen.getByText("Didn't work")).toHaveClass("text-danger");
  });

  it("keeps a streaming call's row fixed at Getting ready…", () => {
    render(<Chat busy messages={[call({ _partial: true })]} />);
    const log = screen.getByTestId("log");
    expect(log).toHaveTextContent("Retro Board · Add card · Getting ready…");
    expect(log.textContent).not.toContain("_partial");
  });

  it("says Working… once the arguments are in, and Waiting for you while the card shows", () => {
    const { rerender } = render(<Chat busy messages={[call({ text: "x" })]} />);
    expect(screen.getByTestId("log")).toHaveTextContent("Working…");
    act(() => {
      useAgentStore.getState().setPendingToolUse({
        toolUseId: "c1",
        actionId: "tool_retro_add_card",
        resolvedActionId: "tool.retro.add_card",
        input: { text: "x" },
        summary: "Add card",
        resolve: () => {},
      });
    });
    rerender(<Chat busy messages={[call({ text: "x" })]} />);
    expect(screen.getByTestId("log")).toHaveTextContent(
      "Retro Board · Add card · Waiting for you · “x”"
    );
  });

  it("still shows a result whose call isn't in the chat, as a short row", () => {
    render(<Chat messages={[result("Cancelled.", true, "c9")]} />);
    expect(screen.getByTestId("log")).toHaveTextContent("Step · Stopped");
  });

  it("draws nothing for a tool message whose results all show on their calls", () => {
    const { container } = render(<MessageBubble message={result("{}")} steps={undefined} />);
    // Without the pairing it falls back to a row; with it, nothing.
    expect(container).toHaveTextContent("Step · Done");
    const view = render(<Chat messages={[call({ text: "x" }), result("{}")]} />);
    expect(view.getByTestId("log").children).toHaveLength(1);
  });
});
