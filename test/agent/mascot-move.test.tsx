import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Moving Amr without dragging him (audit drag-only-move, WCAG 2.5.7), and the
 * panel going with him (panel-not-tied-to-amr):
 * - Move Amr in the header's More menu: a radio group of his four corners,
 *   named in words, aria-checked on the one he stands in;
 * - the arrow keys on his focused button, described by "Arrow keys move him",
 *   each move announced politely as narration;
 * - after a drop or a move the panel glides there (a FLIP on its translate),
 *   and snaps under reduced motion, where animate() is never called;
 * - while he's carried the panel stays put and drops its tail.
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

import { GLIDE, MOVE_HINT, MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import {
  AMR_CORNERS,
  cornerAfterKey,
  cornerName,
  type AmrCorner,
} from "@/components/agent/mascot/amr-geometry";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { DUR, EASE } from "@/lib/motion/tokens";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

/** A desktop with a mouse; `reduced` asks for less motion. */
function stubScreen({ reduced = false }: { reduced?: boolean } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : query.includes("pointer: fine"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** jsdom has no Web Animations: a stand-in that records what was animated, and how. */
const animated: { el: Element; keyframes: Keyframe[]; options: unknown }[] = [];
const animate = vi.fn(function (
  this: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
  options?: number | KeyframeAnimationOptions
) {
  animated.push({ el: this, keyframes: keyframes as Keyframe[], options });
  return {
    cancel: () => {},
    finish: () => {},
    onfinish: null,
    oncancel: null,
  } as unknown as Animation;
});

function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * jsdom has no layout: the panel and his button get boxes on a 1024x768 screen
 * by the corner they stand in (the panel's data-amr-* marks, since jsdom drops
 * its min() offsets; his button's inline edges), so a move changes them.
 */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.hasAttribute("data-agent-sheet-root"))
      return box(
        this.dataset.amrSide === "left" ? 16 : 628,
        this.dataset.amrEdge === "top" ? 70 : 150,
        380,
        500
      );
    if (this.hasAttribute("data-amr-button"))
      return box(this.style.left ? 8 : 968, this.style.top ? 4 : 716, 48, 48);
    return box(0, 0, 0, 0);
  });
}

function renderAmr() {
  return render(
    <LiveAnnouncerProvider>
      <MascotAssistant />
    </LiveAnnouncerProvider>
  );
}

const amrButton = () => screen.getByRole("button", { name: "Ask Amr" });
const dialog = () => screen.getByRole("dialog", { name: "Amr" });
const polite = () => screen.getByTestId("live-polite");

function openPanel() {
  act(() => useAgentStore.setState({ open: true }));
  return dialog();
}

/** Opens the header's More menu from the keyboard. */
function openMore() {
  fireEvent.keyDown(within(dialog()).getByRole("button", { name: "More" }), { key: "Enter" });
  return screen.getByRole("menu");
}

function moveFromMenu(name: string) {
  const menu = openMore();
  const group = within(menu).getByRole("group", { name: "Move Amr" });
  act(() => {
    fireEvent.click(within(group).getByRole("menuitemradio", { name }));
  });
}

/** Where he is drawn, from his button's inline style. */
function drawnAt(): AmrCorner {
  const s = amrButton().style;
  return `${s.top ? "top" : "bottom"}${s.left ? "Left" : "Right"}` as AmrCorner;
}

beforeEach(() => {
  animated.length = 0;
  animate.mockClear();
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: true });
});

afterEach(() => {
  act(() => useAgentStore.setState({ open: false }));
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useMascotStore.setState({ ready: false });
});

describe("his corners", () => {
  it("are named in words, in reading order", () => {
    expect(AMR_CORNERS.map(cornerName)).toEqual([
      "Top left",
      "Top right",
      "Bottom left",
      "Bottom right",
    ]);
  });

  it("an arrow picks the edge or the side and keeps the other", () => {
    expect(cornerAfterKey("bottomRight", "ArrowUp")).toBe("topRight");
    expect(cornerAfterKey("bottomRight", "ArrowLeft")).toBe("bottomLeft");
    expect(cornerAfterKey("topLeft", "ArrowDown")).toBe("bottomLeft");
    expect(cornerAfterKey("topLeft", "ArrowRight")).toBe("topRight");
    // Already there: the same corner.
    expect(cornerAfterKey("topLeft", "ArrowUp")).toBe("topLeft");
    expect(cornerAfterKey("topLeft", "Enter")).toBeNull();
  });
});

describe("Move Amr in the More menu", () => {
  it("moves him and his panel, checked on the corner he stands in, and says where", async () => {
    stubScreen();
    renderAmr();
    openPanel();

    let menu = openMore();
    const group = within(menu).getByRole("group", { name: "Move Amr" });
    expect(
      within(group)
        .getAllByRole("menuitemradio")
        .map((c) => [c.textContent, c.getAttribute("aria-checked")])
    ).toEqual([
      ["Top left", "false"],
      ["Top right", "false"],
      ["Bottom left", "false"],
      ["Bottom right", "true"],
    ]);
    act(() => {
      fireEvent.click(within(group).getByRole("menuitemradio", { name: "Top left" }));
    });

    // The menu closes; he and the panel are at the top left now.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(drawnAt()).toBe("topLeft");
    expect(dialog()).toHaveAttribute("data-amr-side", "left");
    expect(dialog()).toHaveAttribute("data-amr-edge", "top");
    expect(useMascotStore.getState().placed).toEqual({ side: "left", edge: "top" });
    // Narration, in the third person.
    await waitFor(() => expect(polite()).toHaveTextContent("Amr moved to the top left"));

    menu = openMore();
    expect(within(menu).getByRole("menuitemradio", { name: "Top left" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(within(menu).getByRole("menuitemradio", { name: "Bottom right" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("says so when he is already there, and stays", async () => {
    stubScreen();
    renderAmr();
    openPanel();
    moveFromMenu("Bottom right");
    expect(drawnAt()).toBe("bottomRight");
    await waitFor(() => expect(polite()).toHaveTextContent("Amr is already in the bottom right"));
  });
});

describe("the arrow keys on his button", () => {
  it("are described on his button, which keeps its name", () => {
    stubScreen();
    renderAmr();
    expect(amrButton()).toHaveAccessibleDescription(MOVE_HINT);
    expect(MOVE_HINT).toBe("Arrow keys move him");
    expect(amrButton().title).toMatch(/^Ask Amr · .*arrow keys/);
  });

  it("move him between corners, each move announced, without opening the panel", async () => {
    stubScreen();
    renderAmr();
    const amr = amrButton();
    act(() => amr.focus());

    // The page doesn't scroll: the key is his.
    expect(fireEvent.keyDown(amr, { key: "ArrowUp" })).toBe(false);
    expect(drawnAt()).toBe("topRight");
    await waitFor(() => expect(polite()).toHaveTextContent("Amr moved to the top right"));

    fireEvent.keyDown(amr, { key: "ArrowLeft" });
    expect(drawnAt()).toBe("topLeft");
    await waitFor(() => expect(polite()).toHaveTextContent("Amr moved to the top left"));

    fireEvent.keyDown(amr, { key: "ArrowDown" });
    expect(drawnAt()).toBe("bottomLeft");
    await waitFor(() => expect(polite()).toHaveTextContent("Amr moved to the bottom left"));

    // Against the edge: he stays, and it says so.
    expect(fireEvent.keyDown(amr, { key: "ArrowLeft" })).toBe(false);
    expect(drawnAt()).toBe("bottomLeft");
    await waitFor(() => expect(polite()).toHaveTextContent("Amr is already in the bottom left"));

    // Held down: one move, not a flicker.
    fireEvent.keyDown(amr, { key: "ArrowUp", repeat: true });
    expect(drawnAt()).toBe("bottomLeft");
    // With a modifier, or any other key, it isn't his.
    expect(fireEvent.keyDown(amr, { key: "ArrowUp", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(amr, { key: "ArrowUp", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(amr, { key: "a" })).toBe(true);
    expect(drawnAt()).toBe("bottomLeft");

    expect(useAgentStore.getState().open).toBe(false);
    expect(amr).toHaveFocus();
  });

  it("take the open panel with him", () => {
    stubScreen();
    renderAmr();
    openPanel();
    fireEvent.keyDown(amrButton(), { key: "ArrowUp" });
    expect(dialog()).toHaveAttribute("data-amr-edge", "top");
    expect(dialog()).toHaveAttribute("data-amr-side", "right");
  });
});

describe("the glide", () => {
  it("holds the travel duration and calm easing of the motion tokens", () => {
    expect(GLIDE).toEqual({ duration: DUR.travel, easing: EASE.calm });
  });

  it("slides the panel and him to the new corner on the translate property", () => {
    stubScreen();
    stubLayout();
    renderAmr();
    const panel = openPanel();
    moveFromMenu("Top left");

    const glide = animated.find((a) => a.el === panel);
    expect(glide).toBeDefined();
    // From where it stood (628,150) to where it is (16,70): it starts back there.
    expect(glide!.keyframes).toEqual([{ translate: "612.0px 80.0px" }, { translate: "0px 0px" }]);
    expect(glide!.options).toEqual(GLIDE);
    // Nothing but translate: never transform, which places nothing here.
    for (const frame of glide!.keyframes) expect(Object.keys(frame)).toEqual(["translate"]);
    // He glides with it after a move (a drop has its own flight).
    const amr = animated.find((a) => a.el === amrButton());
    expect(amr?.keyframes).toEqual([{ translate: "960.0px 712.0px" }, { translate: "0px 0px" }]);
  });

  it("follows a drop too", () => {
    stubScreen();
    stubLayout();
    renderAmr();
    const panel = openPanel();
    const amr = amrButton();
    act(() => {
      fireEvent.pointerDown(amr, { button: 0, clientX: 990, clientY: 740 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 40, clientY: 40 });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: 40, clientY: 40 });
    });
    expect(dialog()).toHaveAttribute("data-amr-edge", "top");
    expect(animated.some((a) => a.el === panel)).toBe(true);
  });

  it("doesn't run for a move that goes nowhere", () => {
    stubScreen();
    stubLayout();
    renderAmr();
    openPanel();
    moveFromMenu("Bottom right");
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("with reduced motion", () => {
  it("snaps: animate() is never called, by a menu move, an arrow key or a drop", () => {
    stubScreen({ reduced: true });
    stubLayout();
    renderAmr();
    openPanel();

    moveFromMenu("Top left");
    expect(dialog()).toHaveAttribute("data-amr-edge", "top");
    expect(drawnAt()).toBe("topLeft");

    fireEvent.keyDown(amrButton(), { key: "ArrowRight" });
    expect(drawnAt()).toBe("topRight");
    expect(dialog()).toHaveAttribute("data-amr-side", "right");

    const amr = amrButton();
    act(() => {
      fireEvent.pointerDown(amr, { button: 0, clientX: 990, clientY: 30 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 40, clientY: 700 });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: 40, clientY: 700 });
    });
    expect(drawnAt()).toBe("bottomLeft");
    expect(dialog()).toHaveAttribute("data-amr-edge", "bottom");

    expect(animate).not.toHaveBeenCalled();
  });
});

describe("while he's carried", () => {
  it("the panel stays put with no tail, and points again where he lands", async () => {
    stubScreen();
    renderAmr();
    // His figure: the tail points at it, not at the launcher.
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    const panel = openPanel();
    expect(panel).toHaveAttribute("data-tail", "down");
    const bottom = panel.style.bottom;

    const amr = screen.getByTitle(/^Ask Amr/);
    act(() => {
      fireEvent.pointerDown(amr, { button: 0, clientX: 0, clientY: 0 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 40, clientY: 40 });
    });
    expect(dialog()).toHaveAttribute("data-tail", "none");
    expect(dialog()).not.toHaveAttribute("data-tail-from");
    // Still at his corner until the drop.
    expect(dialog().style.bottom).toBe(bottom);

    act(() => {
      fireEvent.pointerUp(document, { clientX: 40, clientY: 40 });
    });
    expect(dialog()).toHaveAttribute("data-tail", "up");
    expect(dialog()).toHaveAttribute("data-tail-from", "left");
  });
});
