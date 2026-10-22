import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { VectorCollection } from "@/lib/stores/workspace-types";
import { VECTOR_INVENTORY_ACTIONS } from "@/lib/history/event-actions";

/**
 * Vector Store Inventory: the add form validates name/model and the two
 * integer fields (blank → 0, negative / fractional → toast, nothing saved),
 * the table renders each collection with "—" for blanks, remove deletes the
 * right row, and the CSV export mirrors the table.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: [] as string[] }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(() => "t", {
    success: () => "t",
    error: (m: string) => {
      toasts.error.push(m);
      return "t";
    },
    info: () => "t",
    warning: () => "t",
  }),
}));

import { VectorStoreInventoryClient } from "@/app/(tools)/vector-store-inventory/vector-store-inventory-client";

const coll = (id: string, over: Partial<VectorCollection> = {}): VectorCollection => ({
  id,
  name: `col-${id}`,
  embeddingModel: "text-embedding-3-small",
  dim: 1536,
  docCount: 100,
  ...over,
});

const stored = () => useWorkspaceStore.getState().vectorCollections ?? [];

const textField = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const numField = (name: string) => screen.getByRole("spinbutton", { name }) as HTMLInputElement;

function fill(values: Partial<Record<string, string>>) {
  for (const [name, value] of Object.entries(values)) {
    const el = name === "Dimension" || name === "Doc count" ? numField(name) : textField(name);
    fireEvent.change(el, { target: { value } });
  }
}

const add = () => fireEvent.click(screen.getByRole("button", { name: "Add collection" }));

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  toasts.error = [];
  useWorkspaceStore.setState({ vectorCollections: [] });
});

describe("Vector inventory: validation", () => {
  it("requires both a name and an embedding model", () => {
    render(<VectorStoreInventoryClient />);
    add();
    fill({ "Collection name": "docs" });
    add();
    fill({ "Collection name": "   ", "Embedding model": "voyage-3" });
    add();
    expect(toasts.error).toEqual([
      "Name and embedding model are required.",
      "Name and embedding model are required.",
      "Name and embedding model are required.",
    ]);
    expect(stored()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("rejects a negative dimension and keeps the draft for fixing", () => {
    render(<VectorStoreInventoryClient />);
    fill({ "Collection name": "docs", "Embedding model": "voyage-3", Dimension: "-5" });
    add();
    expect(toasts.error).toEqual(['Dimension must be a non-negative integer (got "-5").']);
    expect(stored()).toEqual([]);
    expect(textField("Collection name").value).toBe("docs");
    expect(numField("Dimension").value).toBe("-5");
  });

  it("rejects a fractional document count", () => {
    render(<VectorStoreInventoryClient />);
    fill({
      "Collection name": "docs",
      "Embedding model": "voyage-3",
      Dimension: "1024",
      "Doc count": "2.5",
    });
    add();
    expect(toasts.error).toEqual(['Document count must be a non-negative integer (got "2.5").']);
    expect(stored()).toEqual([]);
  });

  it("accepts zero and blank counts (blank means 0)", () => {
    render(<VectorStoreInventoryClient />);
    fill({ "Collection name": "empty", "Embedding model": "e5", Dimension: "0" });
    add();
    expect(toasts.error).toEqual([]);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ dim: 0, docCount: 0 });
  });
});

describe("Vector inventory: adding", () => {
  it("stores a trimmed collection, logs it and resets the form", () => {
    render(<VectorStoreInventoryClient />);
    fill({
      "Collection name": "  help-center  ",
      "Embedding model": " text-embedding-3-large ",
      Dimension: "3072",
      "Doc count": "12000",
      "Refresh cadence": " nightly ",
      Owner: " search team ",
    });
    add();

    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      name: "help-center",
      embeddingModel: "text-embedding-3-large",
      dim: 3072,
      docCount: 12000,
      refreshCadence: "nightly",
      owner: "search team",
    });
    expect(history.log).toHaveBeenCalledWith(VECTOR_INVENTORY_ACTIONS.COLLECTION_ADDED, {
      name: "help-center",
    });
    for (const name of ["Collection name", "Embedding model", "Refresh cadence", "Owner"]) {
      expect(textField(name).value).toBe("");
    }
    expect(numField("Dimension").value).toBe("");
    expect(numField("Doc count").value).toBe("");

    const row = screen.getByText("help-center").closest("tr")!;
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(0, 6)).toEqual([
      "help-center",
      "text-embedding-3-large",
      "3072",
      (12000).toLocaleString(),
      "nightly",
      "search team",
    ]);
    expect(screen.getByText("Collections (1)")).toBeInTheDocument();
  });

  it("leaves optional cadence/owner unset when blank", () => {
    render(<VectorStoreInventoryClient />);
    fill({ "Collection name": "docs", "Embedding model": "e5", "Refresh cadence": "   " });
    add();
    expect(stored()[0].refreshCadence).toBeUndefined();
    expect(stored()[0].owner).toBeUndefined();
  });
});

describe("Vector inventory: table", () => {
  it("renders nothing but the form when empty", () => {
    render(<VectorStoreInventoryClient />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(exported.csv).toBeUndefined();
  });

  it("shows a dash for missing cadence/owner and 0 for a corrupt number", () => {
    useWorkspaceStore.setState({
      vectorCollections: [coll("1", { name: "legacy", dim: Number.NaN, docCount: Number.NaN })],
    });
    render(<VectorStoreInventoryClient />);
    const row = screen.getByText("legacy").closest("tr")!;
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(0, 6)).toEqual(["legacy", "text-embedding-3-small", "0", "0", "—", "—"]);
  });

  it("removes only the chosen collection and logs it", () => {
    useWorkspaceStore.setState({
      vectorCollections: [coll("1", { name: "keep" }), coll("2", { name: "drop" })],
    });
    render(<VectorStoreInventoryClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove collection drop" }));
    expect(stored().map((c) => c.id)).toEqual(["1"]);
    expect(history.log).toHaveBeenCalledWith(VECTOR_INVENTORY_ACTIONS.COLLECTION_REMOVED, {
      id: "2",
    });
    expect(screen.getByText("Collections (1)")).toBeInTheDocument();
  });

  it("exports the table rows to CSV", () => {
    useWorkspaceStore.setState({
      vectorCollections: [
        coll("1", { name: "docs", refreshCadence: "daily", owner: "ana" }),
        coll("2", { name: "faq", dim: 768, docCount: 0 }),
      ],
    });
    render(<VectorStoreInventoryClient />);
    expect(exported.csv).toEqual({
      headers: ["Name", "Embedding model", "Dim", "Docs", "Refresh", "Owner"],
      rows: [
        ["docs", "text-embedding-3-small", 1536, 100, "daily", "ana"],
        ["faq", "text-embedding-3-small", 768, 0, "", ""],
      ],
    });
  });
});
