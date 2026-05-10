"use client";

import { useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
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
import {
  Compass,
  Plus,
  Trash2,
  Activity,
  ShieldAlert,
  Clock,
} from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { TECH_RADAR_ACTIONS } from "@/lib/history/event-actions";
import { generateTechRadarPrompts } from "@/lib/ai-prompts/tech-radar";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

type Ring = "adopt" | "trial" | "assess" | "hold";
type Quadrant = "languages_frameworks" | "tools" | "platforms" | "techniques";

interface Blip {
  id: string;
  name: string;
  ring: Ring;
  quadrant: Quadrant;
  movedAt: string; // ISO
  description?: string;
}

const STORAGE_KEY = "agile-toolkit:tech-radar";

const RINGS: { id: Ring; label: string; color: string }[] = [
  { id: "adopt", label: "Adopt", color: "#22c55e" },
  { id: "trial", label: "Trial", color: "#00f0ff" },
  { id: "assess", label: "Assess", color: "#a855f7" },
  { id: "hold", label: "Hold", color: "#ef4444" },
];

const RING_INDEX: Record<Ring, number> = {
  adopt: 0,
  trial: 1,
  assess: 2,
  hold: 3,
};

const QUADRANTS: { id: Quadrant; label: string }[] = [
  { id: "languages_frameworks", label: "Languages & Frameworks" },
  { id: "tools", label: "Tools" },
  { id: "platforms", label: "Platforms" },
  { id: "techniques", label: "Techniques" },
];

// Quadrant index 0..3 maps to angular sector (top-right, bottom-right,
// bottom-left, top-left) in standard radar orientation.
const QUADRANT_INDEX: Record<Quadrant, number> = {
  languages_frameworks: 0,
  tools: 1,
  platforms: 2,
  techniques: 3,
};

const RADAR_SIZE = 300;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = RADAR_CENTER - 6;

/**
 * Cheap djb2 string hash, returns a non-negative integer in [0, 2^31).
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Project a blip into x/y on the 300x300 radar.
 *
 * Uses two independent deterministic hashes of the blip id (one for the
 * angular fraction, one for the radial fraction) so dots within a sector
 * spread across both axes. The previous implementation derived both from
 * the same hash via a 7-bit shift, which left r1 and r2 strongly
 * correlated and caused dots to clump along a diagonal line per quadrant.
 */
function projectBlip(blip: Blip): { x: number; y: number } {
  const r1 = (djb2(blip.id) % 1000) / 1000; // angular fraction
  const r2 = (djb2(blip.id + "_y") % 1000) / 1000; // radial fraction
  // Each ring is 1/4 of the radius. inner padding so the dot doesn't sit
  // exactly on the ring divider.
  const ringIdx = RING_INDEX[blip.ring];
  const ringInner = (ringIdx / 4) * RADAR_RADIUS + 8;
  const ringOuter = ((ringIdx + 1) / 4) * RADAR_RADIUS - 8;
  const radius = ringInner + (ringOuter - ringInner) * r2;
  // Quadrant 0 = top-right (angle in (-90, 0)), going clockwise.
  // Map index → starting angle (degrees), 90deg sector wide.
  const sectorStart = -90 + QUADRANT_INDEX[blip.quadrant] * 90;
  const angleDeg = sectorStart + 6 + r1 * (90 - 12); // 6deg padding each side
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: RADAR_CENTER + Math.cos(angleRad) * radius,
    y: RADAR_CENTER + Math.sin(angleRad) * radius,
  };
}

function quadrantWedge(quadrantIdx: number, ringIdx: number): string {
  // SVG path for one wedge of one ring (an annular sector).
  const innerR = (ringIdx / 4) * RADAR_RADIUS;
  const outerR = ((ringIdx + 1) / 4) * RADAR_RADIUS;
  const startDeg = -90 + quadrantIdx * 90;
  const endDeg = startDeg + 90;
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const x1 = RADAR_CENTER + Math.cos(start) * innerR;
  const y1 = RADAR_CENTER + Math.sin(start) * innerR;
  const x2 = RADAR_CENTER + Math.cos(start) * outerR;
  const y2 = RADAR_CENTER + Math.sin(start) * outerR;
  const x3 = RADAR_CENTER + Math.cos(end) * outerR;
  const y3 = RADAR_CENTER + Math.sin(end) * outerR;
  const x4 = RADAR_CENTER + Math.cos(end) * innerR;
  const y4 = RADAR_CENTER + Math.sin(end) * innerR;
  if (innerR === 0) {
    return `M ${RADAR_CENTER} ${RADAR_CENTER} L ${x2} ${y2} A ${outerR} ${outerR} 0 0 1 ${x3} ${y3} Z`;
  }
  return `M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 0 0 ${x1} ${y1} Z`;
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

export function TechRadarClient() {
  const [blips, setBlips] = usePersisted<Blip[]>(STORAGE_KEY, []);
  const { log } = useHistoryLogger("tech-radar");
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
      })
    )
  );

  const [name, setName] = useState("");
  const [ring, setRing] = useState<Ring>("assess");
  const [quadrant, setQuadrant] = useState<Quadrant>("tools");
  const [description, setDescription] = useState("");

  const addBlip = () => {
    if (!name.trim()) return;
    const id = crypto.randomUUID();
    const desc = description.trim();
    const blip: Blip = {
      id,
      name: name.trim(),
      ring,
      quadrant,
      movedAt: new Date().toISOString(),
      description: desc.length > 0 ? desc : undefined,
    };
    setBlips((s) => [...s, blip]);
    log(TECH_RADAR_ACTIONS.BLIP_ADDED, {
      blipId: id,
      name: blip.name,
      ring: blip.ring,
      quadrant: blip.quadrant,
      description: blip.description,
    });
    setName("");
    setDescription("");
  };

  const moveBlip = (id: string, nextRing: Ring) => {
    const blip = blips.find((b) => b.id === id);
    if (!blip || blip.ring === nextRing) return;
    setBlips((s) =>
      s.map((b) =>
        b.id === id
          ? { ...b, ring: nextRing, movedAt: new Date().toISOString() }
          : b
      )
    );
    log(TECH_RADAR_ACTIONS.BLIP_MOVED, {
      blipId: id,
      name: blip.name,
      from: blip.ring,
      to: nextRing,
    });
  };

  const removeBlip = (id: string) => {
    const blip = blips.find((b) => b.id === id);
    setBlips((s) => s.filter((b) => b.id !== id));
    log(TECH_RADAR_ACTIONS.BLIP_REMOVED, {
      blipId: id,
      name: blip?.name,
      ring: blip?.ring,
      quadrant: blip?.quadrant,
    });
  };

  const blipsByRing = useMemo(() => {
    const map: Record<Ring, Blip[]> = { adopt: [], trial: [], assess: [], hold: [] };
    for (const b of blips) map[b.ring].push(b);
    return map;
  }, [blips]);

  const recentlyMoved = useMemo(
    () => blips.filter((b) => daysSince(b.movedAt) <= 30).length,
    [blips]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Tech Radar",
      prompts: generateTechRadarPrompts({ blips }, workspace),
    }),
    [blips, workspace]
  );

  const csvData = useMemo(
    () => ({
      headers: ["Name", "Ring", "Quadrant", "Moved At", "Description"],
      rows: blips.map((b) => [
        b.name,
        b.ring,
        QUADRANTS.find((q) => q.id === b.quadrant)?.label ?? b.quadrant,
        b.movedAt,
        b.description ?? "",
      ]),
    }),
    [blips]
  );

  // Pre-project all blips for the SVG.
  const projected = useMemo(
    () => blips.map((b) => ({ blip: b, ...projectBlip(b) })),
    [blips]
  );

  return (
    <ToolPageWrapper
      toolId="tech-radar"
      title="Tech Radar"
      description="Thoughtworks-style adopt / trial / assess / hold quadrants for languages, frameworks, and tools."
      category="Team Health & Maturity"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="tech-radar" csvData={csvData} jsonData={blips} />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Compass}
          label="Total blips"
          value={blips.length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Activity}
          label="By ring"
          value={`${blipsByRing.adopt.length}/${blipsByRing.trial.length}/${blipsByRing.assess.length}/${blipsByRing.hold.length}`}
          hint="adopt/trial/assess/hold"
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Recently moved"
          value={recentlyMoved}
          hint="last 30 days"
        />
        <StatCard
          variant="compact"
          icon={ShieldAlert}
          label="On hold"
          value={blipsByRing.hold.length}
          tone={blipsByRing.hold.length > 0 ? "warning" : "default"}
        />
      </KpiGrid>

      <div className="rounded-lg border border-border bg-surface p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-sub mb-3">
          Add blip
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Bun, RSC, Postgres)"
            className="bg-bg border-border text-sm"
            aria-label="Blip name"
          />
          <Select value={ring} onValueChange={(v) => setRing(v as Ring)}>
            <SelectTrigger
              className="bg-bg border-border text-sm"
              aria-label="Ring"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RINGS.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={quadrant}
            onValueChange={(v) => setQuadrant(v as Quadrant)}
          >
            <SelectTrigger
              className="bg-bg border-border text-sm"
              aria-label="Quadrant"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUADRANTS.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description / rationale (optional)..."
          rows={2}
          className="bg-bg border-border text-sm resize-none mb-2"
          aria-label="Description"
        />
        <div className="flex justify-end">
          <Button
            onClick={addBlip}
            disabled={!name.trim()}
            className="gap-2 bg-accent text-bg hover:bg-accent/90"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add blip
          </Button>
        </div>
      </div>

      {blips.length === 0 ? (
        <EmptyState icon={Compass}>
          No blips yet. Add the first technology, language, or technique above.
        </EmptyState>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Radar SVG */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-sub mb-2">
            Radar
          </div>
          <div className="flex justify-center">
            <svg
              viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
              className="w-full max-w-[300px] h-auto"
              role="img"
              aria-label="Technology radar chart"
            >
              {/* Wedges for visual structure (faint quadrant separation). */}
              {QUADRANTS.map((_, qi) =>
                RINGS.map((_, ri) => (
                  <path
                    key={`${qi}-${ri}`}
                    d={quadrantWedge(qi, ri)}
                    fill={ri % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)"}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={1}
                  />
                ))
              )}
              {/* Cross-hairs for quadrant divisions */}
              <line
                x1={RADAR_CENTER}
                y1={RADAR_CENTER - RADAR_RADIUS}
                x2={RADAR_CENTER}
                y2={RADAR_CENTER + RADAR_RADIUS}
                stroke="rgba(255,255,255,0.18)"
              />
              <line
                x1={RADAR_CENTER - RADAR_RADIUS}
                y1={RADAR_CENTER}
                x2={RADAR_CENTER + RADAR_RADIUS}
                y2={RADAR_CENTER}
                stroke="rgba(255,255,255,0.18)"
              />
              {/* Ring labels (only on the right edge of each ring, top-right
                  quadrant, so they don't overlap blips). */}
              {RINGS.map((r, i) => {
                const ringMidR =
                  ((i + 0.5) / 4) * RADAR_RADIUS;
                return (
                  <text
                    key={r.id}
                    x={RADAR_CENTER + ringMidR}
                    y={RADAR_CENTER - 4}
                    fontSize={9}
                    fill="rgba(255,255,255,0.45)"
                    textAnchor="middle"
                    className="font-data"
                  >
                    {r.label}
                  </text>
                );
              })}
              {/* Blip dots */}
              {projected.map(({ blip, x, y }) => {
                const color =
                  RINGS.find((r) => r.id === blip.ring)?.color ?? "#00f0ff";
                return (
                  <g key={blip.id}>
                    <circle
                      cx={x}
                      cy={y}
                      r={5}
                      fill={color}
                      stroke="#0a0a0f"
                      strokeWidth={1}
                    >
                      <title>
                        {blip.name} — {blip.ring}
                      </title>
                    </circle>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3 text-[11px]">
            {RINGS.map((r) => (
              <span key={r.id} className="flex items-center gap-1 text-sub">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: r.color }}
                />
                {r.label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 mt-3 text-[10px] text-sub">
            {QUADRANTS.map((q) => (
              <div key={q.id} className="border border-border rounded px-1.5 py-0.5">
                {q.label}
              </div>
            ))}
          </div>
        </div>

        {/* Blip list grouped by ring */}
        <div className="space-y-3">
          {RINGS.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <div
                className="text-xs uppercase tracking-wider mb-2 font-data"
                style={{ color: r.color }}
              >
                {r.label} ({blipsByRing[r.id].length})
              </div>
              {blipsByRing[r.id].length === 0 ? (
                <p className="text-xs text-sub">No blips in this ring.</p>
              ) : (
                <div className="space-y-1.5">
                  {blipsByRing[r.id].map((b) => (
                    <div
                      key={b.id}
                      className="rounded-md border border-border bg-bg p-2 text-xs"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-text font-medium break-words">
                            {b.name}
                          </div>
                          <div className="text-sub">
                            {QUADRANTS.find((q) => q.id === b.quadrant)?.label}
                          </div>
                          {b.description && (
                            <div className="text-sub whitespace-pre-wrap mt-1 break-words">
                              {b.description}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Select
                            value={b.ring}
                            onValueChange={(v) => moveBlip(b.id, v as Ring)}
                          >
                            <SelectTrigger
                              className="h-7 text-xs bg-surface border-border w-20"
                              aria-label={`Move ${b.name} to ring`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RINGS.map((rr) => (
                                <SelectItem
                                  key={rr.id}
                                  value={rr.id}
                                  className="text-xs"
                                >
                                  {rr.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeBlip(b.id)}
                            className="h-7 w-7 p-0 text-sub hover:text-danger"
                            aria-label={`Remove ${b.name}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
    </ToolPageWrapper>
  );
}
