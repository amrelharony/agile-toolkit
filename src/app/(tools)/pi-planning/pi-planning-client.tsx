"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { CalendarRange, Gauge, GitBranch, Plus, Target } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import {
  ExampleNotice,
  LoadExampleButton,
  exampleId,
  hasExampleItems,
} from "@/components/tool-frame/example-data";
import { generatePiPlanningPrompts } from "@/lib/ai-prompts/pi-planning";
import { plural } from "@/lib/charts/chart-text";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PI_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import type { DependencyStatus } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { SelectField } from "../dependency-map/fields";
import {
  linkDependency,
  releaseEdges,
  restoreReleased,
  setEdgeStatus,
  unlink,
  updateDependencyMap,
  useDependencyMap,
  type LinkResult,
  type ReleasedEdges,
} from "../dependency-map/link";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { TeamCard, type BoardActions, type Editing } from "./board";
import {
  boardHeir,
  itemRef,
  ownEdge,
  renameTeamOnMap,
  scopeOf,
  syncDependencyEdge,
} from "./dependency-link";
import { EXAMPLE_MAP_PREFIX, buildExample, withoutExample } from "./example";
import { TeamAddForm, type ItemValues, type ObjectiveValues, type TeamValues } from "./forms";
import { dependencyViews, isLegacyDependency, overloads, teamLoad, waitsOnTeam } from "./load";
import { LoadChart } from "./load-chart";
import { toMarkdown } from "./markdown";
import { ObjectivesPanel } from "./objectives";
import {
  MAX_ITERATIONS,
  usePiState,
  type PiItem,
  type PiObjective,
  type PiState,
  type PiTeam,
} from "./store";
import { piVerdict } from "./verdict";

type Placed<T> = { item: T; index: number }[];

/** The rows `match` picks, with their positions, so Undo can put them back where they were. */
const pick = <T,>(list: readonly T[], match: (x: T) => boolean): Placed<T> =>
  list.flatMap((item, index) => (match(item) ? [{ item, index }] : []));

/** `list` with `placed` rows back at their old positions (clamped), skipping any already there. */
function putBack<T extends { id: string }>(list: readonly T[], placed: Placed<T>): T[] {
  const next = [...list];
  const ids = new Set(list.map((x) => x.id));
  for (const { item, index } of placed) {
    if (!ids.has(item.id)) next.splice(Math.min(index, next.length), 0, item);
  }
  return next;
}

/** `obj` with `key` set, or without it when the value is undefined. */
function withOptional<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K] | undefined
) {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

type Confirm =
  | { kind: "team"; team: PiTeam; items: number; objectives: number }
  | { kind: "iterations"; next: number; items: number }
  | null;

export function PiPlanningClient() {
  const [state, update] = usePiState();
  const map = useDependencyMap();
  const today = todayLocalISO();
  const { log } = useHistoryLogger("pi-planning");
  const exportRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [editingObjective, setEditingObjective] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Where a moved item went, for screen readers (it re-renders in another cell).
  const [announcement, setAnnouncement] = useState("");
  const { refFor, returnTo } = useReturnFocus();

  /** Close the board's editor and put focus back on what opened it. */
  const closeEditor = () => {
    if (editing?.kind === "team") returnTo(`team:${editing.id}`);
    else if (editing?.kind === "item") returnTo(`item:${editing.id}`);
    else if (editing?.kind === "add") returnTo(`add:${editing.teamId}:${editing.iteration}`);
    setEditing(null);
  };

  const closeObjective = (id: string) => {
    setEditingObjective(null);
    returnTo(`objective:${id}`);
  };

  const teamOf = (id: string) => state.teams.find((t) => t.id === id);
  const objectives = state.objectives ?? [];
  const views = useMemo(
    () => new Map(dependencyViews(state, map, today).map((v) => [v.item.id, v])),
    [state, map, today]
  );
  const legacy = state.items.filter((i) => isLegacyDependency(i) && teamOf(i.teamId));
  // An old item titled like its own team would be a self-wait on the map: it stays to edit.
  const legacyTarget = (i: PiItem) => i.title || "Unnamed dependency";
  const movable = legacy.filter(
    (i) =>
      legacyTarget(i).trim().toLowerCase() !== (teamOf(i.teamId)?.name ?? "").trim().toLowerCase()
  );

  /* ── Teams ── */

  const addTeam = (v: TeamValues) => {
    const team: PiTeam = { id: nanoid(6), ...v };
    update((s) => ({ ...s, teams: [...s.teams, team] }));
    log(PI_PLANNING_ACTIONS.TEAM_ADDED, {
      teamId: team.id,
      name: team.name,
      description: team.description,
    });
  };

  const saveTeam = (team: PiTeam, v: TeamValues) => {
    closeEditor();
    // Its node on the map is renamed too, so its dependencies keep their team.
    renameTeamOnMap(state.items, team.id, team.name, v.name);
    update((s) => ({
      ...s,
      teams: s.teams.map((t) => {
        if (t.id !== team.id) return t;
        const next = withOptional({ ...t, name: v.name }, "velocity", v.velocity);
        return withOptional(next, "description", v.description);
      }),
    }));
  };

  /**
   * Remove a team with everything planned for it, and offer Undo. The
   * dependencies its items drew come off the map with them (Undo puts them
   * back too), unless another item still shows one; edges other tools drew
   * stay.
   */
  const removeTeam = (team: PiTeam) => {
    const leaving = state.items.filter((i) => i.teamId === team.id);
    const own = leaving.flatMap((i) => ownEdge(i)?.id ?? []);
    const heir = boardHeir(state.items, new Set(leaving.map((i) => i.id)));
    let released: ReleasedEdges = { taken: [], handed: [] };
    let removed: { team: Placed<PiTeam>; items: Placed<PiItem>; objectives: Placed<PiObjective> } =
      { team: [], items: [], objectives: [] };
    undoable({
      label: `Removed team “${team.name}”`,
      apply: () => {
        released = releaseEdges(own, heir);
        update((s) => {
          removed = {
            team: pick(s.teams, (t) => t.id === team.id),
            items: pick(s.items, (i) => i.teamId === team.id),
            objectives: pick(s.objectives ?? [], (o) => o.teamId === team.id),
          };
          return {
            ...s,
            teams: s.teams.filter((t) => t.id !== team.id),
            items: s.items.filter((i) => i.teamId !== team.id),
            objectives: (s.objectives ?? []).filter((o) => o.teamId !== team.id),
          };
        });
        log(PI_PLANNING_ACTIONS.TEAM_REMOVED, { teamId: team.id, name: team.name });
      },
      revert: () => {
        update((s) => ({
          ...s,
          teams: putBack(s.teams, removed.team),
          items: putBack(s.items, removed.items),
          objectives: putBack(s.objectives ?? [], removed.objectives),
        }));
        restoreReleased(released);
      },
    });
  };

  /** A team with nothing on it goes at once (with Undo); one with work asks first. */
  const requestRemoveTeam = (team: PiTeam) => {
    const items = state.items.filter((i) => i.teamId === team.id).length;
    const objs = objectives.filter((o) => o.teamId === team.id).length;
    if (items + objs > 0) setConfirm({ kind: "team", team, items, objectives: objs });
    else removeTeam(team);
  };

  /* ── Items ── */

  const addItem = (team: PiTeam, iteration: number, v: ItemValues) => {
    let item: PiItem = {
      id: nanoid(6),
      title: v.title,
      kind: v.kind,
      teamId: team.id,
      iteration,
      ...(v.points !== undefined ? { points: v.points } : {}),
      ...(v.description ? { description: v.description } : {}),
      ...(v.dependsOn ? { dependsOn: v.dependsOn } : {}),
    };
    if (item.kind === "dependency" && v.dependsOn) {
      const edgeId = syncDependencyEdge(null, item, {
        teamName: team.name,
        dependsOn: v.dependsOn,
        title: v.title,
        due: v.due || undefined,
      });
      item = withOptional(item, "edgeId", edgeId);
    }
    closeEditor();
    update((s) => ({ ...s, items: [...s.items, item] }));
    log(PI_PLANNING_ACTIONS.ITEM_ADDED, { itemId: item.id, teamId: team.id, iteration });
  };

  const saveItem = (item: PiItem, v: ItemValues) => {
    closeEditor();
    const team = teamOf(item.teamId);
    let next: PiItem = { ...item, title: v.title, kind: v.kind };
    next = withOptional(next, "points", v.points);
    next = withOptional(next, "description", v.description);
    next = withOptional(next, "dependsOn", v.dependsOn);
    const edgeId = syncDependencyEdge(
      item,
      next,
      {
        teamName: team?.name ?? "",
        dependsOn: v.dependsOn ?? "",
        title: v.title,
        due: v.due || null,
      },
      boardHeir(state.items, new Set([item.id]))
    );
    next = withOptional(next, "edgeId", edgeId);
    update((s) => ({ ...s, items: s.items.map((i) => (i.id === item.id ? next : i)) }));
    if (v.kind !== item.kind || v.points !== item.points) {
      log(PI_PLANNING_ACTIONS.ITEM_UPDATED, { itemId: item.id, kind: v.kind, points: v.points });
    }
  };

  /**
   * Move an item to another cell. It re-renders there as a new element, so
   * focus goes to its Move button in the new cell and a live region says
   * where it went. A dependency can't move into the team it waits on.
   */
  const moveItem = (item: PiItem, teamId: string, iteration: number) => {
    const target = teamOf(teamId);
    const view = views.get(item.id);
    if (!target || waitsOnTeam(view, target.name)) return;
    let next: PiItem = { ...item, teamId, iteration };
    if (item.kind === "dependency" && teamId !== item.teamId && view?.waitsOn) {
      // The waiting side changed: the edge follows the item to its new team.
      const edgeId = syncDependencyEdge(
        item,
        next,
        { teamName: target.name, dependsOn: view.waitsOn, title: item.title },
        boardHeir(state.items, new Set([item.id]))
      );
      next = withOptional(next, "edgeId", edgeId);
    }
    update((s) => ({ ...s, items: s.items.map((i) => (i.id === item.id ? next : i)) }));
    setAnnouncement(
      `Moved “${item.title || "item"}” to ${target.name || "team"}, iteration ${iteration + 1}.`
    );
    returnTo(`move:${item.id}`);
    log(PI_PLANNING_ACTIONS.ITEM_ASSIGNED, { itemId: item.id, teamId, iteration });
  };

  const removeItem = (item: PiItem) => {
    const own = ownEdge(item);
    const heir = boardHeir(state.items, new Set([item.id]));
    // A shared edge stays on the map with the item or entry that still shows it.
    const goes = own !== undefined && heir(own) === undefined;
    let released: ReleasedEdges = { taken: [], handed: [] };
    let removed: Placed<PiItem> = [];
    undoable({
      label: `Deleted “${item.title || "item"}”`,
      description: goes ? "and its dependency on the map" : undefined,
      apply: () => {
        released = releaseEdges(own ? [own.id] : [], heir);
        update((s) => {
          removed = pick(s.items, (i) => i.id === item.id);
          return { ...s, items: s.items.filter((i) => i.id !== item.id) };
        });
        log(PI_PLANNING_ACTIONS.ITEM_REMOVED, { itemId: item.id, title: item.title });
      },
      revert: () => {
        update((s) => ({ ...s, items: putBack(s.items, removed) }));
        restoreReleased(released);
      },
    });
  };

  const setStatus = (item: PiItem, status: DependencyStatus) => {
    if (item.edgeId) setEdgeStatus(item.edgeId, status);
  };

  /** Put a dependency whose edge was removed from the map back on it. */
  const relink = (item: PiItem) => {
    const team = teamOf(item.teamId);
    if (!team || !item.dependsOn) return;
    const edgeId = syncDependencyEdge(null, item, {
      teamName: team.name,
      dependsOn: item.dependsOn,
      title: item.title,
    });
    update((s) => ({
      ...s,
      items: s.items.map((i) => (i.id === item.id ? withOptional(i, "edgeId", edgeId) : i)),
    }));
  };

  /**
   * Dependency items saved before the map link name no other team. Each
   * goes on the map as "this team needs <the item>", which keeps what was
   * written; editing the item later can point it at a team instead.
   */
  const moveLegacyToMap = () => {
    let links: { itemId: string; result: LinkResult }[] = [];
    undoable({
      label: `Added ${movable.length} ${movable.length === 1 ? "dependency" : "dependencies"} to the Dependency Map`,
      apply: () => {
        links = movable.flatMap((item) => {
          const result = linkDependency(
            {
              from: teamOf(item.teamId)?.name ?? "",
              to: legacyTarget(item),
              note: item.description,
              sourceRef: itemRef(item),
            },
            undefined,
            scopeOf(item)
          );
          return result ? [{ itemId: item.id, result }] : [];
        });
        const byItem = new Map(links.map((l) => [l.itemId, l.result.edgeId]));
        update((s) => ({
          ...s,
          items: s.items.map((i) =>
            byItem.has(i.id) ? { ...i, edgeId: byItem.get(i.id), dependsOn: legacyTarget(i) } : i
          ),
        }));
      },
      revert: () => {
        [...links].reverse().forEach((l) => unlink(l.result));
        const ids = new Set(links.map((l) => l.itemId));
        update((s) => ({
          ...s,
          items: s.items.map((i) => {
            if (!ids.has(i.id)) return i;
            const next = { ...i };
            delete next.edgeId;
            delete next.dependsOn;
            return next;
          }),
        }));
      },
    });
  };

  /* ── Iterations ── */

  const shrink = (next: number) => {
    const doomed = state.items.filter((i) => i.iteration >= next);
    const own = doomed.flatMap((i) => ownEdge(i)?.id ?? []);
    const heir = boardHeir(state.items, new Set(doomed.map((i) => i.id)));
    let previous = state.iterations;
    let released: ReleasedEdges = { taken: [], handed: [] };
    let removed: Placed<PiItem> = [];
    undoable({
      label: `Cut the PI to ${next} ${next === 1 ? "iteration" : "iterations"}`,
      description: `${doomed.length} ${doomed.length === 1 ? "item" : "items"} removed`,
      apply: () => {
        released = releaseEdges(own, heir);
        update((s) => {
          previous = s.iterations;
          removed = pick(s.items, (i) => i.iteration >= next);
          return { ...s, iterations: next, items: s.items.filter((i) => i.iteration < next) };
        });
      },
      revert: () => {
        update((s) => ({ ...s, iterations: previous, items: putBack(s.items, removed) }));
        restoreReleased(released);
      },
    });
  };

  const setIterations = (next: number) => {
    if (!Number.isInteger(next) || next < 1 || next > MAX_ITERATIONS || next === state.iterations) {
      return;
    }
    const doomed = state.items.filter((i) => i.iteration >= next).length;
    if (next < state.iterations && doomed > 0)
      setConfirm({ kind: "iterations", next, items: doomed });
    else update((s) => ({ ...s, iterations: next }));
  };

  /* ── Objectives ── */

  const addObjective = (v: ObjectiveValues) => {
    const objective: PiObjective = { id: nanoid(6), ...v };
    update((s) => ({ ...s, objectives: [...(s.objectives ?? []), objective] }));
  };

  const saveObjective = (o: PiObjective, v: ObjectiveValues) => {
    closeObjective(o.id);
    update((s) => ({
      ...s,
      objectives: (s.objectives ?? []).map((x) => {
        if (x.id !== o.id) return x;
        const next = { ...x, teamId: v.teamId, title: v.title, committed: v.committed };
        return withOptional(next, "businessValue", v.businessValue);
      }),
    }));
  };

  const removeObjective = (o: PiObjective) => {
    let removed: Placed<PiObjective> = [];
    undoable({
      label: `Deleted objective “${o.title}”`,
      apply: () =>
        update((s) => {
          removed = pick(s.objectives ?? [], (x) => x.id === o.id);
          return { ...s, objectives: (s.objectives ?? []).filter((x) => x.id !== o.id) };
        }),
      revert: () => update((s) => ({ ...s, objectives: putBack(s.objectives ?? [], removed) })),
    });
  };

  /* ── Example ── */

  /**
   * Take the example's edges off the map, and its nodes unless one of the
   * user's own edges was drawn to it since: that node stays with it (the
   * Dependency Map's "Clear example" offers Undo for such edges).
   */
  const clearExampleEdges = () =>
    updateDependencyMap((m) => {
      const mine = (id: string) => id.startsWith(EXAMPLE_MAP_PREFIX);
      const edges = m.edges.filter((e) => !mine(e.id));
      return {
        nodes: m.nodes.filter(
          (n) => !mine(n.id) || edges.some((e) => e.from === n.id || e.to === n.id)
        ),
        edges,
      };
    });

  const loadExample = () => {
    clearExampleEdges();
    const { state: ex, links } = buildExample();
    let n = 0;
    const makeId = () => exampleId(`pi-map-${++n}`);
    const edgeOf = new Map(
      links.map((l) => {
        const item = ex.items.find((i) => i.id === l.itemId);
        // Among the example's own nodes only: never the user's "Checkout" or their edges.
        const result = linkDependency(
          {
            from: l.team,
            to: l.dependsOn,
            due: l.due,
            note: item?.title,
            sourceRef: itemRef({ id: l.itemId }),
          },
          makeId,
          EXAMPLE_MAP_PREFIX
        );
        return [l.itemId, result?.edgeId] as const;
      })
    );
    const items = ex.items.map((i) => (edgeOf.has(i.id) ? { ...i, edgeId: edgeOf.get(i.id) } : i));
    update((s) => {
      const base = withoutExample(s);
      return {
        ...base,
        iterations: base.teams.length === 0 ? ex.iterations : base.iterations,
        teams: [...base.teams, ...ex.teams],
        items: [...base.items, ...items],
        objectives: [...(base.objectives ?? []), ...(ex.objectives ?? [])],
      };
    });
  };

  const clearExample = () => {
    update(withoutExample);
    clearExampleEdges();
  };

  /* ── Derived ── */

  const over = overloads(state);
  const loads = state.teams.map((t) => teamLoad(state, t));
  const planned = loads.reduce((a, l) => a + l.planned, 0);
  // Capacity only means something against the same teams' plans: with some
  // teams unset, say so (as the verdict does) instead of comparing totals.
  const withVelocity = loads.filter((l) => l.capacity !== null);
  const capacity = withVelocity.reduce((a, l) => a + (l.capacity ?? 0), 0);
  const noVelocity = loads.length - withVelocity.length;
  const deps = Array.from(views.values());
  const openDeps = deps.filter((d) => d.status !== "resolved");
  const lateDeps = deps.filter((d) => d.overdue).length;

  const actions: BoardActions = {
    saveTeam,
    removeTeam: requestRemoveTeam,
    addItem,
    saveItem,
    moveItem,
    removeItem,
    setStatus,
    relink,
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "PI Planning Board",
      prompts: generatePiPlanningPrompts({
        teams: state.teams.map((t) => ({ ...t, velocity: t.velocity ?? 0 })),
        items: state.items.map((i) => ({ ...i, points: i.points ?? 0 })),
        iterations: state.iterations,
        overloads: over,
      }),
    }),
    [state, over]
  );

  const csvData = {
    headers: [
      "Team",
      "Team Description",
      "Iteration",
      "Item",
      "Item Description",
      "Points",
      "Kind",
      "Waits on",
      "Dependency status",
    ],
    rows: state.items.map((i): (string | number)[] => {
      const team = teamOf(i.teamId);
      const v = views.get(i.id);
      return [
        team?.name ?? "",
        team?.description ?? "",
        i.iteration + 1,
        i.title,
        i.description ?? "",
        i.points ?? "",
        i.kind,
        v?.waitsOn ?? "",
        v?.status ?? "",
      ];
    }),
  };

  return (
    <ToolPageWrapper
      toolId="pi-planning"
      title="PI Planning Board"
      description="SAFe Program Increment board — teams × iterations with features, dependencies, and risks."
      category="Portfolio & Scaling"
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(state.teams) && <ExampleNotice onClear={clearExample} />}
        <p role="status" className="sr-only">
          {announcement}
        </p>

        <ActionRow>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="pi-planning"
            csvData={csvData}
            jsonData={state}
            markdown={toMarkdown(state, map, today)}
            targetRef={exportRef}
          />
        </ActionRow>

        <KpiGrid cols={4} marginBottom="none">
          <StatCard
            variant="compact"
            label="Teams"
            value={state.teams.length}
            valueClassName="text-accent"
          />
          <StatCard
            variant="compact"
            label="Feature points"
            value={planned}
            hint={
              withVelocity.length === 0
                ? "no velocity set"
                : noVelocity > 0
                  ? `${plural(noVelocity, "team")} without a velocity`
                  : `of ${capacity} capacity`
            }
          />
          <StatCard
            variant="compact"
            label="Over capacity"
            value={over.length}
            hint={over.length === 1 ? "team iteration" : "team iterations"}
            tone={over.length > 0 ? "danger" : "default"}
          />
          <StatCard
            variant="compact"
            label="Open dependencies"
            value={openDeps.length}
            hint={lateDeps > 0 ? `${lateDeps} overdue` : undefined}
            tone={lateDeps > 0 ? "danger" : "default"}
          />
        </KpiGrid>

        <SectionCard title="Add a team" icon={Plus}>
          <TeamAddForm teams={state.teams} onAdd={addTeam} />
        </SectionCard>

        {state.teams.length === 0 ? (
          <EmptyState icon={CalendarRange} action={<LoadExampleButton onLoad={loadExample} />}>
            No teams on the board yet. Add the teams in the release train above, or load an example
            to see a planned PI.
          </EmptyState>
        ) : (
          <>
            <SectionCard title="Board" icon={CalendarRange}>
              <div className="space-y-3">
                <p className="text-sm font-medium text-text">{piVerdict(state, map, today)}</p>
                <SelectField
                  label="Iterations in the PI"
                  className="max-w-48"
                  options={Array.from({ length: MAX_ITERATIONS }, (_, i) => ({
                    value: String(i + 1),
                    label: String(i + 1),
                  }))}
                  value={String(state.iterations)}
                  onChange={(v) => setIterations(Number(v))}
                />
                {legacy.length > 0 && (
                  <CalloutAlert tone="info">
                    <p>
                      {legacy.length} dependency {legacy.length === 1 ? "item was" : "items were"}{" "}
                      saved before the board linked to the Dependency Map, so{" "}
                      {legacy.length === 1 ? "it isn't" : "they aren't"} tracked there yet. Add{" "}
                      {legacy.length === 1 ? "it" : "them"} now, or edit an item to name the team it
                      waits on.
                    </p>
                    {movable.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 gap-1"
                        onClick={moveLegacyToMap}
                      >
                        <GitBranch aria-hidden="true" />
                        Add to the Dependency Map
                      </Button>
                    )}
                  </CalloutAlert>
                )}
                {state.teams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    state={state}
                    views={views}
                    editing={editing}
                    setEditing={setEditing}
                    onClose={closeEditor}
                    refFor={refFor}
                    actions={actions}
                  />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Load vs capacity" icon={Gauge}>
              <LoadChart state={state} />
            </SectionCard>

            <SectionCard title="PI objectives" icon={Target}>
              <ObjectivesPanel
                teams={state.teams}
                objectives={objectives}
                editingId={editingObjective}
                setEditingId={setEditingObjective}
                onClose={closeObjective}
                refFor={refFor}
                onAdd={addObjective}
                onSave={saveObjective}
                onRemove={removeObjective}
              />
            </SectionCard>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={
          confirm?.kind === "team"
            ? `Remove team “${confirm.team.name}”?`
            : confirm?.kind === "iterations"
              ? `Cut the PI to ${confirm.next} ${confirm.next === 1 ? "iteration" : "iterations"}?`
              : ""
        }
        description={confirmText(confirm, state)}
        confirmLabel={confirm?.kind === "team" ? "Remove team" : "Remove iterations"}
        onConfirm={() => {
          if (confirm?.kind === "team") removeTeam(confirm.team);
          else if (confirm?.kind === "iterations") shrink(confirm.next);
        }}
      />
    </ToolPageWrapper>
  );
}

function confirmText(confirm: Confirm, state: PiState): string | undefined {
  if (!confirm) return undefined;
  const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
  if (confirm.kind === "team") {
    const parts = [
      confirm.items > 0 ? items(confirm.items) : "",
      confirm.objectives > 0
        ? `${confirm.objectives} ${confirm.objectives === 1 ? "objective" : "objectives"}`
        : "",
    ].filter(Boolean);
    const one = confirm.items + confirm.objectives === 1;
    return `Its ${parts.join(" and ")} ${one ? "goes" : "go"} with it, and so do the dependencies its items put on the Dependency Map.`;
  }
  const from = confirm.next + 1;
  return `${items(confirm.items)} planned in iteration ${from}${
    from < state.iterations ? ` or later` : ""
  } will be removed.`;
}
