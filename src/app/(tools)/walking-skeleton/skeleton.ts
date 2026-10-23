import { isExampleId } from "@/components/tool-frame/example-data";
import { listAnd } from "@/lib/charts/chart-text";
import {
  findLink,
  getHandoffRoute,
  liveLink,
  withLink,
  withoutLink,
} from "@/lib/handoffs/registry";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { HandoffLink } from "@/lib/stores/workspace-types";
import type { Layer, SkeletonStep } from "./store";

/**
 * The layers a request passes through, outside in. Each has a theme token
 * (the old fixed neon hex ignored the theme), and a short meaning for the
 * picker's tooltip.
 */
export const LAYERS: readonly {
  id: Layer;
  label: string;
  /** How the verdict names it: "no data-layer step yet". */
  word: string;
  meaning: string;
  /** Tag classes: tinted border and text in the layer's token. */
  tag: string;
}[] = [
  {
    id: "ui",
    label: "UI",
    word: "UI",
    meaning: "What the user sees and clicks",
    tag: "border-accent/40 bg-accent/10 text-accent",
  },
  {
    id: "api",
    label: "API",
    word: "API",
    meaning: "The service or endpoint the UI calls",
    tag: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  },
  {
    id: "data",
    label: "Data",
    word: "data",
    meaning: "Where it's kept: schema, migration, storage",
    tag: "border-accent-3/40 bg-accent-3/10 text-accent-3",
  },
  {
    id: "infra",
    label: "Infra",
    word: "infra",
    meaning: "How it runs: hosting, pipeline, config, monitoring",
    tag: "border-accent-amber/40 bg-accent-amber/10 text-accent-amber",
  },
];

export const isLayer = (v: unknown): v is Layer => LAYERS.some((l) => l.id === v);

/** A layer's display, or a neutral one for a value from outside the four. */
export function layerInfo(id: string) {
  return (
    LAYERS.find((l) => l.id === id) ?? {
      id,
      label: id || "No layer",
      word: id,
      meaning: "Not one of the four layers",
      tag: "border-border bg-surface text-sub",
    }
  );
}

export interface Coverage {
  covered: Layer[];
  missing: Layer[];
  /** Steps per layer, in LAYERS order. */
  counts: Record<Layer, number>;
}

/** Which layers the path touches. A skeleton is only end to end when none is missing. */
export function layerCoverage(steps: readonly SkeletonStep[]): Coverage {
  const counts = { ui: 0, api: 0, data: 0, infra: 0 } as Record<Layer, number>;
  for (const s of steps) if (isLayer(s.layer)) counts[s.layer]++;
  const ids = LAYERS.map((l) => l.id);
  return {
    covered: ids.filter((id) => counts[id] > 0),
    missing: ids.filter((id) => counts[id] === 0),
    counts,
  };
}

function orList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

/**
 * The one-sentence answer above the path: how far along it is, and which
 * layers it doesn't touch yet ("3 of 5 steps done; no data-layer step yet").
 */
export function skeletonVerdict(steps: readonly SkeletonStep[]): string {
  if (steps.length === 0) return "No steps yet.";
  const done = steps.filter((s) => s.done).length;
  const { missing } = layerCoverage(steps);
  const words = missing.map((id) => layerInfo(id).word);
  const progress =
    done < steps.length
      ? `${done} of ${steps.length} ${steps.length === 1 ? "step" : "steps"} done`
      : steps.length === 1
        ? "The one step is done"
        : `All ${steps.length} steps done`;
  if (missing.length === 0) {
    return done === steps.length
      ? `${progress}, through every layer: the skeleton walks end to end.`
      : `${progress}; every layer has a step.`;
  }
  if (missing.length === 1) return `${progress}; no ${words[0]}-layer step yet.`;
  return `${progress}; no step yet in the ${orList(words)} layers.`;
}

/** The steps with one moved up (-1) or down (+1); unchanged at either end. */
export function moveStep(
  steps: readonly SkeletonStep[],
  id: string,
  delta: -1 | 1
): SkeletonStep[] {
  const from = steps.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= steps.length) return [...steps];
  const next = [...steps];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Whether the step is on the backlog: sent there, and that story still exists. */
export const inBacklog = (s: SkeletonStep) => Boolean(liveLink(s.sentTo, "backlog-story"));

/**
 * The steps "Send to backlog" would add: not done, titled, not there yet,
 * and the user's own (example steps never become real stories).
 */
export function stepsToSend(steps: readonly SkeletonStep[]): SkeletonStep[] {
  return steps.filter(
    (s) => !s.done && s.text.trim() !== "" && !isExampleId(s.id) && !inBacklog(s)
  );
}

/** "Data and Infra", for the coverage line. */
export const layerNames = (ids: readonly string[]) => listAnd(ids.map((id) => layerInfo(id).label));

/** What a step hands the backlog: its text as the story title. */
export function backlogSource(step: SkeletonStep): HandoffSource {
  return { title: step.text, sourceRef: { tool: "walking-skeleton", id: step.id } };
}

/** One step's send: the new link, and the dead link it replaced (back on Undo). */
export interface SentStep {
  link: HandoffLink;
  previous?: HandoffLink;
}

/**
 * Create a backlog story per step and return the links to record, keyed by
 * step id. The caller wraps this in one `undoable()` and Undoes it with
 * `unsendSteps`, so the batch is one toast, not one per step.
 */
export function sendSteps(steps: readonly SkeletonStep[], at: string): Map<string, SentStep> {
  const route = getHandoffRoute("backlog-story");
  const sent = new Map<string, SentStep>();
  for (const step of steps) {
    sent.set(step.id, {
      link: { route: "backlog-story", targetId: route.send(backlogSource(step)), at },
      previous: findLink(step.sentTo, "backlog-story"),
    });
  }
  return sent;
}

/** Undo `sendSteps`: take the stories off the backlog. */
export function unsendSteps(sent: ReadonlyMap<string, SentStep>): void {
  const route = getHandoffRoute("backlog-story");
  sent.forEach(({ link }) => route.remove(link.targetId));
}

/** The steps with each send recorded (`undo` false) or taken back (`undo` true). */
export function withSentLinks(
  steps: readonly SkeletonStep[],
  sent: ReadonlyMap<string, SentStep>,
  undo: boolean
): SkeletonStep[] {
  return steps.map((s) => {
    const one = sent.get(s.id);
    if (!one) return s;
    if (!undo) return { ...s, sentTo: withLink(s.sentTo, one.link) };
    const rest = withoutLink(s.sentTo, one.link);
    return {
      ...s,
      sentTo: one.previous && !findLink(rest, "backlog-story") ? [...rest, one.previous] : rest,
    };
  });
}
