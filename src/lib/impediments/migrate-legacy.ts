/**
 * Moves the Impediments tool's old local store (`agile-toolkit:impediments`)
 * into `workspace.impediments`, once, through the crash-safe legacy-key
 * move (lib/data/migrate-legacy-key.ts): one workspace write, then a
 * `:migrated` backup, then the old key goes.
 *
 * The tool used to copy each row to the workspace while its page was open,
 * under the same id, but only some fields (no description, category, who
 * raised it, escalation or expected days). So a row the workspace has gets
 * only its gaps filled, and a row it lacks (logged while the copy wasn't
 * running) is added. Running it twice changes nothing the second time.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment } from "@/lib/stores/workspace-types";
import {
  runLegacyKeyMigration,
  type LegacyKeyMigrationResult,
} from "@/lib/data/migrate-legacy-key";
import { LEGACY_IMPEDIMENTS_KEY } from "./legacy-key";
import { fillFromLegacy, fromLegacyImpediment } from "./model";

/** `navigator.locks` name, so two tabs never move it at the same time. */
const LOCK = "agile-toolkit:impediments-migration";

export interface ImpedimentMoveReport {
  /** Rows the workspace didn't have. */
  added: number;
  /** Rows it had, with fields filled in. */
  filled: number;
  /** Rows that couldn't be read. */
  skipped: number;
}

/** The old store's rows: a zustand persist blob `{state: {impediments}}`, or a bare array. */
function legacyRows(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    const state = (parsed as { state?: { impediments?: unknown } } | null)?.state;
    return Array.isArray(state?.impediments) ? state.impediments : [];
  } catch {
    return [];
  }
}

/** The workspace's impediments after the move, and what it did. Pure. */
export function planImpedimentMove(
  raw: string,
  current: readonly Impediment[]
): { next: Impediment[]; report: ImpedimentMoveReport } {
  const report: ImpedimentMoveReport = { added: 0, filled: 0, skipped: 0 };
  const next = [...current];
  const index = new Map(next.map((i, n) => [i.id, n]));
  for (const row of legacyRows(raw)) {
    const legacy = fromLegacyImpediment(row);
    if (!legacy) {
      report.skipped++;
      continue;
    }
    const at = index.get(legacy.id);
    if (at === undefined) {
      index.set(legacy.id, next.length);
      next.push(legacy);
      report.added++;
      continue;
    }
    const filled = fillFromLegacy(next[at], legacy);
    if (JSON.stringify(filled) !== JSON.stringify(next[at])) {
      next[at] = filled;
      report.filled++;
    }
  }
  return { next, report };
}

export function runLegacyImpedimentMigration(
  storage?: Storage
): Promise<LegacyKeyMigrationResult<ImpedimentMoveReport>> {
  return runLegacyKeyMigration(LOCK, {
    keys: [LEGACY_IMPEDIMENTS_KEY],
    storage,
    move: (raw) => {
      const value = raw[LEGACY_IMPEDIMENTS_KEY];
      const { next, report } = planImpedimentMove(
        value ?? "[]",
        useWorkspaceStore.getState().impediments ?? []
      );
      const wrote = report.added + report.filled > 0;
      if (wrote) useWorkspaceStore.setState({ impediments: next });
      return { wrote, report };
    },
  });
}

/** A toast for the move, or null when it added nothing the user would miss. */
export function impedimentMigrationSummary(report: ImpedimentMoveReport | null): string | null {
  if (!report || report.added === 0) return null;
  return report.added === 1
    ? "Moved 1 impediment saved in this browser into your workspace."
    : `Moved ${report.added} impediments saved in this browser into your workspace.`;
}
