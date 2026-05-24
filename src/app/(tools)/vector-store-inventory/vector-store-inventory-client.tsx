"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Database, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { VectorCollection, Workspace } from "@/lib/stores/workspace-types";
import { generateVectorInventoryPrompts } from "@/lib/ai-prompts/vector-store-inventory";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VECTOR_INVENTORY_ACTIONS } from "@/lib/history/event-actions";
import { toast } from "@/lib/utils/toast";

export function VectorStoreInventoryClient() {
  const list = useWorkspaceStore((s) => s.vectorCollections ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertVectorCollection);
  const removeOne = useWorkspaceStore((s) => s.removeVectorCollection);
  const { log } = useHistoryLogger("vector-store-inventory");
  const exportRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [dim, setDim] = useState("");
  const [docs, setDocs] = useState("");
  const [refresh, setRefresh] = useState("");
  const [owner, setOwner] = useState("");

  function add() {
    if (!name.trim() || !model.trim()) {
      toast.error("Name and embedding model are required.");
      return;
    }
    // BUG-RD3-vector-store-inventory-1: surface bad input instead of
    // silently clamping. The prior `parseNonNeg` mapped "abc" / blank
    // / negative inputs to 0; the user only noticed when the table
    // reported "0 docs" / "0 dim" later. Now: reject non-numeric and
    // negative values up-front with a toast; blank is still allowed
    // (defaults to 0).
    const parseNonNeg = (raw: string, label: string): number | null => {
      const trimmed = raw.trim();
      if (trimmed === "") return 0;
      const n = parseInt(trimmed, 10);
      if (!Number.isFinite(n) || n < 0 || String(n) !== trimmed) {
        toast.error(`${label} must be a non-negative integer (got "${raw}").`);
        return null;
      }
      return n;
    };
    const parsedDim = parseNonNeg(dim, "Dimension");
    if (parsedDim === null) return;
    const parsedDocs = parseNonNeg(docs, "Document count");
    if (parsedDocs === null) return;
    const item: VectorCollection = {
      id: crypto.randomUUID(),
      name: name.trim(),
      embeddingModel: model.trim(),
      dim: parsedDim,
      docCount: parsedDocs,
      refreshCadence: refresh.trim() || undefined,
      owner: owner.trim() || undefined,
    };
    upsert(item);
    log(VECTOR_INVENTORY_ACTIONS.COLLECTION_ADDED, { name: item.name });
    setName("");
    setModel("");
    setDim("");
    setDocs("");
    setRefresh("");
    setOwner("");
  }

  function remove(id: string) {
    removeOne(id);
    log(VECTOR_INVENTORY_ACTIONS.COLLECTION_REMOVED, { id });
  }

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
        vectorCollections: s.vectorCollections,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Vector Store Inventory",
      prompts: generateVectorInventoryPrompts({ items: list }, workspace),
    }),
    [list, workspace]
  );

  const csvData = {
    headers: ["Name", "Embedding model", "Dim", "Docs", "Refresh", "Owner"],
    rows: list.map((c) => [
      c.name,
      c.embeddingModel,
      c.dim,
      c.docCount,
      c.refreshCadence ?? "",
      c.owner ?? "",
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="vector-store-inventory"
      title="Vector Store Inventory"
      description="Catalog of embedding collections with model, dimension, document count, refresh cadence, and ownership."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add collection" icon={Plus}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Collection name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Embedding model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Dimension"
              value={dim}
              onChange={(e) => setDim(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Doc count"
              value={docs}
              onChange={(e) => setDocs(e.target.value)}
            />
            <Input
              placeholder="Refresh cadence"
              value={refresh}
              onChange={(e) => setRefresh(e.target.value)}
            />
            <Input placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Collections (${list.length})`}
            icon={Database}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="vector-inventory"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">Name</th>
                    <th className="p-2">Model</th>
                    <th className="p-2 text-right">Dim</th>
                    <th className="p-2 text-right">Docs</th>
                    <th className="p-2">Refresh</th>
                    <th className="p-2">Owner</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{c.name}</td>
                      <td className="p-2 text-sub text-xs">{c.embeddingModel}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        {Number.isFinite(c.dim) ? c.dim : 0}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {(Number.isFinite(c.docCount) ? c.docCount : 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-xs">{c.refreshCadence ?? "—"}</td>
                      <td className="p-2 text-xs">{c.owner ?? "—"}</td>
                      <td className="p-2">
                        <button
                          onClick={() => remove(c.id)}
                          aria-label="Remove collection"
                          className="text-sub hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
