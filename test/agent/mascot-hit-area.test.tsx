import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Amr's box is 132×143 but his figure fills only part of it. The transparent
 * rest would swallow clicks meant for the page under it (a column's "Add a
 * card", a side panel's controls). Only the figure takes clicks, and the empty
 * row below his feet sits past the screen edge.
 */

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));

import { MOVE_HINT, MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import styles from "@/components/agent/mascot/mascot-assistant.module.css";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

beforeEach(() => {
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
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: false });
});

describe("mascot hit area", () => {
  it("takes clicks only on the figure and stands closer to the edge", async () => {
    render(<MascotAssistant />);
    // Before the figure loads: the round launcher takes clicks as before.
    const launcher = screen.getByRole("button", { name: "Ask Amr" });
    expect(launcher).not.toHaveClass("pointer-events-none");

    // First interaction starts the figure (after an idle moment).
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 })).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Ask Amr" });
    expect(button).toHaveClass("pointer-events-none");
    const hit = button.querySelector<HTMLElement>("[data-mascot-hit]");
    expect(hit).not.toBeNull();
    expect(hit).toHaveClass("pointer-events-auto");
    // The hit area is the figure's rows, inset from the box edges.
    expect(parseFloat(hit!.style.top)).toBeGreaterThan(0);
    expect(parseFloat(hit!.style.bottom)).toBeGreaterThan(0);
    expect(parseFloat(hit!.style.left)).toBeGreaterThan(0);
    // The empty row below his feet is past the bottom edge (plus any home
    // indicator, which is 0 on a desktop).
    expect(button.style.bottom).toContain("safe-area-inset-bottom");
    expect(parseFloat(button.style.bottom.replace(/^calc\(/, ""))).toBeLessThan(0);

    // Clicking the figure still opens the assistant.
    fireEvent.click(hit!);
    expect(useAgentStore.getState().open).toBe(true);
  });

  it("draws focus on the figure, not as a round ring around his mostly empty box", async () => {
    render(<MascotAssistant />);
    // The round launcher keeps its ring until the figure is in.
    const launcher = screen.getByRole("button", { name: "Ask Amr" });
    expect(launcher).toHaveClass("rounded-full", "focus-visible:ring-2", styles.bob);
    expect(launcher).not.toHaveClass(styles.figure);

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });

    const button = screen.getByRole("button", { name: "Ask Amr" });
    // The module draws the outline on the hit span (test/design/comic-chat-css.test.ts).
    expect(button).toHaveClass(styles.figure, styles.bob);
    for (const c of button.className.split(/\s+/)) {
      expect(c).not.toMatch(/^(?:[\w-]+:)*(?:rounded-full|ring|outline-none|shadow|drop-shadow)/);
    }
    const hit = button.querySelector<HTMLElement>("[data-mascot-hit]")!;
    expect(hit).not.toHaveClass("rounded-full");
  });

  it("moves by the arrow keys with the launcher and with his figure, and says so on his button", async () => {
    render(<MascotAssistant />);
    const launcher = screen.getByRole("button", { name: "Ask Amr" });
    expect(launcher).toHaveAccessibleDescription(MOVE_HINT);
    // His focused button takes the key, so the page doesn't scroll under him.
    expect(fireEvent.keyDown(launcher, { key: "ArrowUp" })).toBe(false);
    expect(launcher.style.top).not.toBe("");
    expect(launcher.style.bottom).toBe("");

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    const button = screen.getByRole("button", { name: "Ask Amr" });
    // The same button, still described, still clear of the page's clicks.
    expect(button).toBe(launcher);
    expect(button).toHaveAccessibleDescription(MOVE_HINT);
    expect(button).toHaveClass("pointer-events-none");
    expect(fireEvent.keyDown(button, { key: "ArrowLeft" })).toBe(false);
    expect(button.style.left).toContain("safe-area-inset-left");
    expect(button.style.right).toBe("");
  });
});
