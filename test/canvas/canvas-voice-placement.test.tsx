import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * The voice button on /canvas (mobile audit #20). Below `sm` the board
 * toolbar spans the stage, and the corner mic sat on its right end over
 * "Show AI insights panel"; there the mic is the toolbar's last item.
 * From `sm` up it stays in its corner. One instance either way, and the
 * tool rail is told the board toolbar shares the stage.
 */

const h = vi.hoisted(() => ({
  auth: { status: "anonymous", user: null } as Partial<AuthContextValue>,
  smUp: false,
  railProps: [] as unknown[],
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
  ToolbarTop: ({ trailing }: { trailing?: ReactNode }) => (
    <div data-testid="board-toolbar">{trailing}</div>
  ),
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
vi.mock("@/app/(tools)/canvas/components/voice-input-button", () => ({
  VoiceInputButton: () => (
    <button type="button" aria-label="Start voice input">
      mic
    </button>
  ),
}));

import { CanvasClient } from "@/app/(tools)/canvas/canvas-client";

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  h.railProps.length = 0;
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 640px)" ? h.smUp : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("CanvasClient voice button placement", () => {
  it("rides inside the board toolbar below sm", async () => {
    h.smUp = false;
    render(<CanvasClient />);
    const mic = await screen.findByRole("button", { name: "Start voice input" });
    expect(within(screen.getByTestId("board-toolbar")).getByRole("button")).toBe(mic);
    expect(screen.getAllByRole("button", { name: "Start voice input" })).toHaveLength(1);
  });

  it("keeps its corner from sm up", async () => {
    h.smUp = true;
    render(<CanvasClient />);
    const mic = await screen.findByRole("button", { name: "Start voice input" });
    expect(screen.getByTestId("board-toolbar")).toBeEmptyDOMElement();
    expect(mic.parentElement).toHaveClass("absolute", "top-3", "right-3");
    expect(screen.getAllByRole("button", { name: "Start voice input" })).toHaveLength(1);
  });

  it("tells the tool rail the board toolbar shares the stage", async () => {
    render(<CanvasClient />);
    await waitFor(() => expect(h.railProps.length).toBeGreaterThan(0));
    expect(h.railProps.at(-1)).toEqual({ clearBoardBar: true });
  });
});
