/**
 * Hand-off target: an impediment.
 *
 * The Impediments tool keeps its own local store and bridges it one way into
 * workspace.impediments (only while its page is open). A hand-off writes both
 * with the same id: the local row, so the tool shows it, and the workspace
 * row, so dashboards and agents see it now. The bridge then finds the two
 * already in step, and it keeps `source` and `sourceRef` on later edits.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useImpedimentStore } from "@/app/(tools)/impediments/use-impediment-store";
import { toWorkspaceImpediment } from "@/app/(tools)/impediments/helpers";
import type { Impediment as LocalImpediment } from "@/app/(tools)/impediments/types";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { HandoffRoute, HandoffSource } from "../types";

function sourceKind(tool: string): LocalImpediment["source"] {
  return tool === "retro" || tool === "standup" ? tool : "manual";
}

export function buildImpediment(src: HandoffSource, id = crypto.randomUUID()): LocalImpediment {
  return {
    id,
    title: src.title.trim().slice(0, 240),
    description: (src.description ?? "").trim().slice(0, 4000),
    category: "Process",
    severity: "Medium",
    raisedBy: (src.raisedBy ?? "").trim(),
    assignedTo: (src.owner ?? "").trim(),
    status: "Open",
    raisedDate: todayLocalISO(),
    source: sourceKind(src.sourceRef.tool),
    sourceRef: src.sourceRef,
  };
}

export const impedimentRoute: HandoffRoute = {
  id: "impediment",
  label: "Impediment",
  doneLabel: "Raised as an impediment",
  targetToolId: "impediments",
  targetHref: () => "/impediments",
  send: (src) => {
    const local = buildImpediment(src);
    useImpedimentStore.getState().importImpediment(local);
    useWorkspaceStore.getState().upsertImpediment(toWorkspaceImpediment(local));
    return local.id;
  },
  remove: (id) => {
    if (useImpedimentStore.getState().impediments.some((i) => i.id === id)) {
      useImpedimentStore.getState().remove(id);
    }
    if ((useWorkspaceStore.getState().impediments ?? []).some((i) => i.id === id)) {
      useWorkspaceStore.getState().removeImpediment(id);
    }
  },
  exists: (id) =>
    useImpedimentStore.getState().impediments.some((i) => i.id === id) ||
    (useWorkspaceStore.getState().impediments ?? []).some((i) => i.id === id),
};
