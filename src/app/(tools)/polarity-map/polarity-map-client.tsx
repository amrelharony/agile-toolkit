"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CircuitBoard, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Polarity, PolarityPole, Workspace } from "@/lib/stores/workspace-types";
import { generatePolarityPrompts } from "@/lib/ai-prompts/polarity-map";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { POLARITY_ACTIONS } from "@/lib/history/event-actions";

/**
 * Per-pole textarea that holds a local draft of newline-separated bullet
 * lines, only committing on blur. The previous behavior called `upsertPole`
 * (and split-filter mid-edit) on every keystroke — that wrote the whole
 * workspace store on each character AND silently consumed empty interior
 * lines as the user typed (because `.filter(Boolean)` runs on every change).
 */
function PoleListTextarea({
  initial,
  rows = 3,
  placeholder,
  onCommit,
  id,
}: {
  initial: string[];
  rows?: number;
  placeholder?: string;
  onCommit: (lines: string[]) => void;
  id?: string;
}) {
  const joined = initial.join("\n");
  const [draft, setDraft] = useState(joined);
  const committedRef = useRef(joined);
  useEffect(() => {
    if (joined !== committedRef.current) {
      setDraft(joined);
      committedRef.current = joined;
    }
  }, [joined]);
  const commit = () => {
    if (draft === committedRef.current) return;
    const lines = draft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    committedRef.current = lines.join("\n");
    onCommit(lines);
  };
  return (
    <Textarea
      id={id}
      rows={rows}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
    />
  );
}

/** A not-yet-saved pole with a stable id, so its first edit creates it once. */
function placeholderPole(polarityId: string, side: PolarityPole["side"]): PolarityPole {
  return {
    id: `${polarityId}:${side}`,
    polarityId,
    side,
    label: side === "left" ? "Left pole" : "Right pole",
    upsides: [],
    downsides: [],
  };
}

export function PolarityMapClient() {
  const polarities = useWorkspaceStore((s) => s.polarities ?? []);
  const poles = useWorkspaceStore((s) => s.polarityPoles ?? []);
  const upsertPol = useWorkspaceStore((s) => s.upsertPolarity);
  const removePol = useWorkspaceStore((s) => s.removePolarity);
  const upsertPole = useWorkspaceStore((s) => s.upsertPolarityPole);
  const { log } = useHistoryLogger("polarity-map");
  const exportRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const [title, setTitle] = useState("");
  const [leftLabel, setLeftLabel] = useState("");
  const [rightLabel, setRightLabel] = useState("");
  const [greater, setGreater] = useState("");
  const [deeper, setDeeper] = useState("");

  // Create polarity used to do nothing, silently, when the title or a pole
  // label was empty. After a failed attempt the empty fields are flagged and
  // a message names them; it updates as they're filled in.
  const [attempted, setAttempted] = useState(false);
  const missing = [
    ...(title.trim() ? [] : ["a polarity title"]),
    ...(leftLabel.trim() ? [] : ["a left pole label"]),
    ...(rightLabel.trim() ? [] : ["a right pole label"]),
  ];
  const showError = attempted && missing.length > 0;
  const errorId = `${uid}-create-error`;
  const flag = (empty: boolean) =>
    showError && empty ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};

  function add() {
    if (missing.length > 0) {
      setAttempted(true);
      return;
    }
    const pol: Polarity = {
      id: crypto.randomUUID(),
      title: title.trim(),
      greaterPurpose: greater.trim() || undefined,
      deeperFear: deeper.trim() || undefined,
    };
    upsertPol(pol);
    upsertPole({
      id: crypto.randomUUID(),
      polarityId: pol.id,
      side: "left",
      label: leftLabel.trim(),
      upsides: [],
      downsides: [],
    });
    upsertPole({
      id: crypto.randomUUID(),
      polarityId: pol.id,
      side: "right",
      label: rightLabel.trim(),
      upsides: [],
      downsides: [],
    });
    log(POLARITY_ACTIONS.POLARITY_ADDED, { title: pol.title });
    // BUG-T6-polarity-map-1: do NOT emitSignal here — signal-bridge.ts
    // watches the workspace store and fires `decision.polarityMapped`
    // on `onAdded` for the polarities collection. Direct emit + bridge
    // emit = double-fire to every subscriber (downstream invalidation
    // double-busts cache keys `polarity:` and `decision:`).
    setTitle("");
    setLeftLabel("");
    setRightLabel("");
    setGreater("");
    setDeeper("");
    setAttempted(false);
  }

  function updatePoleLines(p: PolarityPole, kind: "upsides" | "downsides", lines: string[]) {
    upsertPole({ ...p, [kind]: lines });
    log(POLARITY_ACTIONS.POLE_UPDATED, { id: p.id, kind });
  }

  function remove(id: string) {
    removePol(id);
    log(POLARITY_ACTIONS.POLARITY_REMOVED, { id });
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
        polarities: s.polarities,
        polarityPoles: s.polarityPoles,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Polarity Map",
      prompts: generatePolarityPrompts({ polarities, poles }, workspace),
    }),
    [polarities, poles, workspace]
  );

  const csvData = {
    headers: ["Polarity", "Pole", "Side", "Upsides", "Downsides"],
    rows: poles.map((p) => {
      const pol = polarities.find((x) => x.id === p.polarityId);
      return [
        pol?.title ?? "",
        p.label,
        p.side,
        (p.upsides ?? []).join("; "),
        (p.downsides ?? []).join("; "),
      ];
    }),
  };

  return (
    <ToolPageWrapper
      toolId="polarity-map"
      title="Polarity Map"
      description="Manage chronic tensions (e.g. centralisation vs autonomy) instead of solving them. Each polarity has two poles, each with upsides and downsides."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="New polarity" icon={Plus}>
          <Input
            placeholder="Polarity title (e.g. Autonomy ↔ Standardisation)"
            aria-label="Polarity title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            {...flag(!title.trim())}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <Input
              placeholder="Left pole label"
              aria-label="Left pole label"
              value={leftLabel}
              onChange={(e) => setLeftLabel(e.target.value)}
              {...flag(!leftLabel.trim())}
            />
            <Input
              placeholder="Right pole label"
              aria-label="Right pole label"
              value={rightLabel}
              onChange={(e) => setRightLabel(e.target.value)}
              {...flag(!rightLabel.trim())}
            />
          </div>
          <Input
            placeholder="Greater purpose (above both poles)"
            aria-label="Greater purpose (above both poles)"
            value={greater}
            onChange={(e) => setGreater(e.target.value)}
            className="mt-2"
          />
          <Input
            placeholder="Deeper fear (below both poles)"
            aria-label="Deeper fear (below both poles)"
            value={deeper}
            onChange={(e) => setDeeper(e.target.value)}
            className="mt-2"
          />
          {showError && (
            <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
              Enter{" "}
              {missing.length === 1
                ? missing[0]
                : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`}{" "}
              to create the polarity.
            </p>
          )}
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Create polarity
          </Button>
        </SectionCard>

        {polarities.map((pol) => {
          // A polarity created by the agent (tool.polarity_map.create_polarity)
          // has no pole rows yet. Show it with blank poles; editing a list
          // saves that pole for the first time.
          const left =
            poles.find((p) => p.polarityId === pol.id && p.side === "left") ??
            placeholderPole(pol.id, "left");
          const right =
            poles.find((p) => p.polarityId === pol.id && p.side === "right") ??
            placeholderPole(pol.id, "right");
          return (
            <SectionCard
              key={pol.id}
              title={pol.title}
              icon={CircuitBoard}
              actions={
                <button
                  type="button"
                  onClick={() => remove(pol.id)}
                  aria-label={`Remove polarity: ${pol.title}`}
                  className="min-touch-coarse inline-flex items-center justify-center text-sub hover:text-danger"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              }
            >
              {pol.greaterPurpose && (
                <div className="text-center text-xs text-success mb-2">↑ {pol.greaterPurpose}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[left, right].map((p) => (
                  <div
                    key={p.id}
                    className="border border-border rounded p-3 bg-surface-deep min-w-0"
                  >
                    <div
                      className="font-bold text-sm mb-2"
                      style={{ color: p.side === "left" ? "#00f0ff" : "#ff00aa" }}
                    >
                      {p.label}
                    </div>
                    <label
                      htmlFor={`${uid}-${p.id}-up`}
                      className="block text-xs uppercase text-success mb-1"
                    >
                      Upsides (one per line)
                    </label>
                    <PoleListTextarea
                      key={`up-${p.id}`}
                      id={`${uid}-${p.id}-up`}
                      initial={p.upsides ?? []}
                      onCommit={(lines) => updatePoleLines(p, "upsides", lines)}
                      placeholder="What goes well at this pole?"
                    />
                    <label
                      htmlFor={`${uid}-${p.id}-dn`}
                      className="block text-xs uppercase text-danger mt-2 mb-1"
                    >
                      Downsides (one per line)
                    </label>
                    <PoleListTextarea
                      key={`dn-${p.id}`}
                      id={`${uid}-${p.id}-dn`}
                      initial={p.downsides ?? []}
                      onCommit={(lines) => updatePoleLines(p, "downsides", lines)}
                      placeholder="What goes wrong when over-focused on this pole?"
                    />
                  </div>
                ))}
              </div>
              {pol.deeperFear && (
                <div className="text-center text-xs text-danger mt-2">↓ {pol.deeperFear}</div>
              )}
            </SectionCard>
          );
        })}

        {polarities.length > 0 && (
          <div className="flex gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="polarity-map"
              csvData={csvData}
              jsonData={{ polarities, poles }}
              targetRef={exportRef}
            />
          </div>
        )}
      </div>
    </ToolPageWrapper>
  );
}
