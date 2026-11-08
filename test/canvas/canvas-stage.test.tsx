import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * The /canvas stage on phones (mobile audit #23, #68).
 *
 * - #23: the stage's 440 / 520 px floor beat its 100dvh height on short
 *   screens, so a landscape phone got a board taller than the screen with
 *   its zoom controls below the fold. The floor now gives way to a cap at
 *   the visible height, and touch screens get a full-screen board toggle.
 * - #68: the empty-board card took every tap in the middle of the board,
 *   so an armed Sticky tool placed nothing there. Only its buttons do now.
 */

const h = vi.hoisted(() => ({
  auth: { status: "anonymous", user: null } as Partial<AuthContextValue>,
  zoomProps: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { info: vi.fn() }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/whiteboard/export", () => ({
  exportPng: vi.fn(),
  exportSvg: vi.fn(),
  exportJson: vi.fn(),
  exportJpg: vi.fn(),
  exportPdf: vi.fn(),
  exportCsv: vi.fn(),
  exportPptx: vi.fn(),
}));
vi.mock("@/app/(tools)/canvas/components/whiteboard-canvas", () => ({
  WhiteboardCanvas: () => <div data-testid="whiteboard" />,
}));
vi.mock("@/app/(tools)/canvas/components/toolbar-left", () => ({ ToolbarLeft: () => null }));
vi.mock("@/app/(tools)/canvas/components/toolbar-top", () => ({ ToolbarTop: () => null }));
vi.mock("@/app/(tools)/canvas/components/zoom-controls", () => ({
  // Stands in for the touch row's toggle (tested in canvas-zoom-controls).
  ZoomControls: (props: Record<string, unknown>) => {
    h.zoomProps.push(props);
    const fill = props.fillScreen as { on: boolean; toggle: () => void } | undefined;
    return fill ? (
      <button type="button" aria-pressed={fill.on} onClick={fill.toggle}>
        Full-screen board
      </button>
    ) : null;
  },
}));
vi.mock("@/app/(tools)/canvas/components/template-gallery", () => ({
  TemplateGallery: () => <div role="dialog" aria-label="Templates" />,
}));
vi.mock("@/app/(tools)/canvas/components/import-modal", () => ({ ImportModal: () => null }));
vi.mock("@/app/(tools)/canvas/components/find-bar", () => ({ FindBar: () => null }));
vi.mock("@/app/(tools)/canvas/components/share-modal", () => ({ ShareModal: () => null }));
vi.mock("@/app/(tools)/canvas/components/activity-stream", () => ({
  ActivityStream: () => null,
}));
vi.mock("@/app/(tools)/canvas/components/tag-filter-row", () => ({ TagFilterRow: () => null }));
vi.mock("@/app/(tools)/canvas/components/voice-input-button", () => ({
  VoiceInputButton: () => null,
}));

import { CanvasClient } from "@/app/(tools)/canvas/canvas-client";
import {
  BOARD_FILL_H,
  BOARD_MAX_H,
  BOARD_VH,
} from "@/app/(tools)/canvas/hooks/use-board-fill-screen";

const realScrollTo = window.scrollTo;

beforeEach(() => {
  h.zoomProps.length = 0;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  window.scrollTo = realScrollTo;
  document.documentElement.style.overflow = "";
});

/** The stage: the board's positioned box, parent of the whiteboard. */
async function findStage() {
  const board = await screen.findByTestId("whiteboard");
  return board.parentElement as HTMLElement;
}

describe("CanvasClient stage height", () => {
  it("never outgrows the visible screen", async () => {
    render(<CanvasClient />);
    const stage = await findStage();
    expect(stage).toHaveClass(
      "board-stage",
      "h-[calc(100dvh-220px)]",
      // The old floors, now capped at the visible height.
      "min-h-[min(440px,var(--board-max-h))]",
      "sm:min-h-[min(520px,var(--board-max-h))]",
      "max-h-[var(--board-max-h)]"
    );
    expect(stage).not.toHaveClass("min-h-[440px]");
    expect(stage).not.toHaveClass("sm:min-h-[520px]");
    expect(stage.style.getPropertyValue("--board-max-h")).toBe(BOARD_MAX_H);
    // The cap is the dynamic viewport less the sticky header and the
    // space phones keep for Amr (or the home-indicator safe area).
    expect(BOARD_MAX_H).toMatch(/^calc\(var\(--board-vh\) - var\(--header-h\)/);
    expect(BOARD_MAX_H).toContain("var(--amr-band-top, 0px)");
    expect(BOARD_MAX_H).toContain("var(--amr-band-bottom, env(safe-area-inset-bottom, 0px))");
  });

  it("keeps its height in browsers that don't know 100dvh", async () => {
    // 100dvh written straight into --board-max-h would be found invalid
    // only at computed-value time there, which resets min- and max-height
    // and collapses the board (its content is all absolutely positioned).
    render(<CanvasClient />);
    const stage = await findStage();
    expect(BOARD_VH).toBe("[--board-vh:100vh] supports-[height:100dvh]:[--board-vh:100dvh]");
    expect(stage).toHaveClass("[--board-vh:100vh]", "supports-[height:100dvh]:[--board-vh:100dvh]");
    for (const height of [BOARD_MAX_H, BOARD_FILL_H]) {
      expect(height).toContain("var(--board-vh)");
      expect(height).not.toContain("100dvh");
    }
    // Full screen keeps the fallback (it's on the stage, not STAGE_HEIGHT).
    fireEvent.click(screen.getByRole("button", { name: "Full-screen board" }));
    expect(stage).toHaveClass("[--board-vh:100vh]", "supports-[height:100dvh]:[--board-vh:100dvh]");
  });

  it("fills the screen on request, and gives the page back", async () => {
    render(<CanvasClient />);
    const stage = await findStage();
    const toggle = screen.getByRole("button", { name: "Full-screen board" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(stage).toHaveAttribute("data-fill-screen", "true");
    expect(stage.style.height).toBe(BOARD_FILL_H);
    expect(BOARD_FILL_H).toMatch(/^calc\(var\(--board-vh\) - var\(--header-h\)/);
    // The capped height classes step aside (min-h would clamp it).
    expect(stage).not.toHaveClass("h-[calc(100dvh-220px)]");
    expect(stage).not.toHaveClass("max-h-[var(--board-max-h)]");
    // Its top goes up under the header and the page holds still.
    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.documentElement.style.overflow).toBe("hidden");
    // Same box: the board isn't remounted (a dictation would abort).
    expect(screen.getByTestId("whiteboard").parentElement).toBe(stage);

    fireEvent.click(toggle);
    expect(stage).not.toHaveAttribute("data-fill-screen");
    expect(stage.style.height).toBe("");
    expect(stage).toHaveClass("h-[calc(100dvh-220px)]", "max-h-[var(--board-max-h)]");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("re-aligns the full-screen board when the phone rotates", async () => {
    render(<CanvasClient />);
    await findStage();
    fireEvent.click(screen.getByRole("button", { name: "Full-screen board" }));
    const calls = vi.mocked(window.scrollTo).mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(vi.mocked(window.scrollTo).mock.calls.length).toBe(calls + 1);
  });

  it("gives the page's own ZoomControls the full-screen switch", async () => {
    render(<CanvasClient />);
    await findStage();
    const last = h.zoomProps.at(-1)!;
    expect(typeof last.onFit).toBe("function");
    expect(last.fillScreen).toMatchObject({ on: false, toggle: expect.any(Function) });
  });
});

describe("CanvasClient empty-board card", () => {
  async function findCard() {
    const heading = await screen.findByRole("heading", { name: "Start your board" });
    return heading.parentElement as HTMLElement;
  }

  it("lets taps through to the board except on its buttons", async () => {
    render(<CanvasClient />);
    const card = await findCard();
    // The card inherits pointer-events: none from its full-board wrapper.
    expect(card).not.toHaveClass("pointer-events-auto");
    expect(card.parentElement).toHaveClass("absolute", "inset-0", "pointer-events-none");
    const templates = within(card).getByRole("button", { name: "Templates" });
    const imp = within(card).getByRole("button", { name: "Import" });
    for (const b of [templates, imp]) expect(b).toHaveClass("pointer-events-auto");
    // The buttons still work.
    fireEvent.click(templates);
    expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
  });

  it("speaks touch on a touch screen, keys with a keyboard", async () => {
    render(<CanvasClient />);
    const card = await findCard();
    const kbd = within(card).getByText("N");
    expect(kbd.tagName).toBe("KBD");
    expect(kbd.parentElement).toHaveClass("pointer-coarse:hidden");
    const touch = within(card).getByText(/or tap a tool, then the board\./);
    expect(touch).toHaveClass("hidden", "pointer-coarse:inline");
    // The desktop sentence reads as before.
    expect(kbd.parentElement!.parentElement!.textContent).toContain(
      "Pick a template or import — or press N for a sticky."
    );
  });

  it("keeps clear of the board toolbar and the zoom controls on touch", async () => {
    render(<CanvasClient />);
    const card = await findCard();
    expect(card.parentElement).toHaveClass(
      "pointer-coarse:pt-[4.5rem]",
      "pointer-coarse:pb-[11rem]",
      "sm:pointer-coarse:pb-[6.25rem]"
    );
    // Its decorative icon goes on touch, to fit a landscape board.
    expect(card.querySelector("svg")).toHaveClass("pointer-coarse:hidden");
  });
});
