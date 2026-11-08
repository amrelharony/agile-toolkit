import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * The voice button on /canvas (mobile audit #20). Below `sm` the board
 * toolbar spanned the stage and the corner mic sat on its right end, over
 * "Show AI insights panel". Now the toolbar stops short of the mic's
 * corner at every width (ToolbarTop), and the mic keeps ONE place in the
 * tree: moving it between parents at a breakpoint would remount it when a
 * phone rotates (portrait < 640 px, landscape >= 640 px), and its unmount
 * aborts a dictation in progress. The tool rail is told the board toolbar
 * shares the stage.
 */

type Listener = (e: { matches: boolean; media: string }) => void;

const h = vi.hoisted(() => ({
  auth: { status: "anonymous", user: null } as Partial<AuthContextValue>,
  smUp: false,
  listeners: new Map<string, Set<(e: { matches: boolean; media: string }) => void>>(),
  railProps: [] as unknown[],
  boardBarProps: [] as Record<string, unknown>[],
  micMounts: 0,
  micUnmounts: 0,
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
vi.mock("@/app/(tools)/canvas/components/toolbar-left", () => ({
  ToolbarLeft: (props: unknown) => {
    h.railProps.push(props);
    return null;
  },
}));
vi.mock("@/app/(tools)/canvas/components/toolbar-top", () => ({
  ToolbarTop: (props: Record<string, unknown>) => {
    h.boardBarProps.push(props);
    return <div data-testid="board-toolbar" />;
  },
}));
vi.mock("@/app/(tools)/canvas/components/zoom-controls", () => ({ ZoomControls: () => null }));
vi.mock("@/app/(tools)/canvas/components/template-gallery", () => ({
  TemplateGallery: () => null,
}));
vi.mock("@/app/(tools)/canvas/components/import-modal", () => ({ ImportModal: () => null }));
vi.mock("@/app/(tools)/canvas/components/find-bar", () => ({ FindBar: () => null }));
vi.mock("@/app/(tools)/canvas/components/share-modal", () => ({ ShareModal: () => null }));
vi.mock("@/app/(tools)/canvas/components/activity-stream", () => ({
  ActivityStream: () => null,
}));
vi.mock("@/app/(tools)/canvas/components/tag-filter-row", () => ({ TagFilterRow: () => null }));
vi.mock("@/app/(tools)/canvas/components/voice-input-button", async () => {
  const { useEffect } = await import("react");
  return {
    VoiceInputButton: () => {
      // Counts mounts: a remount is what drops a dictation.
      useEffect(() => {
        h.micMounts += 1;
        return () => {
          h.micUnmounts += 1;
        };
      }, []);
      return (
        <button type="button" aria-label="Start voice input">
          mic
        </button>
      );
    },
  };
});

import { CanvasClient } from "@/app/(tools)/canvas/canvas-client";

const realMatchMedia = window.matchMedia;
const SM = "(min-width: 640px)";

/** Rotates the fake phone across `sm`, telling every listener. */
function setSmUp(next: boolean) {
  h.smUp = next;
  act(() => {
    h.listeners.get(SM)?.forEach((fn) => fn({ matches: next, media: SM }));
  });
}

beforeEach(() => {
  h.railProps.length = 0;
  h.boardBarProps.length = 0;
  h.listeners.clear();
  h.micMounts = 0;
  h.micUnmounts = 0;
  h.smUp = false;
  window.matchMedia = ((query: string) => {
    const set = h.listeners.get(query) ?? new Set<Listener>();
    h.listeners.set(query, set);
    return {
      get matches() {
        return query === SM ? h.smUp : false;
      },
      media: query,
      onchange: null,
      addListener: (fn: Listener) => set.add(fn),
      removeListener: (fn: Listener) => set.delete(fn),
      addEventListener: (_: string, fn: Listener) => set.add(fn),
      removeEventListener: (_: string, fn: Listener) => set.delete(fn),
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("CanvasClient voice button placement", () => {
  it("sits in its own corner, never inside the board toolbar", async () => {
    render(<CanvasClient />);
    const mic = await screen.findByRole("button", { name: "Start voice input" });
    // Lined up with the board toolbar below sm (top-2), its old corner
    // from sm up.
    expect(mic.parentElement).toHaveClass(
      "absolute",
      "top-2",
      "right-2",
      "sm:top-3",
      "sm:right-3",
      "z-20"
    );
    expect(screen.getByTestId("board-toolbar")).toBeEmptyDOMElement();
    expect(screen.getAllByRole("button", { name: "Start voice input" })).toHaveLength(1);
    // The board toolbar gets nothing to carry.
    expect(h.boardBarProps.every((p) => Object.keys(p).length === 0)).toBe(true);
  });

  it("stays mounted when a phone rotates across sm, so a dictation survives", async () => {
    render(<CanvasClient />);
    const mic = await screen.findByRole("button", { name: "Start voice input" });
    const corner = mic.parentElement;
    expect(h.micMounts).toBe(1);

    setSmUp(true); // portrait 375 -> landscape 812
    setSmUp(false); // and back

    expect(screen.getByRole("button", { name: "Start voice input" })).toBe(mic);
    expect(mic.parentElement).toBe(corner);
    expect(h.micMounts).toBe(1);
    expect(h.micUnmounts).toBe(0);
  });

  it("tells the tool rail the board toolbar shares the stage", async () => {
    render(<CanvasClient />);
    await waitFor(() => expect(h.railProps.length).toBeGreaterThan(0));
    expect(h.railProps.at(-1)).toEqual({ clearBoardBar: true });
  });
});
