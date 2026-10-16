"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Compass, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CynefinItem, Workspace } from "@/lib/stores/workspace-types";
import { generateCynefinPrompts } from "@/lib/ai-prompts/cynefin";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CYNEFIN_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const DOMAINS: { id: CynefinItem["domain"]; label: string; color: string; recipe: string }[] = [
  {
    id: "clear",
    label: "Clear",
    color: "#00ff88",
    recipe: "Sense → Categorise → Respond. Apply best practice.",
  },
  {
    id: "complicated",
    label: "Complicated",
    color: "#00f0ff",
    recipe: "Sense → Analyse → Respond. Bring in experts.",
  },
  {
    id: "complex",
    label: "Complex",
    color: "#9d4edd",
    recipe: "Probe → Sense → Respond. Run safe-to-fail experiments.",
  },
  {
    id: "chaotic",
    label: "Chaotic",
    color: "#ff6b6b",
    recipe: "Act → Sense → Respond. Stabilise first, then learn.",
  },
  {
    id: "confused",
    label: "Confused",
    color: "#888",
    recipe: "Break the problem into smaller domain-tagged pieces.",
  },
];

export function CynefinClient() {
  const list = useWorkspaceStore((s) => s.cynefinItems ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertCynefinItem);
  const removeOne = useWorkspaceStore((s) => s.removeCynefinItem);
  const { log } = useHistoryLogger("cynefin");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState<CynefinItem["domain"]>("complex");
  const [rationale, setRationale] = useState("");

  function add() {
    if (!title.trim()) return;
    const recommendedAction = DOMAINS.find((d) => d.id === domain)?.recipe;
    const item: CynefinItem = {
      id: crypto.randomUUID(),
      title: title.trim(),
      domain,
      rationale: rationale.trim() || undefined,
      recommendedAction,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(CYNEFIN_ACTIONS.ITEM_ADDED, { title: item.title, domain });
    emitSignal({
      kind: "decision.cynefinClassified",
      at: item.loggedAt,
      toolId: "cynefin",
      payload: item,
    });
    setTitle("");
    setRationale("");
  }

  function reclassify(id: string, d: CynefinItem["domain"]) {
    const it = list.find((x) => x.id === id);
    if (!it) return;
    upsert({ ...it, domain: d, recommendedAction: DOMAINS.find((x) => x.id === d)?.recipe });
    log(CYNEFIN_ACTIONS.ITEM_RECLASSIFIED, { id, domain: d });
  }

  const grouped = useMemo(() => {
    const m: Record<CynefinItem["domain"], CynefinItem[]> = {
      clear: [],
      complicated: [],
      complex: [],
      chaotic: [],
      confused: [],
    };
    for (const it of list) {
      // Defensive lookup — pre-2014 Cynefin called the bottom-right
      // domain "simple" (now "clear"). A persisted item with that
      // legacy value, OR any hand-edited domain string outside the
      // five-region enum, used to crash this loop with
      // `Cannot read property 'push' of undefined`. Fall back to
      // "confused" so the item still surfaces rather than disappearing.
      const bucket = m[it.domain] ?? m.confused;
      bucket.push(it);
    }
    return m;
  }, [list]);

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
        cynefinItems: s.cynefinItems,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Cynefin Decision Picker",
      prompts: generateCynefinPrompts({ grouped }, workspace),
    }),
    [grouped, workspace]
  );

  const csvData = {
    headers: ["Title", "Domain", "Rationale", "Recommended action"],
    rows: list.map((it) => [it.title, it.domain, it.rationale ?? "", it.recommendedAction ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="cynefin"
      title="Cynefin Decision Picker"
      description="Snowden's framework that places problems into Clear / Complicated / Complex / Chaotic / Confused domains — each with a different decision recipe."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Classify a problem" icon={Plus}>
          <Input
            placeholder="Problem / decision"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Problem or decision title"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <Select value={domain} onValueChange={(v) => setDomain(v as CynefinItem["domain"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOMAINS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-sub italic flex items-center">
              {DOMAINS.find((d) => d.id === domain)?.recipe}
            </p>
          </div>
          <Textarea
            placeholder="Why this domain? (rationale)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            className="mt-2"
          />
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Classify
          </Button>
        </SectionCard>

        <SectionCard
          title={`Items (${list.length})`}
          icon={Compass}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="cynefin"
                csvData={csvData}
                jsonData={list}
                targetRef={exportRef}
              />
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DOMAINS.map((d) => (
              <div key={d.id} className="border border-border rounded p-3 bg-surface-deep min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold uppercase" style={{ color: d.color }}>
                    {d.label}
                  </span>
                  <span className="text-xs text-sub">{grouped[d.id].length}</span>
                </div>
                <p className="text-xs text-sub italic mb-2">{d.recipe}</p>
                <ul className="space-y-1.5 text-sm">
                  {grouped[d.id].map((it) => (
                    <li key={it.id} className="flex items-center gap-2">
                      <Select
                        value={it.domain}
                        onValueChange={(v) => reclassify(it.id, v as CynefinItem["domain"])}
                      >
                        <SelectTrigger
                          className="h-7 w-32 text-xs"
                          aria-label={`Cynefin domain for ${it.title}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DOMAINS.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="flex-1 truncate text-text min-w-0">{it.title}</span>
                      <button
                        onClick={() => {
                          removeOne(it.id);
                          log(CYNEFIN_ACTIONS.ITEM_REMOVED, { id: it.id });
                        }}
                        aria-label="Remove item"
                        className="min-touch-coarse inline-flex items-center justify-center text-sub hover:text-danger"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
