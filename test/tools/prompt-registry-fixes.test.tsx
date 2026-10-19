import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PromptVersion } from "@/lib/stores/workspace-types";

/**
 * Prompt Registry: publishing a version used to leave the previous
 * production version of the same prompt in production too. Publishing now
 * deprecates it, the same rule as tool.prompt_registry.promote_to_production.
 */

const toasts = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign((...args: unknown[]) => toasts.calls.push(args), {
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {},
    message: () => {},
    dismiss: () => {},
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { PromptRegistryClient } from "@/app/(tools)/prompt-registry/prompt-registry-client";

const version = (
  partial: Partial<PromptVersion> & Pick<PromptVersion, "id" | "name" | "version">
): PromptVersion => ({ body: "Summarize the text.", status: "draft", ...partial });

const stored = (id: string) =>
  (useWorkspaceStore.getState().prompts ?? []).find((p) => p.id === id);

beforeEach(() => {
  toasts.calls = [];
  useWorkspaceStore.setState({
    prompts: [
      version({
        id: "sum-1",
        name: "summarizer",
        version: "1.0.0",
        status: "production",
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
      version({ id: "sum-2", name: "summarizer", version: "1.1.0", status: "review" }),
      version({
        id: "cls-1",
        name: "classifier",
        version: "0.9.0",
        status: "production",
        publishedAt: "2026-02-01T00:00:00.000Z",
      }),
    ],
  });
});

describe("Prompt Registry: one production version per prompt", () => {
  it("publishing a version deprecates the one it replaces", () => {
    render(<PromptRegistryClient />);
    fireEvent.click(screen.getByRole("button", { name: "Publish summarizer@1.1.0" }));

    expect(stored("sum-2")?.status).toBe("production");
    expect(stored("sum-2")?.publishedAt).toBeDefined();
    expect(stored("sum-1")?.status).toBe("deprecated");
    const live = (useWorkspaceStore.getState().prompts ?? []).filter(
      (p) => p.name === "summarizer" && p.status === "production"
    );
    expect(live.map((p) => p.id)).toEqual(["sum-2"]);
  });

  it("leaves other prompts' production versions alone", () => {
    render(<PromptRegistryClient />);
    fireEvent.click(screen.getByRole("button", { name: "Publish summarizer@1.1.0" }));
    expect(stored("cls-1")?.status).toBe("production");
  });

  it("says which version moved to deprecated", () => {
    render(<PromptRegistryClient />);
    fireEvent.click(screen.getByRole("button", { name: "Publish summarizer@1.1.0" }));
    expect(toasts.calls).toHaveLength(1);
    expect(toasts.calls[0][0]).toBe("summarizer@1.1.0 is now in production");
    expect(toasts.calls[0][1]).toMatchObject({
      description: "summarizer@1.0.0 moved to deprecated.",
    });
  });

  it("publishing the only version of a prompt deprecates nothing", () => {
    useWorkspaceStore.setState({
      prompts: [version({ id: "new-1", name: "router", version: "1.0.0" })],
    });
    render(<PromptRegistryClient />);
    fireEvent.click(screen.getByRole("button", { name: "Publish router@1.0.0" }));
    expect(stored("new-1")?.status).toBe("production");
    expect(toasts.calls).toHaveLength(0);
  });
});
