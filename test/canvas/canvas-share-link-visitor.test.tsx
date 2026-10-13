import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * `?share=` links belong to the owner's boards. A public visitor's canvas
 * ignores the token (only `?view=` applies), strips share/board from the
 * address bar and says why, once. The mode is not resolved at all until
 * the owner check settles.
 */

const h = vi.hoisted(() => ({
  auth: null as Partial<AuthContextValue> | null,
  resolveShareToken: vi.fn<(token: string) => Promise<{ role: "editor" }>>(async () => ({
    role: "editor",
  })),
  toastInfo: vi.fn(),
  readOnlyRenders: [] as boolean[],
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

vi.mock("@/lib/whiteboard/share-link", () => ({
  resolveShareToken: h.resolveShareToken,
}));

vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { info: h.toastInfo }),
}));

// Everything below is page chrome / heavy canvas UI that this test does not
// exercise. WhiteboardCanvas reports the resolved mode through data-*.
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
  WhiteboardCanvas: ({ readOnly, canComment }: { readOnly: boolean; canComment: boolean }) => {
    h.readOnlyRenders.push(readOnly);
    return (
      <div
        data-testid="whiteboard"
        data-readonly={String(readOnly)}
        data-can-comment={String(canComment)}
      />
    );
  },
}));
vi.mock("@/app/(tools)/canvas/components/toolbar-left", () => ({ ToolbarLeft: () => null }));
vi.mock("@/app/(tools)/canvas/components/toolbar-top", () => ({ ToolbarTop: () => null }));
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
  VoiceInputButton: () => null,
}));

import { CanvasClient } from "@/app/(tools)/canvas/canvas-client";
import { useCanvasStore } from "@/app/(tools)/canvas/use-canvas-store";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];
const SHARE_URL = "/canvas?board=wb_owner&share=tok123&view=commenter";

function whiteboard() {
  return screen.getByTestId("whiteboard");
}

// A stand-in for the App Router's patched replaceState (next 14.2
// app-router.js): a call whose state carries `__NA` passes straight through
// and the router never learns the new URL; any other call gets the router's
// own state copied over and the URL recorded, so useSearchParams and later
// router updates see it.
const nativeReplaceState = window.history.replaceState.bind(window.history);
const routerUrls: string[] = [];
function patchedReplaceState(data: unknown, unused: string, url?: string | URL | null) {
  const d = data as { __NA?: boolean } | null;
  if (d?.__NA) return nativeReplaceState(data, unused, url);
  const current = window.history.state as { __NA?: boolean; tree?: string } | null;
  const next = { ...(d ?? {}), __NA: current?.__NA, tree: current?.tree };
  if (url) routerUrls.push(new URL(url, window.location.href).search);
  return nativeReplaceState(next, unused, url);
}

beforeEach(() => {
  h.auth = null;
  h.resolveShareToken.mockClear();
  h.toastInfo.mockClear();
  h.readOnlyRenders.length = 0;
  routerUrls.length = 0;
  nativeReplaceState({ __NA: true, tree: "router-tree" }, "", SHARE_URL);
  window.history.replaceState = patchedReplaceState as History["replaceState"];
});

afterEach(() => {
  window.history.replaceState = nativeReplaceState;
  nativeReplaceState(null, "", "/");
});

describe("CanvasClient share links", () => {
  it("ignores the token for a visitor and strips share/board/view through the router", async () => {
    h.auth = { status: "anonymous", user: null };
    render(<CanvasClient />);

    await waitFor(() => expect(window.location.search).toBe(""));
    // The router recorded the stripped URL and kept its own history state.
    expect(routerUrls).toEqual([""]);
    expect(window.history.state).toEqual({ __NA: true, tree: "router-tree" });
    expect(h.resolveShareToken).not.toHaveBeenCalled();
    expect(h.toastInfo).toHaveBeenCalledTimes(1);
    expect(h.toastInfo).toHaveBeenCalledWith(
      "Share links open for the board owner. Ask for a squad invite to collaborate."
    );
    // The link's role (commenter) belonged to the owner's board: the
    // visitor edits their own browser-local board.
    await waitFor(() => expect(whiteboard()).toHaveAttribute("data-readonly", "false"));
    expect(whiteboard()).toHaveAttribute("data-can-comment", "true");
  });

  it("keeps the link and the viewer floor while the owner check is unanswered", async () => {
    h.auth = { status: "error", user: null, error: "owner_unverified" };
    const { rerender } = render(<CanvasClient />);

    await waitFor(() => expect(whiteboard()).toHaveAttribute("data-can-comment", "false"));
    expect(window.location.search).toBe("?board=wb_owner&share=tok123&view=commenter");
    expect(h.toastInfo).not.toHaveBeenCalled();
    expect(h.resolveShareToken).not.toHaveBeenCalled();

    // The retry confirms the owner: the token is honoured.
    h.auth = { status: "authenticated", user: owner };
    rerender(<CanvasClient />);
    await waitFor(() => expect(h.resolveShareToken).toHaveBeenCalledWith("tok123"));
    await waitFor(() => expect(whiteboard()).toHaveAttribute("data-readonly", "false"));
    expect(window.location.search).toBe("?board=wb_owner&share=tok123&view=commenter");
    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("first renders the prerendered editor mode, then the link's viewer floor (no hydration mismatch)", () => {
    // The page is prerendered without a URL, i.e. as "editor": the
    // hydrating render must match it, and only then apply ?share=/?view=.
    h.auth = { status: "loading", user: null };
    useCanvasStore.setState({ activeBoardId: "wb_owner" });
    render(<CanvasClient />);
    expect(h.readOnlyRenders[0]).toBe(false);
    // Applied in a layout effect, i.e. before anything is painted.
    expect(h.readOnlyRenders.at(-1)).toBe(true);
  });

  it("does nothing until the owner check settles", async () => {
    h.auth = { status: "loading", user: null };
    const { rerender } = render(<CanvasClient />);

    // Viewer floor while the token is unvalidated, URL untouched.
    await waitFor(() => expect(whiteboard()).toHaveAttribute("data-can-comment", "false"));
    expect(window.location.search).toBe("?board=wb_owner&share=tok123&view=commenter");
    expect(h.resolveShareToken).not.toHaveBeenCalled();
    expect(h.toastInfo).not.toHaveBeenCalled();

    h.auth = { status: "authenticated", user: owner };
    rerender(<CanvasClient />);
    await waitFor(() => expect(h.resolveShareToken).toHaveBeenCalledWith("tok123"));
    await waitFor(() => expect(whiteboard()).toHaveAttribute("data-readonly", "false"));
    expect(window.location.search).toBe("?board=wb_owner&share=tok123&view=commenter");
    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("does not toast a visitor whose URL has no share token", async () => {
    nativeReplaceState({ __NA: true, tree: "router-tree" }, "", "/canvas?view=readonly");
    h.auth = { status: "anonymous", user: null };
    render(<CanvasClient />);

    await waitFor(() => expect(whiteboard()).toHaveAttribute("data-readonly", "true"));
    expect(window.location.search).toBe("?view=readonly");
    expect(h.toastInfo).not.toHaveBeenCalled();
  });
});
