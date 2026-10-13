import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";

const h = vi.hoisted(() => ({
  auth: null as Partial<AuthContextValue> | null,
  listShareTokens: vi.fn<(boardId: string) => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

vi.mock("@/lib/whiteboard/share-link", () => ({
  buildShareUrl: vi.fn(() => "https://example.test/canvas"),
  createShareToken: vi.fn(),
  listShareTokens: h.listShareTokens,
  revokeShareToken: vi.fn(),
}));

// The squad tab talks to /api/squads; it must never mount for a visitor.
vi.mock("@/components/collab/session-share-modal", () => ({
  SessionShareContent: () => <div data-testid="squad-content" />,
}));

import { ShareModal } from "@/app/(tools)/canvas/components/share-modal";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

function renderModal() {
  return render(<ShareModal boardId="board-1" boardName="Retro board" onClose={() => {}} />);
}

beforeEach(() => {
  h.auth = null;
  h.listShareTokens.mockClear();
});

describe("canvas ShareModal", () => {
  it("shows a visitor only the save tab and skips the share-token lookup", () => {
    h.auth = { status: "anonymous", user: null };
    renderModal();

    expect(screen.getByRole("button", { name: /Save as template/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Share$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Post to Slack/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Invite squad/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Save template" })).toBeInTheDocument();
    expect(screen.getByText(/available to the workspace owner/)).toBeInTheDocument();
    expect(screen.queryByTestId("squad-content")).toBeNull();
    expect(h.listShareTokens).not.toHaveBeenCalled();
  });

  it("keeps every tab for the owner, opening on share", async () => {
    h.auth = { status: "authenticated", user: owner };
    renderModal();

    expect(screen.getByRole("button", { name: /^Share$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Post to Slack/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invite squad/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create link" })).toBeInTheDocument();
    expect(screen.queryByText(/available to the workspace owner/)).toBeNull();
    await waitFor(() => expect(h.listShareTokens).toHaveBeenCalledWith("board-1"));
  });
});
