/**
 * The AI Prompts drawer (ai-prompt-drawer-content.tsx) for the owner without a
 * personal key: Run with AI shows, with the pill naming the owner's own
 * gateway. A visitor without a key sees neither, only Copy and the
 * bring-your-own-key pill, as before. A personal key keeps its own pill.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import AiPromptDrawerContent from "@/components/shared/ai-prompt-drawer-content";
import { Sheet } from "@/components/ui/sheet";
import { PROVIDER_META } from "@/lib/llm/registry";
import { useLlmStore } from "@/lib/stores/llm-store";

const CONFIG = {
  toolName: "Retro",
  prompts: [
    {
      id: "themes",
      title: "Find the themes",
      description: "Group the cards into themes.",
      prompt: "Summarise this retro.",
    },
  ],
};

function open() {
  render(
    <Sheet open>
      <AiPromptDrawerContent config={CONFIG} />
    </Sheet>
  );
}

beforeEach(() => {
  h.auth = null;
  useLlmStore.setState({ activeProvider: null, providers: {} });
});

afterEach(() => {
  cleanup();
  useLlmStore.setState({ activeProvider: null, providers: {} });
  window.localStorage.removeItem("agile-toolkit:llm");
});

describe("AiPromptDrawerContent", () => {
  it("gives the owner without a key Run with AI on the owner's gateway", () => {
    h.auth = { status: "authenticated", user: { id: "owner-1" } };
    open();
    expect(screen.getByRole("button", { name: "Run with AI" })).toBeInTheDocument();
    expect(screen.getByText(/AI: Amr's AI/)).toBeInTheDocument();
    expect(screen.getByText(/your gateway/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bring your own key/ })).toBeNull();
  });

  it("gives a visitor without a key neither: only Copy and the own-key pill", () => {
    open();
    expect(screen.queryByRole("button", { name: "Run with AI" })).toBeNull();
    expect(screen.queryByText(/Amr's AI/)).toBeNull();
    expect(screen.getByRole("button", { name: /bring your own key/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("names the personal key's provider when the owner has one", () => {
    h.auth = { status: "authenticated", user: { id: "owner-1" } };
    useLlmStore.setState({
      activeProvider: "openai",
      providers: { openai: { apiKey: "placeholder-not-a-key", model: "test-model" } },
    });
    open();
    expect(
      screen.getByText(`AI: ${PROVIDER_META.openai.name}`, { exact: false })
    ).toBeInTheDocument();
    expect(screen.queryByText(/your gateway/)).toBeNull();
    expect(screen.getByRole("button", { name: "Run with AI" })).toBeInTheDocument();
  });
});
