"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import {
  Crosshair,
  FlaskConical,
  Lightbulb,
  Plus,
  Settings2,
  Trash2,
  UserRound,
  Waypoints,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ProductGoalLine, useActiveProductGoal } from "@/components/product-goal/product-goal-line";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { ChecksList } from "@/components/strategy-map/checks-list";
import { DeleteNodeDialog } from "@/components/strategy-map/delete-dialog";
import { LevelTree } from "@/components/strategy-map/level-tree";
import { NodeCard } from "@/components/strategy-map/node-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { generateImpactMapPrompts } from "@/lib/ai-prompts/impact-map";
import {
  IMPACT_DRAFT_CONTEXT_MAX,
  IMPACT_DRAFT_EXISTING_MAX,
  IMPACT_DRAFT_PERSONAS_MAX,
  IMPACT_DRAFT_TEXT_MAX,
  impactMapDraftTask,
  type DraftedActor,
} from "@/lib/ai/tasks/impact-map.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { cheer } from "@/lib/celebrate/cheer";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { IMPACT_MAP_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HYPOTHESIS_TRACKER_ID, linkedTest, type LinkedTest } from "@/lib/hypotheses/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Hypothesis,
  HypothesisTracker,
  Persona,
  ProductGoal,
  StrategyMap,
  StrategyMapNode,
  Workspace,
} from "@/lib/stores/workspace-types";
import { mapChecks } from "@/lib/strategy-map/checks";
import { actorDraftNodes, fitDraftNodes } from "@/lib/strategy-map/drafts";
import { deliverableIdeas } from "@/lib/strategy-map/ideas";
import {
  MAP_FULL,
  MAP_TITLE_MAX,
  STRATEGY_NODES_MAX,
  TOO_BIG,
  applyNodeValues,
  branchOf,
  canAddUnder,
  childrenOf,
  cleanText,
  fitsRow,
  focusFirstSet,
  focusOf,
  keepOneFocus,
  levelCounts,
  newStrategyMap,
  newestFirst,
  nodeTitle,
  readStrategyMap,
  readStrategyMaps,
  rootOf,
  validateNode,
  withFocus,
  withNode,
  withNodePatch,
  withNodes,
  type NodeValues,
} from "@/lib/strategy-map/model";
import { deliverableSource, impactHypothesisSource } from "@/lib/strategy-map/send";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { todayLocalISO } from "@/lib/utils/formatters";
import { buildExample } from "./example";
import type { NewMapValues } from "./form";
import { MapDetailsForm } from "./map-details";
import { impactMapMarkdown, sentText } from "./markdown";
import { NewMapForm } from "./new-map-form";
import { PersonaSelect, personaLabel } from "./persona-select";
import { focusFirst, goalClosedLine, impactPaths, pathLine } from "./view";

// Stable empty lists: zustand re-renders forever on a selector that returns a fresh array.
const NO_ROWS: StrategyMap[] = [];
const NO_PERSONAS: Persona[] = [];
const NO_GOALS: ProductGoal[] = [];
const NO_TRACKERS: HypothesisTracker[] = [];
const NO_HYPOTHESES: Hypothesis[] = [];

const FORMAT = "impact-map" as const;
const isImpactMap = (m: StrategyMap) => m.format === FORMAT;

/** "Testing: drafted · Open", "Tested: validated · Open". */
function testLabel(t: LinkedTest): string {
  if (t.state === "none") return "";
  if (t.state === "testing")
    return t.status === "running" ? "Testing: running" : "Testing: drafted";
  return `Tested: ${t.result}`;
}

/** The links `next` has that `prev` didn't: what a send just added. */
function addedLinks(prev: readonly HandoffLink[] | undefined, next: readonly HandoffLink[]) {
  const key = (l: HandoffLink) => `${l.route}\u0000${l.targetId}`;
  const had = new Set((prev ?? []).map(key));
  return next.filter((l) => !had.has(key(l)));
}

/** Which branches of the draft are still on offer. */
interface Suggested {
  actors: DraftedActor[];
  source: AiSource;
}

/**
 * Impact Map: a goal (why), the people who can move it (who), how each
 * must act differently (impacts) and what the team could build or do to
 * cause that change (deliverables). One impact is the focus; deliverables
 * go to the backlog or the roadmap, impacts to the Hypothesis Tracker,
 * each with Undo. The rules, checks and sources are lib/strategy-map's,
 * which tool.impact_map shares.
 */
export function ImpactMapClient() {
  const hydrated = useWorkspaceHydrated();
  const rows = useWorkspaceStore((s) => s.strategyMaps) ?? NO_ROWS;
  const personas = useWorkspaceStore((s) => s.personas) ?? NO_PERSONAS;
  const goals = useWorkspaceStore((s) => s.productGoals) ?? NO_GOALS;
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers) ?? NO_TRACKERS;
  // Read so "Sent · Open" follows a story or an epic deleted elsewhere.
  useWorkspaceStore((s) => s.stories);
  useWorkspaceStore((s) => s.epicRoadmaps);
  const hypotheses =
    trackers.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? NO_HYPOTHESES;
  const activeGoal = useActiveProductGoal();
  // The personas a draft may name: the library's own main and secondary ones.
  const draftPersonas = useMemo(
    () => personas.filter((p) => !isExampleId(p.id) && p.tier !== "anti" && p.name.trim()),
    [personas]
  );
  const { log } = useHistoryLogger("impact-map");
  const announce = useAnnounce();

  const maps = useMemo(() => newestFirst(readStrategyMaps(rows).filter(isImpactMap)), [rows]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [wanted, setWanted] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"tree" | "paths">("tree");
  const [pendingDelete, setPendingDelete] = useState<StrategyMapNode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const [ideasFor, setIdeasFor] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<{ nodeId: string; text: string; n: number } | null>(
    null
  );
  const [context, setContext] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const newMapRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const closeDetails = () => {
    setEditingDetails(false);
    requestAnimationFrame(() => detailsRef.current?.focus());
  };
  const askRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const open = maps.find((m) => m.id === openId) ?? maps[0];
  const today = todayLocalISO();

  // A ?map= link opens that map once it has loaded, then leaves the address,
  // so the same link works again.
  useEffect(() => {
    if (!wanted || !hydrated) return;
    if (maps.some((m) => m.id === wanted)) setOpenId(wanted);
    setWanted(null);
    dropSearchParam("map");
  }, [wanted, hydrated, maps]);

  /* ── Writes ── */

  const ws = () => useWorkspaceStore.getState();
  const freshMap = (id: string) =>
    readStrategyMap((ws().strategyMaps ?? []).find((m) => m.id === id)) ?? undefined;
  /** Apply `fn` to the map as stored now; refused (and said inline) when it would grow past its row. */
  const write = (id: string, fn: (m: StrategyMap) => StrategyMap): StrategyMap | null => {
    const current = freshMap(id);
    if (!current) return null;
    const next = { ...fn(current), updatedAt: new Date().toISOString() };
    if (!fitsRow(next) && jsonBytes(next) > jsonBytes(current)) {
      setNotice(TOO_BIG);
      return null;
    }
    setNotice(null);
    ws().upsertStrategyMap(next);
    return next;
  };
  // Example maps aren't the team's history.
  const record = (mapId: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(mapId)) log(action, payload);
  };
  const focusEdit = (id: string | undefined) =>
    requestAnimationFrame(() => {
      const el = id
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-node-edit]")).find(
            (b) => b.getAttribute("data-node-edit") === id
          )
        : undefined;
      (el ?? newMapRef.current)?.focus();
    });

  function createMap(v: NewMapValues) {
    const now = new Date().toISOString();
    const map = newStrategyMap({
      id: `strategyMap_${nanoid(8)}`,
      rootId: nanoid(8),
      format: FORMAT,
      root: v.goal,
      ...(v.measure ? { measure: v.measure } : {}),
      ...(v.targetDate ? { targetDate: v.targetDate } : {}),
      ...(v.productGoalId ? { productGoalId: v.productGoalId } : {}),
      now,
    });
    ws().upsertStrategyMap(map);
    setOpenId(map.id);
    setCreating(false);
    setSuggested(null);
    record(map.id, IMPACT_MAP_ACTIONS.MAP_CREATED, {
      mapId: map.id,
      ...(v.productGoalId ? { productGoalId: v.productGoalId } : {}),
    });
    announce(`Started the impact map “${map.title}”`);
    focusEdit(map.nodes[0].id);
  }

  function removeMap(map: StrategyMap) {
    const snapshot = freshMap(map.id) ?? map;
    undoable({
      label: `Deleted the impact map “${snapshot.title}”`,
      apply: () => ws().removeStrategyMap(map.id),
      revert: () => ws().upsertStrategyMap(snapshot),
    });
    if (openId === map.id) setOpenId(null);
    setSuggested(null);
    record(map.id, IMPACT_MAP_ACTIONS.MAP_REMOVED, { mapId: map.id, nodes: snapshot.nodes.length });
    announce(`Deleted the impact map “${snapshot.title}”`);
    requestAnimationFrame(() => newMapRef.current?.focus());
  }

  function saveDetails(map: StrategyMap, title: string, targetDate: string) {
    const t = cleanText(title, MAP_TITLE_MAX);
    if (!t) return;
    const next = write(map.id, (m) => {
      const out: StrategyMap = { ...m, title: t };
      if (targetDate) out.targetDate = targetDate;
      else delete out.targetDate;
      return out;
    });
    if (!next) return;
    record(map.id, IMPACT_MAP_ACTIONS.MAP_UPDATED, { mapId: map.id });
    announce("Saved the map");
  }

  function addNode(map: StrategyMap, parent: StrategyMapNode, values: NodeValues) {
    if (!canAddUnder(map, parent)) return;
    const node = applyNodeValues(
      { id: nanoid(8), parentId: parent.id, level: (parent.level + 1) as 1 | 2 | 3, text: "" },
      values,
      FORMAT
    );
    if (!write(map.id, (m) => withNode(m, node))) return;
    record(map.id, IMPACT_MAP_ACTIONS.NODE_ADDED, {
      mapId: map.id,
      nodeId: node.id,
      level: node.level,
    });
    announce(`Added “${nodeTitle(node, FORMAT)}” under “${nodeTitle(parent, FORMAT)}”`);
  }

  function saveNode(map: StrategyMap, node: StrategyMapNode, values: NodeValues) {
    const next = applyNodeValues(node, values, FORMAT);
    if (JSON.stringify(next) === JSON.stringify(node)) return;
    // The map's name follows its goal while it is the goal's text.
    const retitle = node.parentId === null && map.title.trim() === node.text.trim();
    const saved = write(map.id, (m) => ({
      ...m,
      ...(retitle ? { title: next.text } : {}),
      nodes: m.nodes.map((n) => (n.id === node.id ? applyNodeValues(n, values, FORMAT) : n)),
    }));
    if (!saved) return;
    record(map.id, IMPACT_MAP_ACTIONS.NODE_UPDATED, { mapId: map.id, nodeId: node.id });
    announce(`Saved “${nodeTitle(next, FORMAT)}”`);
  }

  /** A part with nothing under it goes at once; one with parts under it asks first. Undo either way. */
  function askDelete(map: StrategyMap, node: StrategyMapNode) {
    if (node.parentId === null) {
      if (map.nodes.length > 1) setPendingDelete(node);
      else removeMap(map);
      return;
    }
    if (branchOf(map, node.id).length > 1) setPendingDelete(node);
    else removeNode(map, node);
  }

  function removeNode(map: StrategyMap, node: StrategyMapNode) {
    if (node.parentId === null) return removeMap(map);
    const current = freshMap(map.id) ?? map;
    const ids = new Set(branchOf(current, node.id).map((n) => n.id));
    const label =
      ids.size > 1
        ? `Deleted “${nodeTitle(node, FORMAT)}” and ${ids.size - 1} below it`
        : `Deleted “${nodeTitle(node, FORMAT)}”`;
    removeWithUndo<StrategyMapNode>({
      label,
      // Undo puts the branch back; a focus in it gives way to one picked meanwhile.
      update: (fn) => write(map.id, (m) => ({ ...m, nodes: keepOneFocus(m.nodes, fn(m.nodes)) })),
      match: (n) => ids.has(n.id),
    });
    record(map.id, IMPACT_MAP_ACTIONS.NODE_REMOVED, {
      mapId: map.id,
      nodeId: node.id,
      removed: ids.size,
    });
    announce(label);
    focusEdit(node.parentId);
  }

  function toggleFocus(map: StrategyMap, impact: StrategyMapNode) {
    const before = freshMap(map.id) ?? map;
    const on = !impact.focus;
    const after = write(map.id, (m) => withFocus(m, on ? impact.id : null));
    if (!after) return;
    if (focusFirstSet(before, after)) {
      if (!isExampleId(map.id)) {
        log(IMPACT_MAP_ACTIONS.FOCUS_SET, { mapId: map.id, nodeId: impact.id });
        cheer("impact-map", "agreed");
      }
    } else {
      record(map.id, IMPACT_MAP_ACTIONS.FOCUS_CHANGED, {
        mapId: map.id,
        nodeId: on ? impact.id : null,
      });
    }
    announce(
      on
        ? `“${nodeTitle(impact, FORMAT)}” is the impact to work on first`
        : `No impact is picked to work on first`
    );
  }

  const linkStore = (map: StrategyMap, node: StrategyMapNode) => ({
    getLinks: () => freshMap(map.id)?.nodes.find((n) => n.id === node.id)?.sentTo,
    setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      const before = freshMap(map.id)?.nodes.find((n) => n.id === node.id)?.sentTo;
      const next = update(before);
      write(map.id, (m) =>
        withNodePatch(m, node.id, { sentTo: next.length > 0 ? next : undefined })
      );
      // A send adds a live link. An Undo may put back an older, dead one: not a send.
      for (const link of addedLinks(before, next)) {
        if (link.route === "hypothesis" || liveLink(next, link.route) !== link) continue;
        record(map.id, IMPACT_MAP_ACTIONS.DELIVERABLE_SENT, {
          mapId: map.id,
          nodeId: node.id,
          route: link.route,
        });
      }
    },
  });

  function testImpact(map: StrategyMap, impact: StrategyMapNode) {
    const current = freshMap(map.id) ?? map;
    const fresh = current.nodes.find((n) => n.id === impact.id) ?? impact;
    const link = sendHandoff(
      "hypothesis",
      impactHypothesisSource(current, fresh),
      linkStore(map, impact)
    );
    if (!link) return;
    record(map.id, IMPACT_MAP_ACTIONS.IMPACT_TESTED, { mapId: map.id, nodeId: impact.id });
    announce(`“${nodeTitle(impact, FORMAT)}” is now a hypothesis to test`);
  }

  /** Add drafted branches under the goal, with one Undo, up to the map's cap. */
  function acceptDrafts(map: StrategyMap, drafts: readonly DraftedActor[], source: AiSource) {
    const current = freshMap(map.id) ?? map;
    const root = rootOf(current);
    if (!root) return;
    const all = drafts.flatMap((d) => actorDraftNodes(d, root.id, draftPersonas, () => nanoid(8)));
    const fit = fitDraftNodes(current, all);
    if (fit.nodes.length === 0) {
      setNotice(MAP_FULL);
      return;
    }
    const ids = new Set(fit.nodes.map((n) => n.id));
    const actors = fit.nodes.filter((n) => n.level === 1).length;
    undoable({
      label: `Added ${actors === 1 ? `“${nodeTitle(fit.nodes[0], FORMAT)}”` : `${actors} actors`} to the map`,
      kind: "success",
      apply: () => write(map.id, (m) => withNodes(m, fit.nodes)),
      revert: () => write(map.id, (m) => ({ ...m, nodes: m.nodes.filter((n) => !ids.has(n.id)) })),
    });
    record(map.id, IMPACT_MAP_ACTIONS.DRAFT_ACCEPTED, {
      mapId: map.id,
      source: source === "ai" ? "ai" : "rules",
      nodes: fit.nodes.length,
    });
    const left =
      fit.left > 0
        ? ` ${fit.left} ${fit.left === 1 ? "part was" : "parts were"} left out: a map holds at most ${STRATEGY_NODES_MAX}.`
        : "";
    setNotice(left ? left.trim() : null);
    announce(`Added ${fit.nodes.length} parts.${left}`);
  }

  const loadExample = () => {
    const example = buildExample();
    ws().upsertStrategyMap(example);
    setOpenId(example.id);
  };
  const clearExample = () => {
    for (const m of ws().strategyMaps ?? []) if (isExampleId(m.id)) ws().removeStrategyMap(m.id);
    setOpenId(null);
    setSuggested(null);
  };

  /* ── Exports and prompts ── */

  const linkedGoal = open?.productGoalId
    ? goals.find((g) => g.id === open.productGoalId)
    : undefined;
  const markdown = open ? impactMapMarkdown(open, { goal: linkedGoal, hypotheses, today }) : "";
  const csvData = {
    headers: ["Goal", "Actor", "Impact", "Focus", "Deliverable", "Where it went"],
    rows: open
      ? impactPaths(open).map((p) => [
          p.goal.text,
          p.actor?.text ?? "",
          p.impact?.text ?? "",
          p.focus ? "yes" : "",
          p.deliverable?.text ?? "",
          p.deliverable ? sentText(p.deliverable) : "",
        ])
      : [],
  };
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
  const promptConfig = useMemo(
    () => ({
      toolName: "Impact Map",
      prompts: generateImpactMapPrompts({ map: open, hypotheses }, workspace),
    }),
    [open, hypotheses, workspace]
  );

  /* ── Drawing one map ── */

  const renderNode = (map: StrategyMap, node: StrategyMapNode) => {
    const example = isExampleId(map.id);
    const persona = node.personaId ? personas.find((p) => p.id === node.personaId) : undefined;
    const test = linkedTest(node.sentTo, hypotheses);
    const parent = node.parentId ? map.nodes.find((n) => n.id === node.parentId) : undefined;
    const draftHere = addDraft?.nodeId === node.id ? addDraft : null;
    const ideas =
      node.level === 2 && ideasFor === node.id
        ? deliverableIdeas(
            parent ? nodeTitle(parent, FORMAT) : "them",
            node.text,
            childrenOf(map, node.id).map((c) => c.text)
          )
        : null;
    return (
      <NodeCard
        format={FORMAT}
        node={node}
        canAdd={canAddUnder(map, node)}
        example={example}
        validate={(d, level) => validateNode(d, { format: FORMAT, level })}
        onSave={(n, v) => saveNode(map, n, v)}
        onAdd={(p, v) => {
          addNode(map, p, v);
          setAddDraft(null);
        }}
        onDelete={(n) => askDelete(map, n)}
        highlight={node.focus}
        addDraft={draftHere}
        extraFields={(form, level) =>
          level === 1 ? (
            <PersonaSelect
              personas={personas}
              value={form.draft.personaId}
              onChange={(personaId, p) =>
                form.update({
                  personaId,
                  ...(p && !form.draft.text.trim()
                    ? { text: cleanText(p.name, IMPACT_DRAFT_TEXT_MAX) }
                    : {}),
                })
              }
            />
          ) : null
        }
        badges={
          <>
            {node.focus && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 align-middle text-xs font-normal text-accent">
                <Crosshair className="h-3 w-3" aria-hidden="true" />
                Work on this first
              </span>
            )}
            {persona && (
              <Link
                href={`/persona-library?persona=${encodeURIComponent(persona.id)}`}
                className="ml-2 inline-flex max-w-full items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 align-middle text-xs font-normal text-info hover:underline"
              >
                <UserRound className="h-3 w-3" aria-hidden="true" />
                {personaLabel(persona)}
              </Link>
            )}
          </>
        }
        footer={
          <>
            {node.level === 1 && !persona && !example && (
              <Link
                href={`/persona-library?fromMap=${encodeURIComponent(map.id)}&actor=${encodeURIComponent(node.id)}`}
                className="min-touch-coarse mt-1 inline-flex items-center text-xs text-accent underline-offset-2 hover:underline"
              >
                Make a persona for this actor
              </Link>
            )}
            {node.level === 2 && test.state !== "none" && (
              <Link
                href={getHandoffRoute("hypothesis").targetHref(test.hypothesisId)}
                className={cn(
                  "min-touch-coarse mt-1 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline",
                  test.state === "tested" ? "text-success" : "text-accent"
                )}
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                {testLabel(test)} · Open
              </Link>
            )}
            {ideas && (
              <div className="mt-2 space-y-1.5 rounded-md border border-dashed border-border p-2">
                <p className="text-xs font-medium text-text">Ideas for deliverables (no AI)</p>
                {ideas.length === 0 ? (
                  <p className="text-xs text-sub">This impact has all three already.</p>
                ) : (
                  <ul className="space-y-1">
                    {ideas.map((idea) => (
                      <li
                        key={idea}
                        className="flex items-start justify-between gap-2 text-xs text-text"
                      >
                        <span className="min-w-0 break-words">{idea}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2 text-xs"
                          disabled={example || !canAddUnder(map, node)}
                          aria-label={`Use: ${idea}`}
                          onClick={() =>
                            setAddDraft({ nodeId: node.id, text: idea, n: Date.now() })
                          }
                        >
                          Use
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        }
        actions={
          node.level === 2 ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={Boolean(node.focus)}
                aria-label={`Work on this first: ${nodeTitle(node, FORMAT)}`}
                className={cn(
                  "min-touch-coarse gap-1 text-xs",
                  node.focus ? "text-accent hover:bg-accent/10" : "text-sub hover:bg-accent/10"
                )}
                onClick={() => toggleFocus(map, node)}
              >
                <Crosshair className="h-4 w-4" aria-hidden="true" />
                Work on this first
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={ideasFor === node.id}
                aria-label={`Suggest deliverables for ${nodeTitle(node, FORMAT)}`}
                className="min-touch-coarse gap-1 text-xs text-sub hover:bg-accent/10"
                onClick={() => setIdeasFor((v) => (v === node.id ? null : node.id))}
              >
                <Lightbulb className="h-4 w-4" aria-hidden="true" />
                Suggest deliverables
              </Button>
              {test.state === "none" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs"
                  disabled={example}
                  aria-label={`Test this impact: ${nodeTitle(node, FORMAT)}`}
                  onClick={() => testImpact(map, node)}
                >
                  <FlaskConical className="h-4 w-4" aria-hidden="true" />
                  Test this impact
                </Button>
              )}
            </>
          ) : node.level === 3 ? (
            <SendToMenu
              routes={["backlog-story", "epic"]}
              itemLabels={{ "backlog-story": "Backlog story", epic: "Epic on the roadmap" }}
              item={deliverableSource(map, node)}
              sentTo={node.sentTo}
              disabled={example}
              getLinks={linkStore(map, node).getLinks}
              onLinksChange={linkStore(map, node).setLinks}
            />
          ) : null
        }
      />
    );
  };

  const counts = open ? levelCounts(open) : [0, 0, 0, 0];
  const focus = open ? focusOf(open) : undefined;
  const checks = open ? mapChecks(open, hypotheses) : [];
  const closedLine = linkedGoal ? goalClosedLine(linkedGoal) : null;

  return (
    <ToolPageWrapper
      toolId="impact-map"
      title="Impact Map"
      description="From a goal to who can move it, how, and what to build."
    >
      <OnSearchParams
        onChange={(search) => {
          const id = search.get("map");
          if (id) setWanted(id);
        }}
      />
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(maps) && <ExampleNotice onClear={clearExample} />}
        <ActionRow>
          {open && (
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="impact-map"
                csvData={csvData}
                jsonData={open}
                markdown={markdown}
                targetRef={exportRef}
              />
            </>
          )}
          {!creating && (
            <Button
              ref={newMapRef}
              variant="toolkit"
              className="gap-2"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New impact map
            </Button>
          )}
        </ActionRow>

        {creating && (
          <NewMapForm
            activeGoal={activeGoal}
            onCreate={createMap}
            onCancel={() => {
              setCreating(false);
              requestAnimationFrame(() => newMapRef.current?.focus());
            }}
          />
        )}

        {notice && (
          <p
            role="status"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
          >
            {notice}
          </p>
        )}

        {maps.length === 0
          ? hydrated &&
            !creating && (
              <EmptyState icon={Waypoints} action={<LoadExampleButton onLoad={loadExample} />}>
                No impact maps yet. Start from a goal, or from your Product Goal, then add who can
                move it, how they would act differently, and what you could build. Or load an
                example.
              </EmptyState>
            )
          : open && (
              <>
                {maps.length > 1 && (
                  <nav aria-label="Your impact maps">
                    <ul className="flex flex-wrap gap-2">
                      {maps.map((m) => (
                        <li key={m.id}>
                          <Button
                            type="button"
                            size="sm"
                            variant={m.id === open.id ? "toolkit" : "outline"}
                            aria-current={m.id === open.id ? "true" : undefined}
                            className="max-w-[16rem] truncate text-xs"
                            onClick={() => {
                              setOpenId(m.id);
                              setSuggested(null);
                            }}
                          >
                            {m.title}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}

                <section aria-labelledby="map-heading" className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 id="map-heading" className="break-words text-lg font-semibold text-text">
                        {open.title}
                      </h2>
                      <p className="text-xs text-sub">
                        {counts[1]} {counts[1] === 1 ? "actor" : "actors"}, {counts[2]}{" "}
                        {counts[2] === 1 ? "impact" : "impacts"}, {counts[3]}{" "}
                        {counts[3] === 1 ? "deliverable" : "deliverables"}
                        {open.targetDate ? ` · due ${open.targetDate}` : ""}
                        {focus ? ` · working on “${nodeTitle(focus, FORMAT)}” first` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        ref={detailsRef}
                        label={`Edit the map's name and date: ${open.title}`}
                        icon={<Settings2 className="h-4 w-4" />}
                        className="text-sub hover:text-text"
                        aria-expanded={editingDetails}
                        onClick={() => setEditingDetails((v) => !v)}
                      />
                      <IconButton
                        label={`Delete the map ${open.title}`}
                        icon={<Trash2 className="h-4 w-4" />}
                        className="text-sub hover:text-danger"
                        onClick={() => {
                          // A map with no parts (an agent can make one) has no goal to ask about.
                          const root = rootOf(open);
                          if (root) askDelete(open, root);
                          else removeMap(open);
                        }}
                      />
                    </div>
                  </div>

                  {editingDetails && (
                    <MapDetailsForm
                      key={open.id}
                      map={open}
                      onSave={(t, d) => {
                        saveDetails(open, t, d);
                        closeDetails();
                      }}
                      onCancel={closeDetails}
                    />
                  )}

                  {linkedGoal && (
                    <ProductGoalLine goal={linkedGoal}>
                      {closedLine && <p className="text-xs text-sub">{closedLine}</p>}
                    </ProductGoalLine>
                  )}

                  <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                    <h3 className="text-sm font-semibold text-text">Draft with Amr</h3>
                    <label className="block space-y-1.5 text-sm text-text">
                      <span>Anything Amr should know</span>
                      <Textarea
                        rows={2}
                        maxLength={1000}
                        value={context}
                        onChange={(e) => setContext(e.target.value)}
                        aria-describedby="impact-context-hint"
                      />
                    </label>
                    <p id="impact-context-hint" className="text-xs text-sub">
                      Optional, and not saved. Amr drafts actors and impacts for you to accept one
                      by one; without AI you get a template to rewrite.
                    </p>
                    <div ref={askRef}>
                      <AiButton
                        task={impactMapDraftTask}
                        label="Ask Amr to draft the map"
                        fallbackLabel="Start from a template"
                        disabledReason={rootOf(open) ? null : "The map needs its goal first."}
                        input={() => {
                          const root = rootOf(open);
                          const why = (linkedGoal?.why ?? "").trim().slice(0, 1000);
                          return {
                            goal: cleanText(root?.text, IMPACT_DRAFT_TEXT_MAX),
                            ...(root?.measure
                              ? { measure: cleanText(root.measure, IMPACT_DRAFT_TEXT_MAX) }
                              : {}),
                            context: [why, context.trim().slice(0, 1000)]
                              .filter(Boolean)
                              .join("\n")
                              .slice(0, IMPACT_DRAFT_CONTEXT_MAX),
                            personas: draftPersonas
                              .slice(0, IMPACT_DRAFT_PERSONAS_MAX)
                              .map((p) => ({
                                name: cleanText(p.name, IMPACT_DRAFT_TEXT_MAX),
                                role: cleanText(p.role, IMPACT_DRAFT_TEXT_MAX),
                              })),
                            actors: childrenOf(open, root?.id ?? "")
                              .map((a) => cleanText(a.text, IMPACT_DRAFT_TEXT_MAX))
                              .filter(Boolean)
                              .slice(0, IMPACT_DRAFT_EXISTING_MAX),
                          };
                        }}
                        onResult={(data, meta) => {
                          setSuggested({ actors: data.actors, source: meta.source });
                          announce(
                            `${data.actors.length} suggested ${data.actors.length === 1 ? "actor" : "actors"} below.`
                          );
                        }}
                      />
                    </div>
                    {suggested && (
                      <AiSuggestions
                        items={suggested.actors}
                        source={suggested.source}
                        title="Suggested actors and impacts"
                        render={(a) => ({
                          title: a.name,
                          detail: a.impacts
                            .map((i) =>
                              i.deliverables.length > 0
                                ? `${i.text}: ${i.deliverables.join(", ")}`
                                : i.text
                            )
                            .join(" · "),
                        })}
                        onAccept={(a) => acceptDrafts(open, [a], suggested.source)}
                        onAcceptAll={(list) => acceptDrafts(open, list, suggested.source)}
                        onDismiss={() => setSuggested(null)}
                        returnFocus={() => askRef.current?.querySelector<HTMLElement>("button")}
                      />
                    )}
                  </div>

                  <ChecksList checks={checks} />

                  <ToggleGroup
                    label="View"
                    size="sm"
                    options={[
                      { value: "tree", label: "Tree" },
                      { value: "paths", label: "Paths" },
                    ]}
                    value={view}
                    onValueChange={setView}
                  />

                  {view === "tree" ? (
                    <LevelTree
                      map={open}
                      label="Impact map"
                      order={focusFirst(open)}
                      renderNode={(n) => renderNode(open, n)}
                    />
                  ) : (
                    <PathsView map={open} />
                  )}
                </section>
              </>
            )}
      </div>

      <DeleteNodeDialog
        map={open}
        node={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={(n) => {
          if (open) removeNode(open, n);
        }}
      />
    </ToolPageWrapper>
  );
}

/** Every path from the goal, the focus path first, with where each deliverable went. */
function PathsView({ map }: { map: StrategyMap }) {
  const paths = impactPaths(map).filter((p) => p.actor);
  if (paths.length === 0) {
    return <p className="text-sm text-sub">No paths yet: add an actor under the goal.</p>;
  }
  return (
    <ul className="space-y-2" aria-label="Paths">
      {paths.map((p) => {
        const went = p.deliverable ? sentText(p.deliverable) : "";
        return (
          <li
            key={p.key}
            className={cn(
              "rounded-lg border border-border bg-card px-3 py-2 text-sm text-text",
              p.focus && "border-accent/40"
            )}
          >
            <span className="break-words">{pathLine(map, p)}</span>
            {p.focus && <span className="ml-2 text-xs text-accent">Work on this first</span>}
            <span className="block text-xs text-sub">
              {p.deliverable ? (went ? `Went to: ${went}` : "Not sent yet") : "No deliverable yet"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
