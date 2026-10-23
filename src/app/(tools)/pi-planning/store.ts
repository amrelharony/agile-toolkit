"use client";

/**
 * The PI board's own persisted state (localStorage plus cloud sync under
 * `agile-toolkit:pi-planning`, unchanged so saved boards keep loading).
 *
 * Every read goes through `normalizePiState`: boards saved before this
 * upgrade carry a velocity of 0 for "not set", points on every item (3 by
 * default) and dependency items with no link to the Dependency Map. Those
 * shapes still load; the new fields (`objectives`, `dependsOn`, `edgeId`)
 * are optional and only added, never required.
 */

import { useCallback, useMemo } from "react";
import { usePersisted } from "@/lib/utils/use-persisted";

export const PI_STORAGE_KEY = "agile-toolkit:pi-planning";

export type PiItemKind = "feature" | "dependency" | "risk";
export const PI_ITEM_KINDS: readonly PiItemKind[] = ["feature", "dependency", "risk"];

export interface PiTeam {
  id: string;
  name: string;
  description?: string;
  /** Points the team delivers per iteration; unset (or a legacy 0) means no capacity yet. */
  velocity?: number;
}

export interface PiItem {
  id: string;
  title: string;
  description?: string;
  teamId: string;
  /** 0-based iteration. */
  iteration: number;
  /** Unset means not sized yet (never a silent 0). Only features count toward load. */
  points?: number;
  kind: PiItemKind;
  /** A dependency's other side: the team (or deliverable) it waits on. */
  dependsOn?: string;
  /** The Dependency Map edge this dependency shows (status, owner and due date live there). */
  edgeId?: string;
}

/** A PI objective: what the team commits to, with the business value its owners give it. */
export interface PiObjective {
  id: string;
  teamId: string;
  title: string;
  /** 1–10, set by the business owners; unset until they score it. */
  businessValue?: number;
  /** Uncommitted objectives are stretch goals: planned for, not promised. */
  committed: boolean;
}

export interface PiState {
  teams: PiTeam[];
  items: PiItem[];
  iterations: number;
  objectives?: PiObjective[];
}

export const MAX_ITERATIONS = 10;
export const DEFAULT_PI_STATE: PiState = { teams: [], items: [], iterations: 5, objectives: [] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const count = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

/**
 * Any stored value as a usable board. Unknown fields are kept (a newer
 * build's additions survive an older tab), broken rows are dropped, and an
 * item pinned past the last iteration stays (the board just doesn't show it
 * until the iteration count grows back).
 */
export function normalizePiState(raw: unknown): PiState {
  if (!isObj(raw)) return DEFAULT_PI_STATE;
  const iterations =
    typeof raw.iterations === "number" && Number.isInteger(raw.iterations)
      ? Math.min(MAX_ITERATIONS, Math.max(1, raw.iterations))
      : DEFAULT_PI_STATE.iterations;

  const teams: PiTeam[] = (Array.isArray(raw.teams) ? raw.teams : []).flatMap((t) => {
    if (!isObj(t) || !str(t.id)) return [];
    const velocity = count(t.velocity);
    const team: PiTeam = { ...(t as object), id: t.id as string, name: str(t.name) ?? "" };
    if (velocity && velocity > 0) team.velocity = velocity;
    else delete team.velocity;
    return [team];
  });

  const items: PiItem[] = (Array.isArray(raw.items) ? raw.items : []).flatMap((i) => {
    if (!isObj(i) || !str(i.id) || !str(i.teamId)) return [];
    const iteration =
      typeof i.iteration === "number" && Number.isInteger(i.iteration) && i.iteration >= 0
        ? i.iteration
        : 0;
    const kind = PI_ITEM_KINDS.includes(i.kind as PiItemKind) ? (i.kind as PiItemKind) : "feature";
    const item: PiItem = {
      ...(i as object),
      id: i.id as string,
      teamId: i.teamId as string,
      title: str(i.title) ?? "",
      iteration,
      kind,
    };
    const points = count(i.points);
    if (points === undefined) delete item.points;
    else item.points = points;
    return [item];
  });

  const objectives: PiObjective[] = (Array.isArray(raw.objectives) ? raw.objectives : []).flatMap(
    (o) => {
      if (!isObj(o) || !str(o.id) || !str(o.teamId)) return [];
      const bv = count(o.businessValue);
      const objective: PiObjective = {
        ...(o as object),
        id: o.id as string,
        teamId: o.teamId as string,
        title: str(o.title) ?? "",
        committed: o.committed !== false,
      };
      if (bv === undefined) delete objective.businessValue;
      else objective.businessValue = bv;
      return [objective];
    }
  );

  return { ...(raw as object), teams, items, iterations, objectives };
}

/** The board, normalized, and a setter that always starts from the latest saved value. */
export function usePiState(): [PiState, (fn: (s: PiState) => PiState) => void] {
  const [raw, setRaw] = usePersisted<unknown>(PI_STORAGE_KEY, DEFAULT_PI_STATE);
  const state = useMemo(() => normalizePiState(raw), [raw]);
  const update = useCallback(
    (fn: (s: PiState) => PiState) => setRaw((prev: unknown) => fn(normalizePiState(prev))),
    [setRaw]
  );
  return [state, update];
}

/** The PI board's team names, for other tools' team pickers (Scrum of Scrums). */
export const piTeamNames = (state: PiState): string[] =>
  state.teams.map((t) => t.name).filter((n) => n.trim());
