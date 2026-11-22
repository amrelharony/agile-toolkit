// @vitest-environment node
/**
 * Lazy task refs (lib/ai/task-ref.ts): what a tool page holds instead of a
 * task's def, so zod loads on the first AI use.
 *   - A ref carries the def's id, tool, ownerOnly and fallback before
 *     anything loads.
 *   - `load()` runs the loader once and shares the promise; a failed load is
 *     forgotten so a retry loads again; a def with another id is refused.
 *   - `peek()` answers once the def has run anywhere (defineAiTask notes it).
 *   - The answer without AI is synchronous either way: with the def, the
 *     input is checked first; with only the ref, its fallback answers.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAiTask } from "@/lib/ai/define-task";
import {
  answerWithoutAi,
  isAiTaskRef,
  lazyAiTask,
  peekAiTask,
  preloadAiTask,
  resolveAiTask,
} from "@/lib/ai/task-ref";
import type { AiTaskDef } from "@/lib/ai/task-types";

type In = { text: string };
type Out = { words: string[] };
type Def = AiTaskDef<In, Out>;

const words = ({ text }: In): Out => ({ words: text.split(/\s+/).filter(Boolean) });

let n = 0;

/** A def under a fresh id, made by hand (not noted as loaded), and a ref to it. */
function pair(load?: (def: Def) => Promise<Def>, extra: { ownerOnly?: true } = {}) {
  const id = `test.ref_${++n}` as const;
  const def: Def = {
    id,
    toolId: "test",
    tier: "flash",
    effort: "low",
    maxTokens: 2048,
    input: z.object({ text: z.string().trim().min(1).max(40) }),
    output: z.object({ words: z.array(z.string().max(40)).max(10) }),
    fallback: words,
    sample: { text: "one two" },
    ...extra,
  };
  const loader = vi.fn(() => (load ? load(def) : Promise.resolve(def)));
  const ref = lazyAiTask({ id, toolId: "test", fallback: words, ...extra }, loader);
  return { id, def, ref, loader };
}

describe("lazyAiTask", () => {
  it("carries the def's id, tool and fallback before anything loads", () => {
    const { id, ref, loader } = pair();
    expect(ref).toMatchObject({ ref: true, id, toolId: "test" });
    expect(ref.ownerOnly).toBeUndefined();
    expect(ref.fallback).toBe(words);
    expect(ref.fallback({ text: "a b" })).toEqual({ words: ["a", "b"] });
    expect(ref.peek()).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("marks an owner-only task on the ref itself", () => {
    expect(pair(undefined, { ownerOnly: true }).ref.ownerOnly).toBe(true);
  });

  it("loads once, sharing the promise, and peeks at the def after", async () => {
    const { def, ref, loader } = pair();
    const [a, b] = await Promise.all([ref.load(), ref.load()]);
    expect(a).toBe(def);
    expect(b).toBe(def);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(ref.peek()).toBe(def);
    expect(await ref.load()).toBe(def);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed load, so the next ask loads again", async () => {
    const { def, ref, loader } = pair(() => Promise.reject(new Error("offline")));
    await expect(ref.load()).rejects.toThrow("offline");
    expect(ref.peek()).toBeNull();
    loader.mockImplementation(() => Promise.resolve(def));
    expect(await ref.load()).toBe(def);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("turns a loader that throws into a failed load", async () => {
    const { ref } = pair(() => {
      throw new Error("bad chunk");
    });
    await expect(ref.load()).rejects.toThrow("bad chunk");
  });

  it("refuses a def with another id", async () => {
    const other = pair().def;
    const { ref } = pair(() => Promise.resolve(other));
    await expect(ref.load()).rejects.toThrow(/loaded test\.ref_/);
    expect(ref.peek()).toBeNull();
  });

  it("peeks at a def defineAiTask made, without loading", async () => {
    const id = `test.defined_${++n}` as const;
    const loader = vi.fn(() => Promise.reject(new Error("not needed")));
    const ref = lazyAiTask({ id, toolId: "test", fallback: words }, loader);
    expect(ref.peek()).toBeNull();
    const def = defineAiTask({
      id,
      toolId: "test",
      tier: "flash",
      effort: "low",
      maxTokens: 2048,
      input: z.object({ text: z.string().max(40) }),
      output: z.object({ words: z.array(z.string().max(40)).max(10) }),
      fallback: words,
      sample: { text: "x" },
    });
    expect(ref.peek()).toBe(def);
    expect(await ref.load()).toBe(def);
    expect(loader).not.toHaveBeenCalled();
  });
});

describe("the helpers", () => {
  it("tell a ref from a def", () => {
    const { def, ref } = pair();
    expect(isAiTaskRef(ref)).toBe(true);
    expect(isAiTaskRef(def)).toBe(false);
    expect(isAiTaskRef(null)).toBe(false);
    expect(isAiTaskRef({ ref: true })).toBe(false);
  });

  it("peek and resolve a def as itself", async () => {
    const { def } = pair();
    expect(peekAiTask(def)).toBe(def);
    expect(await resolveAiTask(def)).toBe(def);
  });

  it("resolve a ref by loading it", async () => {
    const { def, ref, loader } = pair();
    expect(peekAiTask(ref)).toBeNull();
    expect(await resolveAiTask(ref)).toBe(def);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("preload starts a ref's load and swallows a failure", async () => {
    const { ref, loader } = pair(() => Promise.reject(new Error("offline")));
    preloadAiTask(ref);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    // Nothing unhandled: the failure is the run's to report.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("preload leaves a def, or a loaded ref, alone", async () => {
    const { def, ref, loader } = pair();
    preloadAiTask(def);
    await ref.load();
    preloadAiTask(ref);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("answerWithoutAi", () => {
  it("with the def, checks the input first", () => {
    const { def } = pair();
    expect(answerWithoutAi(def, { text: "  a b  " })).toEqual({ words: ["a", "b"] });
    expect(answerWithoutAi(def, { text: "" })).toBeNull();
    expect(answerWithoutAi(def, { text: "x".repeat(41) })).toBeNull();
  });

  it("with only the ref, answers the input as it is", () => {
    const { ref } = pair();
    expect(answerWithoutAi(ref, { text: "a b" })).toEqual({ words: ["a", "b"] });
    // No schema to refuse it: the fallback answers (the server never sees it).
    expect(answerWithoutAi(ref, { text: "" })).toEqual({ words: [] });
  });

  it("with the ref's def loaded, takes the def's path", async () => {
    const { ref } = pair();
    await ref.load();
    expect(answerWithoutAi(ref, { text: "" })).toBeNull();
  });

  it("gives null when the fallback throws", () => {
    const id = `test.throws_${++n}` as const;
    const ref = lazyAiTask<In, Out>(
      {
        id,
        toolId: "test",
        fallback: () => {
          throw new Error("nothing to work with");
        },
      },
      () => Promise.reject(new Error("never"))
    );
    expect(answerWithoutAi(ref, { text: "a" })).toBeNull();
  });
});
