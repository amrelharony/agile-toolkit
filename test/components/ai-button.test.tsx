/**
 * <AiButton>: "Ask Amr" for one task. It hands the answer to onResult and
 * changes nothing itself; a visitor agrees first; an error is said plainly
 * with the answer without AI on offer; where AI can't run it hides, says why,
 * or (with fallbackLabel) answers with the fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { AiButton } from "@/components/ai";
import { TOOL_AI_ERROR_TEXT } from "@/lib/ai/contract";
import { fallbackOptions, suggestOptionsTask } from "@/lib/ai/tasks/_example";
import { TOOL_AI_UNAVAILABLE_TEXT } from "@/lib/ai/use-tool-ai";
import { enterLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

const QUESTION = "Should we keep the Friday demo?";
let fetchMock: ReturnType<typeof vi.fn>;

function ask(onResult = vi.fn(), extra: Record<string, unknown> = {}) {
  render(
    <AiButton
      task={suggestOptionsTask}
      input={() => ({ question: QUESTION })}
      onResult={onResult}
      {...extra}
    />
  );
  return onResult;
}

beforeEach(() => {
  h.auth = null;
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true, data: { options: ["Yes", "No"] }, source: "ai" }), {
        status: 200,
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
  window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AiButton", () => {
  it("asks a visitor to agree first, then asks Amr and hands the answer over", async () => {
    const onResult = ask();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(await screen.findByTestId("ai-consent-compact")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Agree" }));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ options: ["Yes", "No"] }, { source: "ai" })
    );
    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBe(VISITOR_AI_CONSENT_VERSION);
    expect(screen.queryByTestId("ai-consent-compact")).toBeNull();
  });

  it("'Not now' sends nothing", async () => {
    const onResult = ask();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("ai-consent-compact")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("says an error plainly and offers the answer without AI", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: "site_busy" }), { status: 429 })
    );
    const onResult = ask();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(await screen.findByText(TOOL_AI_ERROR_TEXT.site_busy)).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    expect(onResult).toHaveBeenCalledWith(
      { options: fallbackOptions(QUESTION) },
      { source: "fallback" }
    );
  });

  it("is hidden when visitor AI is off and there is no fallback label", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    ask();
    expect(screen.queryByTestId("ai-button")).toBeNull();
  });

  it("answers with the fallback straight away when AI is off and a fallback label is given", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    const onResult = ask(vi.fn(), { fallbackLabel: "Suggest options" });
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    expect(onResult).toHaveBeenCalledWith(
      { options: fallbackOptions(QUESTION) },
      { source: "fallback" }
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says why it can't ask while a live room is open, sending nothing", () => {
    const leave = enterLiveVisitorRoom();
    try {
      const onResult = ask();
      const button = screen.getByRole("button", { name: "Ask Amr" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(TOOL_AI_UNAVAILABLE_TEXT.live_room);
      fireEvent.click(button);
      expect(onResult).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      leave();
    }
  });

  it("is hidden from a visitor for an owner-only task: no consent card, nothing sent", () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    render(
      <AiButton
        task={{ ...suggestOptionsTask, ownerOnly: true }}
        input={{ question: QUESTION }}
        onResult={vi.fn()}
      />
    );
    expect(screen.queryByTestId("ai-button")).toBeNull();
    expect(screen.queryByTestId("ai-consent-compact")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers an owner-only task with the fallback for a visitor when a fallback label is given", () => {
    const onResult = vi.fn();
    render(
      <AiButton
        task={{ ...suggestOptionsTask, ownerOnly: true }}
        input={{ question: QUESTION }}
        onResult={onResult}
        fallbackLabel="Suggest options"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    expect(onResult).toHaveBeenCalledWith(
      { options: fallbackOptions(QUESTION) },
      { source: "fallback" }
    );
    expect(screen.queryByTestId("ai-consent-compact")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the owner ask without a consent card", async () => {
    h.auth = { status: "authenticated", user: { id: "owner-1" } };
    const onResult = ask();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("/api/ai/tool");
  });

  it("shows the tool's own reason when there is nothing to ask about yet", () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    ask(vi.fn(), { disabledReason: "Type a question first." });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(screen.getAllByText("Type a question first.").length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
