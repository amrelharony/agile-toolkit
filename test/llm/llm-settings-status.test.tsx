import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * The LLM settings panel confirms each step on one inline status line. Save
 * and Clear change the stored provider, which re-syncs the panel's fields:
 * that re-sync must not wipe the line that confirms the change it reacts to.
 */

import { LlmSettingsDialog } from "@/components/ai/llm-settings-dialog";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";

beforeEach(() => {
  act(() => {
    useLlmStore.setState({ providers: {}, activeProvider: null });
    useLlmUiStore.setState({ settingsOpen: true });
  });
});

const status = () => screen.getByTestId("llm-status-anthropic");

describe("LLM settings status line", () => {
  it("confirms Save & make active after the store re-syncs the panel", () => {
    render(<LlmSettingsDialog />);
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-ant-test-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save & make active/i }));
    expect(useLlmStore.getState().providers.anthropic?.apiKey).toBe("sk-ant-test-123");
    expect(status().textContent).toMatch(/^Saved\./);
  });

  it("confirms Clear key after the provider entry is removed", () => {
    act(() => {
      useLlmStore.getState().setProvider("anthropic", "sk-ant-test-123", "claude-x");
      useLlmStore.getState().setActiveProvider("anthropic");
    });
    render(<LlmSettingsDialog />);
    fireEvent.click(screen.getByRole("button", { name: /clear key/i }));
    expect(useLlmStore.getState().providers.anthropic).toBeUndefined();
    expect(status().textContent).toMatch(/key cleared\.$/);
  });

  it("still clears the line when the stored key changes from elsewhere", () => {
    render(<LlmSettingsDialog />);
    // Save, then change the stored key outside the panel.
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-ant-a" } });
    fireEvent.click(screen.getByRole("button", { name: /save & make active/i }));
    expect(status().textContent).toMatch(/^Saved\./);
    act(() => {
      useLlmStore.getState().setProvider("anthropic", "sk-ant-b", "claude-x");
    });
    expect(status().textContent).toBe("");
  });
});
