/**
 * <AiButton>: "Ask Amr" for one task. It hands the answer to onResult and
 * changes nothing itself; a visitor agrees first; an error is said plainly
 * with the answer without AI on offer; where AI can't run it hides, says why,
 * or (with fallbackLabel) answers with the fallback. With a lazy ref, the
 * answer without AI never waits for the def, and hovering, focusing or
 * touching the button loads it only while AI can run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { AiButton } from "@/components/ai";
import { TOOL_AI_ERROR_TEXT } from "@/lib/ai/contract";
import { lazyAiTask } from "@/lib/ai/task-ref";
import type { AiTaskDef } from "@/lib/ai/task-types";
import { fallbackOptions, suggestOptionsTask } from "@/lib/ai/tasks/_example";
import { suggestOptionsTask as suggestOptionsRef } from "@/lib/ai/tasks/_example.lite";
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

  it("shows Stop while asking: Stop cancels, hands nothing over, and keeps focus on Ask Amr", async () => {
    h.auth = { status: "authenticated", user: { id: "owner-1" } };
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const onResult = ask();
    const main = screen.getByTestId("ai-button");
    main.focus();
    fireEvent.click(main);
    expect(await screen.findByRole("button", { name: "Asking Amr…" })).toBe(main);
    // Still focusable while it runs (aria-disabled, not disabled), so focus stays put.
    expect(main).not.toBeDisabled();
    expect(main).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(main);
    // A second press while it runs sends nothing more.
    fireEvent.click(main);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("button", { name: "Ask Amr" })).toBe(main);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(document.activeElement).toBe(main);
    expect(main).not.toHaveAttribute("aria-disabled");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("puts focus back on Ask Amr when the consent card goes", async () => {
    ask();
    const main = screen.getByTestId("ai-button");
    fireEvent.click(main);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("ai-consent-compact")).toBeNull();
    expect(document.activeElement).toBe(main);
  });

  it("shows the tool's own reason when there is nothing to ask about yet", () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    ask(vi.fn(), { disabledReason: "Type a question first." });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(screen.getAllByText("Type a question first.").length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── With a lazy ref (what pages pass, from `@/lib/ai/tasks/<id>.lite`) ─────

type Def = AiTaskDef<{ question: string }, { options: string[] }>;

let lazyCount = 0;

/** A ref to a copy of the example task under a fresh id: its def isn't loaded until the ref loads it. */
function lazyRef(load?: (def: Def) => Promise<Def>) {
  const id = `ai.button_lazy_${++lazyCount}` as const;
  const def: Def = { ...suggestOptionsTask, id };
  const loader = vi.fn(() => (load ? load(def) : Promise.resolve(def)));
  const ref = lazyAiTask({ id, toolId: "ai", fallback: suggestOptionsTask.fallback }, loader);
  return { def, ref, loader };
}

describe("AiButton with a lazy ref", () => {
  it("answers without AI at once while the def isn't loaded, and loads nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    const { ref, loader } = lazyRef();
    const onResult = vi.fn();
    render(
      <AiButton
        task={ref}
        input={() => ({ question: QUESTION })}
        onResult={onResult}
        fallbackLabel="Suggest options"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    expect(onResult).toHaveBeenCalledWith(
      { options: fallbackOptions(QUESTION) },
      { source: "fallback" }
    );
    expect(loader).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers without AI at once with the def loaded too", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    // The page's own ref: its def ran with this file's import of `_example`.
    expect(suggestOptionsRef.peek()).toBe(suggestOptionsTask);
    const onResult = vi.fn();
    render(
      <AiButton
        task={suggestOptionsRef}
        input={() => ({ question: QUESTION })}
        onResult={onResult}
        fallbackLabel="Suggest options"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    expect(onResult).toHaveBeenCalledWith(
      { options: fallbackOptions(QUESTION) },
      { source: "fallback" }
    );
  });

  it("with the def loaded, an input its schema refuses says to fill the tool in first", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    const onResult = vi.fn();
    render(
      <AiButton
        task={suggestOptionsRef}
        input={() => ({ question: "" })}
        onResult={onResult}
        fallbackLabel="Suggest options"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    expect(screen.getByText("Fill in the tool first, then try again.")).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("a fallback that throws says to fill the tool in first", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    const id = `ai.button_lazy_${++lazyCount}` as const;
    const ref = lazyAiTask<{ question: string }, { options: string[] }>(
      {
        id,
        toolId: "ai",
        fallback: () => {
          throw new Error("nothing to work with");
        },
      },
      () => Promise.reject(new Error("never loaded"))
    );
    const onResult = vi.fn();
    render(
      <AiButton
        task={ref}
        input={{ question: QUESTION }}
        onResult={onResult}
        fallbackLabel="Suggest options"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest options" }));
    expect(screen.getByText("Fill in the tool first, then try again.")).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("loads the def on focus, hover or touch while AI is available", async () => {
    h.auth = { status: "authenticated", user: { id: "owner-1" } };
    const focus = lazyRef();
    const hover = lazyRef();
    const touch = lazyRef();
    render(
      <>
        <AiButton task={focus.ref} input={{ question: QUESTION }} onResult={vi.fn()} />
        <AiButton task={hover.ref} input={{ question: QUESTION }} onResult={vi.fn()} />
        <AiButton task={touch.ref} input={{ question: QUESTION }} onResult={vi.fn()} />
      </>
    );
    const [a, b, c] = screen.getAllByTestId("ai-button");
    expect(focus.loader).not.toHaveBeenCalled();
    fireEvent.focus(a);
    fireEvent.pointerEnter(b);
    fireEvent.touchStart(c);
    await waitFor(() => expect(focus.loader).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hover.loader).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(touch.loader).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads nothing on focus or hover while AI can't run here", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    const { ref, loader } = lazyRef();
    render(
      <AiButton
        task={ref}
        input={{ question: QUESTION }}
        onResult={vi.fn()}
        fallbackLabel="Suggest options"
      />
    );
    const button = screen.getByRole("button", { name: "Suggest options" });
    await act(async () => {
      fireEvent.focus(button);
      fireEvent.pointerEnter(button);
      fireEvent.touchStart(button);
      await Promise.resolve();
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("says Asking Amr while the def loads, then asks", async () => {
    h.auth = { status: "authenticated", user: { id: "owner-1" } };
    let release: () => void = () => undefined;
    const { ref } = lazyRef((def) => new Promise<Def>((resolve) => (release = () => resolve(def))));
    const onResult = ask(vi.fn(), { task: ref });
    fireEvent.click(screen.getByTestId("ai-button"));
    expect(await screen.findByRole("button", { name: "Asking Amr…" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => release());
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ options: ["Yes", "No"] }, { source: "ai" })
    );
  });

  it("says plainly when the def won't load, and offers the answer without AI", async () => {
    h.auth = { status: "authenticated", user: { id: "owner-1" } };
    const { ref } = lazyRef(() => Promise.reject(new Error("chunk failed")));
    const onResult = ask(vi.fn(), { task: ref });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(await screen.findByText(TOOL_AI_ERROR_TEXT.load_failed)).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    expect(onResult).toHaveBeenCalledWith(
      { options: fallbackOptions(QUESTION) },
      { source: "fallback" }
    );
  });
});
