/**
 * The body of `node scripts/probe-tool-ai.mjs`: every registered tool AI task,
 * run once against the real gateway through the routes' own code
 * (runAiTask: the same prompt, the same call, the same parsing). Never part
 * of the test suite (vitest's include is test/**), and it skips unless the
 * script started it.
 *
 * A task passes when the model's own answer fits the task's output schema
 * (source "ai"); a fallback or an error is a fail, with the reason. Only task
 * ids, outcomes, times and token counts are printed: never the key, never
 * the backend object that holds it.
 */

import { describe, expect, it } from "vitest";
import {
  CALLER_NAME,
  VISITOR_CALLER_NAME,
  pickModel,
  resolveOwnerBackend,
  resolveVisitorBackend,
} from "@/lib/agent/upstream";
import { listAiTasks } from "@/lib/ai/registry";
import { getAiPrompt } from "@/lib/ai/registry.server";
import { runAiTask } from "@/lib/ai/run-task.server";

const enabled = process.env.PROBE_TOOL_AI === "1";
const audience = process.env.PROBE_TOOL_AI_AUDIENCE === "visitor" ? "visitor" : "owner";
const only = (process.env.PROBE_TOOL_AI_TASK ?? "").trim();

/** The backend the routes would use, without its key ever leaving this function's callers. */
function backendFor() {
  if (audience === "visitor") {
    // The visitor route also needs VISITOR_AI_ENABLED=1; the probe doesn't.
    return resolveVisitorBackend({ ...process.env, VISITOR_AI_ENABLED: "1" });
  }
  return resolveOwnerBackend();
}

const tasks = listAiTasks().filter((t) => !only || t.id === only);

describe.skipIf(!enabled)(`tool AI tasks against the gateway (${audience})`, () => {
  it("has a backend and at least one task", () => {
    expect(backendFor() !== null, "no backend: set OPENCLAW_API_KEY in this terminal").toBe(true);
    expect(tasks.length, only ? `no task "${only}"` : "no tasks").toBeGreaterThan(0);
  });

  it.each(tasks.map((t) => [t.id, t] as const))("%s", async (id, task) => {
    const backend = backendFor();
    const prompt = getAiPrompt(id);
    expect(prompt !== undefined, `no server prompt for ${id}`).toBe(true);
    if (!backend || !prompt) return;
    const model = pickModel(backend, task.tier, audience);
    const started = Date.now();
    const result = await runAiTask({
      task,
      prompt,
      input: task.sample,
      backend: { ...backend, model },
      caller: audience === "visitor" ? VISITOR_CALLER_NAME : CALLER_NAME,
      effortCap: audience === "visitor" ? "high" : null,
      deadlineMs: 240_000,
    });
    const ms = Date.now() - started;
    const outcome = result.ok
      ? result.source === "ai"
        ? "ai"
        : `fallback (${result.reason})`
      : `error (${result.error})`;
    const tokens = result.usage ? ` in=${result.usage.tokensIn} out=${result.usage.tokensOut}` : "";
    console.log(
      `${outcome === "ai" ? "PASS" : "FAIL"}  ${id}  ${model}  ${ms}ms${tokens}  ${outcome}`
    );
    // Only the outcome string is compared, so a failure prints nothing else.
    expect(outcome).toBe("ai");
  });
});
