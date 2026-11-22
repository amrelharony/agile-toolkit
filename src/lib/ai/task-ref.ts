/**
 * Lazy task refs: what a tool page holds instead of a task's def, so zod and
 * the schemas load on the first AI use, not with the page. No zod, no React.
 *
 * Every task has three modules:
 *   - `tasks/<toolId>.lite.ts`: no zod. The values pages use (caps, labels,
 *     pure helpers), each task's fallback as a named function, and one ref
 *     per task (lazyAiTask), with the def's export name. Pages import this
 *     module only.
 *   - `tasks/<toolId>.ts`: the def (defineAiTask), its zod schemas, and the
 *     same fallback function, imported from the lite module. The routes, the
 *     registry and the tests read it.
 *   - `tasks/<toolId>.server.ts`: the prompt.
 *
 *   // tasks/root-cause.lite.ts
 *   export const nextWhyFallback = ({ problem, whys }: NextWhyInput): NextWhyOutput => …;
 *   export const nextWhyTask = lazyAiTask(
 *     { id: "root-cause.next_why", toolId: "root-cause", fallback: nextWhyFallback },
 *     () => import("./root-cause").then((m) => m.nextWhyTask)
 *   );
 *
 * The no-AI answer never waits for the network: the ref carries the def's
 * own fallback (the same function), so a page with AI off, or offline, still
 * answers at once. useToolAi and <AiButton> take either a def or a ref
 * (AiTaskLike) and load the def only when they need its schemas.
 */

import type { AiTaskDef, AiTaskId } from "./task-types";

export interface AiTaskRef<I, O> {
  readonly ref: true;
  readonly id: AiTaskId;
  readonly toolId: string;
  /** As the def's: hides the task from visitors before anything loads. */
  readonly ownerOnly?: boolean;
  /** The def's own fallback (the same function): pure, synchronous, no network. */
  fallback(input: I): O;
  /**
   * The def, loading its module the first time. The promise is cached, so
   * every caller shares one load; a failed load clears it, so a retry loads
   * again.
   */
  load(): Promise<AiTaskDef<I, O>>;
  /** The def once its module has run (after a load, or a static import anywhere), else null. */
  peek(): AiTaskDef<I, O> | null;
}

/** A task as a page passes it: the def itself, or a ref to it. */
export type AiTaskLike<I, O> = AiTaskDef<I, O> | AiTaskRef<I, O>;

/** Every def whose module has run, by id (defineAiTask notes each one). */
const LOADED = new Map<string, AiTaskDef<unknown, unknown>>();

/** Note a def as loaded: its refs' `peek()` then answers with it. defineAiTask calls it. */
export function noteLoadedAiTask<I, O>(def: AiTaskDef<I, O>): void {
  LOADED.set(def.id, def as unknown as AiTaskDef<unknown, unknown>);
}

/**
 * A ref to the task `load` resolves. `meta` holds what a page needs before
 * the def loads: the id, the tool, whether it is the owner's only, and the
 * def's own fallback. A loaded def with another id is refused.
 */
export function lazyAiTask<I, O>(
  meta: { id: AiTaskId; toolId: string; ownerOnly?: true; fallback(input: I): O },
  load: () => Promise<AiTaskDef<I, O>>
): AiTaskRef<I, O> {
  let pending: Promise<AiTaskDef<I, O>> | null = null;
  const peek = (): AiTaskDef<I, O> | null =>
    (LOADED.get(meta.id) as AiTaskDef<I, O> | undefined) ?? null;
  return {
    ref: true,
    id: meta.id,
    toolId: meta.toolId,
    ...(meta.ownerOnly ? { ownerOnly: true } : {}),
    fallback: meta.fallback,
    peek,
    load() {
      const ready = peek();
      if (ready) return Promise.resolve(ready);
      if (!pending) {
        const loading = Promise.resolve()
          .then(load)
          .then((def) => {
            if (!def || def.id !== meta.id) {
              throw new Error(`The AI task ${meta.id} loaded ${def ? def.id : "nothing"}.`);
            }
            noteLoadedAiTask(def);
            return def;
          });
        pending = loading;
        // A failed load is forgotten, so the next ask loads again.
        loading.catch(() => {
          if (pending === loading) pending = null;
        });
      }
      return pending;
    },
  };
}

/** Whether a value is a task ref (not a def). */
export function isAiTaskRef(v: unknown): v is AiTaskRef<unknown, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { ref?: unknown }).ref === true &&
    typeof (v as { load?: unknown }).load === "function" &&
    typeof (v as { peek?: unknown }).peek === "function"
  );
}

/** The def, if it is there without loading: a def itself, or a ref's loaded def. */
export function peekAiTask<I, O>(t: AiTaskLike<I, O>): AiTaskDef<I, O> | null {
  return isAiTaskRef(t) ? (t as AiTaskRef<I, O>).peek() : (t as AiTaskDef<I, O>);
}

/** The def, loading it when `t` is a ref. */
export function resolveAiTask<I, O>(t: AiTaskLike<I, O>): Promise<AiTaskDef<I, O>> {
  return isAiTaskRef(t) ? (t as AiTaskRef<I, O>).load() : Promise.resolve(t as AiTaskDef<I, O>);
}

/** Start loading a ref's def ahead of its use (fire and forget; a failure is left to the run). */
export function preloadAiTask<I, O>(t: AiTaskLike<I, O>): void {
  if (!isAiTaskRef(t) || t.peek()) return;
  t.load().catch(() => undefined);
}

/**
 * The task's answer without AI, synchronous, or null when there is none for
 * this input:
 *   - with the def loaded, the input is checked against its schema first,
 *     then the def's fallback answers (null on a refused input);
 *   - with only the ref, its fallback (the same function) answers the input
 *     as it is.
 * A fallback that throws gives null too. Callers say "Fill in the tool
 * first" on null.
 */
export function answerWithoutAi<I, O>(t: AiTaskLike<I, O>, input: unknown): O | null {
  try {
    const def = peekAiTask(t);
    if (def) {
      const parsed = def.input.safeParse(input);
      return parsed.success ? def.fallback(parsed.data) : null;
    }
    return t.fallback(input as I);
  } catch {
    return null;
  }
}
