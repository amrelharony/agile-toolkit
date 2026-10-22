import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import type { PromptVersion } from "@/lib/stores/workspace-types";

/**
 * Prompt Registry: drafting versions, the KPI counts, the name + semver
 * ordering, the status menu (incl. promoting through it), removing, the
 * inline BYOK test panel and the CSV export.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(() => {}, {
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
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/components/shared/ai-run-panel", () => ({
  default: ({ prompt, toolName }: { prompt: string; toolName: string }) => (
    <div data-testid="run-panel" data-tool={toolName}>
      {prompt}
    </div>
  ),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { PromptRegistryClient } from "@/app/(tools)/prompt-registry/prompt-registry-client";

const version = (
  p: Partial<PromptVersion> & Pick<PromptVersion, "id" | "name" | "version">
): PromptVersion => ({ body: "Summarize the text.", status: "draft", ...p });

const prompts = () => useWorkspaceStore.getState().prompts ?? [];
const stored = (id: string) => prompts().find((p) => p.id === id);
const kpi = (label: string) => screen.getByText(label).parentElement!;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const saveDraft = () => fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
const headings = () =>
  screen.getAllByRole("listitem").map((li) => li.querySelector(".font-mono")?.textContent);

function chooseStatus(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ prompts: [] });
  useLlmStore.setState({ activeProvider: null, providers: {} });
});

describe("Prompt Registry: empty state", () => {
  it("shows zeroed KPIs and no versions list", () => {
    render(<PromptRegistryClient />);
    for (const label of ["Total", "In production", "Drafts/Review", "Deprecated"]) {
      expect(kpi(label)).toHaveTextContent("0");
    }
    expect(screen.queryByText(/^Versions \(/)).toBeNull();
    expect(screen.getByLabelText("Version")).toHaveValue("1.0.0");
  });
});

describe("Prompt Registry: drafting a version", () => {
  it("needs a name and a body", () => {
    render(<PromptRegistryClient />);
    type("Prompt name", "summarizer");
    saveDraft();
    type("Prompt name", "   ");
    type("Prompt body", "Summarize.");
    saveDraft();
    expect(prompts()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("saves a trimmed draft and keeps the version for the next bump", () => {
    render(<PromptRegistryClient />);
    type("Prompt name", "  summarizer ");
    type("Version", " 1.4.0 ");
    type("Author (optional)", " Ana ");
    type("Prompt body", "  Summarize the ticket.\n");
    type("Change note", " Shorter output ");
    saveDraft();

    expect(prompts()).toHaveLength(1);
    expect(prompts()[0]).toMatchObject({
      name: "summarizer",
      version: "1.4.0",
      body: "Summarize the ticket.",
      status: "draft",
      author: "Ana",
      changeNote: "Shorter output",
    });
    expect(prompts()[0].publishedAt).toBeUndefined();
    expect(history.log).toHaveBeenCalledWith("prompt_drafted", {
      name: "summarizer",
      version: "1.4.0",
    });
    expect(screen.getByLabelText("Prompt name")).toHaveValue("");
    expect(screen.getByLabelText("Prompt body")).toHaveValue("");
    expect(screen.getByLabelText("Author (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Change note")).toHaveValue("");
    expect(screen.getByLabelText("Version")).toHaveValue(" 1.4.0 ");
    expect(kpi("Drafts/Review")).toHaveTextContent("1");
  });

  it("falls back to version 1.0.0 and leaves optional fields unset", () => {
    render(<PromptRegistryClient />);
    type("Prompt name", "router");
    type("Version", "  ");
    type("Prompt body", "Route it.");
    saveDraft();
    expect(prompts()[0].version).toBe("1.0.0");
    expect(prompts()[0].author).toBeUndefined();
    expect(prompts()[0].changeNote).toBeUndefined();
  });
});

describe("Prompt Registry: the versions list", () => {
  it("counts versions by status", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({ id: "1", name: "a", version: "1.0.0", status: "production" }),
        version({ id: "2", name: "a", version: "1.1.0", status: "review" }),
        version({ id: "3", name: "a", version: "1.2.0", status: "draft" }),
        version({ id: "4", name: "b", version: "0.1.0", status: "deprecated" }),
        version({ id: "5", name: "b", version: "0.2.0", status: "production" }),
      ],
    });
    render(<PromptRegistryClient />);
    expect(kpi("Total")).toHaveTextContent("5");
    expect(kpi("In production")).toHaveTextContent("2");
    expect(kpi("Drafts/Review")).toHaveTextContent("2");
    expect(kpi("Deprecated")).toHaveTextContent("1");
    expect(screen.getByText("Versions (5)")).toBeInTheDocument();
  });

  it("orders by name, then newest version first by number, not text", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({ id: "s9", name: "summarizer", version: "1.9.0" }),
        version({ id: "c1", name: "classifier", version: "0.9.0" }),
        version({ id: "s10", name: "summarizer", version: "1.10.0" }),
        version({ id: "s2", name: "summarizer", version: "1.2" }),
      ],
    });
    render(<PromptRegistryClient />);
    expect(headings()).toEqual([
      "classifier@0.9.0",
      "summarizer@1.10.0",
      "summarizer@1.9.0",
      "summarizer@1.2",
    ]);
  });

  it("shows the status, eval score, change note and a clipped body", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({
          id: "p1",
          name: "summarizer",
          version: "1.0.0",
          evalScore: 0.874,
          changeNote: "Tighter wording",
          body: "a".repeat(450),
        }),
        version({ id: "p2", name: "tagger", version: "1.0.0", body: "Tag it." }),
      ],
    });
    render(<PromptRegistryClient />);
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first).getByText("eval: 87%")).toBeInTheDocument();
    expect(within(first).getByText("Tighter wording")).toBeInTheDocument();
    expect(first.querySelector("pre")?.textContent).toBe("a".repeat(400) + "…");
    expect(second).not.toHaveTextContent("eval:");
    expect(second.querySelector("pre")?.textContent).toBe("Tag it.");
  });

  it("offers Publish only on versions that aren't in production", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({ id: "p1", name: "s", version: "1.0.0", status: "production" }),
        version({ id: "p2", name: "s", version: "1.1.0", status: "deprecated" }),
      ],
    });
    render(<PromptRegistryClient />);
    expect(screen.queryByRole("button", { name: "Publish s@1.0.0" })).toBeNull();
    expect(screen.getByRole("button", { name: "Publish s@1.1.0" })).toBeInTheDocument();
  });

  it("removes only the version whose bin was clicked", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({ id: "p1", name: "s", version: "1.0.0" }),
        version({ id: "p2", name: "s", version: "1.1.0" }),
      ],
    });
    render(<PromptRegistryClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove s@1.0.0" }));
    expect(prompts().map((p) => p.id)).toEqual(["p2"]);
    expect(history.log).toHaveBeenCalledWith("prompt_removed", { id: "p1" });
  });

  it("exports every version with the body clipped to 200 characters", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({
          id: "p1",
          name: "s",
          version: "1.0.0",
          status: "production",
          evalScore: 0.9,
          author: "Ana",
          publishedAt: "2026-10-01T09:00:00.000Z",
          body: "b".repeat(300),
        }),
        version({ id: "p2", name: "s", version: "1.1.0" }),
      ],
    });
    render(<PromptRegistryClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Version",
      "Status",
      "Eval",
      "Author",
      "Published",
      "Body",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["s", "1.0.0", "production", 0.9, "Ana", "2026-10-01T09:00:00.000Z", "b".repeat(200)],
      ["s", "1.1.0", "draft", "", "", "", "Summarize the text."],
    ]);
  });
});

describe("Prompt Registry: the status menu", () => {
  it("moves a draft to review and then deprecates it", () => {
    useWorkspaceStore.setState({ prompts: [version({ id: "p1", name: "s", version: "1.0.0" })] });
    render(<PromptRegistryClient />);
    chooseStatus("Status for s@1.0.0", "review");
    expect(stored("p1")?.status).toBe("review");
    chooseStatus("Status for s@1.0.0", "deprecated");
    expect(stored("p1")?.status).toBe("deprecated");
    expect(history.log).toHaveBeenCalledWith("prompt_deprecated", { name: "s" });
    expect(kpi("Deprecated")).toHaveTextContent("1");
  });

  it("choosing production promotes the version and deprecates the old one", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({
          id: "old",
          name: "s",
          version: "1.0.0",
          status: "production",
          publishedAt: "2026-01-01T00:00:00.000Z",
        }),
        version({ id: "new", name: "s", version: "1.1.0", status: "review" }),
      ],
    });
    render(<PromptRegistryClient />);
    chooseStatus("Status for s@1.1.0", "production");
    expect(stored("new")?.status).toBe("production");
    expect(Number.isNaN(Date.parse(stored("new")?.publishedAt ?? ""))).toBe(false);
    expect(stored("old")?.status).toBe("deprecated");
    expect(kpi("In production")).toHaveTextContent("1");
  });

  it("keeps an earlier publish date when a version goes back to production", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({
          id: "p1",
          name: "s",
          version: "1.0.0",
          status: "deprecated",
          publishedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    render(<PromptRegistryClient />);
    chooseStatus("Status for s@1.0.0", "production");
    expect(stored("p1")).toMatchObject({
      status: "production",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("the Publish button stamps a fresh publish date", () => {
    useWorkspaceStore.setState({
      prompts: [
        version({
          id: "p1",
          name: "s",
          version: "1.0.0",
          status: "deprecated",
          publishedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    render(<PromptRegistryClient />);
    fireEvent.click(screen.getByRole("button", { name: "Publish s@1.0.0" }));
    expect(stored("p1")?.status).toBe("production");
    expect(stored("p1")?.publishedAt).not.toBe("2026-01-01T00:00:00.000Z");
    expect(history.log).toHaveBeenCalledWith("prompt_published", { name: "s", version: "1.0.0" });
  });
});

describe("Prompt Registry: inline test panel", () => {
  const seed = () =>
    useWorkspaceStore.setState({
      prompts: [
        version({ id: "p1", name: "s", version: "1.0.0", body: "x".repeat(500) }),
        version({ id: "p2", name: "t", version: "1.0.0", body: "Tag it." }),
      ],
    });

  it("is disabled without a BYOK provider", () => {
    seed();
    render(<PromptRegistryClient />);
    const [test] = screen.getAllByRole("button", { name: "Test prompt" });
    expect(test).toBeDisabled();
    expect(test).toHaveAttribute(
      "title",
      "Configure an AI provider in settings to test prompts inline"
    );
  });

  it("opens one panel at a time with the full, unclipped body", async () => {
    seed();
    useLlmStore.setState({
      activeProvider: "anthropic",
      providers: { anthropic: { apiKey: "test-key", model: "claude-sonnet-4-6" } },
    });
    render(<PromptRegistryClient />);
    const [testS, testT] = screen.getAllByRole("button", { name: "Test prompt" });
    expect(testS).toBeEnabled();
    fireEvent.click(testS);
    const panel = await screen.findByTestId("run-panel");
    expect(panel.textContent).toBe("x".repeat(500));
    expect(panel).toHaveAttribute("data-tool", "Prompt Registry: s@1.0.0");
    expect(screen.getByRole("button", { name: "Hide test panel" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    fireEvent.click(testT);
    expect(
      await screen.findByText("Tag it.", { selector: "[data-testid=run-panel]" })
    ).toBeVisible();
    expect(screen.getAllByTestId("run-panel")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Hide test panel" }));
    expect(screen.queryByTestId("run-panel")).toBeNull();
  });
});
