import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The visitor's chat when the agent runtime (registry + client) can't load on
 * the first message: nothing was sent, so what the visitor typed goes back in
 * the box, and the chat says so in a narration caption with the danger line.
 * The import fails every time here (a chunk lost across a deploy, or offline).
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/visitor-runtime", () => {
  throw new Error("Loading chunk 456 failed.");
});

import VisitorAgentPanel, {
  VISITOR_RUNTIME_LOAD_ERROR,
} from "@/components/agent/mascot/visitor-agent-panel";
import { useAgentStore } from "@/lib/agent/store";

describe("VisitorAgentPanel: the runtime can't load", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
    useAgentStore.getState().setDraft("visitor", "");
  });

  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.getState().setDraft("visitor", "");
  });

  it("puts the message back in the box and says so as an error caption", async () => {
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "how do I run a retro?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const words = await screen.findByText(VISITOR_RUNTIME_LOAD_ERROR);
    expect(words.closest('[data-voice="narration"]')).toHaveAttribute("data-tone", "error");
    await waitFor(() => expect(box).toHaveValue("how do I run a retro?"));
    // Nothing reached the chat, and there is nothing to try again from.
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("leaves the box alone when the question came from the guide", async () => {
    render(<VisitorAgentPanel initialQuestion="retro" onOfflineGuide={() => {}} />);
    expect(await screen.findByText(VISITOR_RUNTIME_LOAD_ERROR)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });
});
