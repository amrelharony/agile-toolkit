/**
 * Hand-off target: an impediment.
 *
 * Impediments live in workspace.impediments, the one store the Impediments
 * tool, the cockpit, dashboards and agents all read (lib/impediments). A
 * send adds an open impediment there, keeping where it came from
 * (`source`, `sourceRef`), and Undo removes it.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment } from "@/lib/stores/workspace-types";
import { IMPEDIMENT_SEVERITIES, isResolved } from "@/lib/impediments/model";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { HandoffRoute, HandoffSource } from "../types";

function sourceKind(tool: string): Impediment["source"] {
  return tool === "retro" || tool === "standup" ? tool : "manual";
}

/** The source's severity when it is one the entity knows (a risk keeps its level), else medium. */
function severityOf(src: HandoffSource): Impediment["severity"] {
  return src.severity && IMPEDIMENT_SEVERITIES.includes(src.severity) ? src.severity : "medium";
}

/**
 * The impediment a send adds. Severity is required on the entity: a risk
 * raised as an impediment keeps its level (HandoffSource.severity), and
 * any other send starts at medium (the tool shows it, to change); there is
 * no category until someone picks one.
 */
export function buildImpediment(
  src: HandoffSource,
  id: string = crypto.randomUUID(),
  today: string = todayLocalISO()
): Impediment {
  const description = (src.description ?? "").trim().slice(0, 4000);
  const raisedBy = (src.raisedBy ?? "").trim();
  const owner = (src.owner ?? "").trim();
  return {
    id,
    title: src.title.trim().slice(0, 240),
    severity: severityOf(src),
    raisedAt: today,
    source: sourceKind(src.sourceRef.tool),
    sourceRef: src.sourceRef,
    ...(description ? { description } : {}),
    ...(raisedBy ? { raisedBy } : {}),
    ...(owner ? { owner } : {}),
  };
}

const find = (id: string) =>
  (useWorkspaceStore.getState().impediments ?? []).find((i) => i.id === id);

export const impedimentRoute: HandoffRoute = {
  id: "impediment",
  label: "Impediment",
  doneLabel: "Raised as an impediment",
  targetToolId: "impediments",
  targetHref: () => "/impediments",
  send: (src) => {
    const impediment = buildImpediment(src);
    useWorkspaceStore.getState().upsertImpediment(impediment);
    return impediment.id;
  },
  remove: (id) => {
    if (find(id)) useWorkspaceStore.getState().removeImpediment(id);
  },
  exists: (id) => Boolean(find(id)),
  isDone: (id) => {
    const i = find(id);
    return Boolean(i && isResolved(i));
  },
};
