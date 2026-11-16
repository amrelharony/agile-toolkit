#!/usr/bin/env node
/**
 * Probe every tool AI task against the real gateway before the Ask Amr
 * buttons rely on it.
 *
 * Usage: type the key at a hidden prompt in your own terminal, so it never
 * lands in shell history or on a command line (this script never prints it):
 *   bash:        read -rs OPENCLAW_API_KEY && export OPENCLAW_API_KEY
 *   PowerShell:  $s = Read-Host -AsSecureString
 *                $env:OPENCLAW_API_KEY = [Net.NetworkCredential]::new('', $s).Password
 * then:
 *   node scripts/probe-tool-ai.mjs                       (the owner's models, by tier)
 *   node scripts/probe-tool-ai.mjs --visitor             (VISITOR_AI_MODEL, as visitors get)
 *   node scripts/probe-tool-ai.mjs --task ai.suggest_options
 *
 * Env:
 *   OPENCLAW_API_KEY  the gateway's bearer key (read from the env only). Without
 *                     it, GLM_API_KEY or ZAI_API_KEY are tried, as the owner route does.
 *   OPENCLAW_URL      chat-completions URL (default https://chat.amrelharony.com/v1/chat/completions)
 *   OPENCLAW_MODEL, VISITOR_AI_MODEL  as in the app.
 *
 * Each task sends its own sample input through the routes' own code: the same
 * prompt, the same call and the same tolerant parsing (src/lib/ai/run-task.server.ts),
 * run by vitest so the TypeScript sources load as they are. A task passes when
 * the model's answer fits its output schema; a fallback or an error fails it.
 * One line per task: PASS / FAIL, the task id, the model, the time, the token
 * counts and the outcome. Exit 0 when every task passes, 1 when one fails, 2
 * when no key is set.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const hasKey = ["OPENCLAW_API_KEY", "GLM_API_KEY", "ZAI_API_KEY"].some((name) =>
  (process.env[name] ?? "").trim()
);
if (!hasKey) {
  console.error("OPENCLAW_API_KEY is not set. Set it in this terminal, then run the probe again.");
  process.exit(2);
}
if (flag("visitor") && !(process.env.OPENCLAW_API_KEY ?? "").trim()) {
  console.error("--visitor needs OPENCLAW_API_KEY: visitors only ever reach the gateway.");
  process.exit(2);
}
const url = (process.env.OPENCLAW_URL ?? "").trim();
if (url && !/^https:\/\//i.test(url)) {
  console.error("OPENCLAW_URL must be an https:// URL (the key must not travel in the clear).");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.PROBE_TOOL_AI = "1";
process.env.PROBE_TOOL_AI_AUDIENCE = flag("visitor") ? "visitor" : "owner";
if (arg("task")) process.env.PROBE_TOOL_AI_TASK = arg("task");

const { startVitest } = await import("vitest/node");
const vitest = await startVitest(
  "test",
  [],
  {
    root,
    config: path.join(root, "vitest.config.ts"),
    include: ["scripts/probe-tool-ai.probe.ts"],
    environment: "node",
    watch: false,
    testTimeout: 300_000,
    fileParallelism: false,
    reporters: ["verbose"],
  },
  {}
);

const files = vitest?.state.getFiles() ?? [];
const failed = files.some((f) => f.result?.state === "fail");
await vitest?.close();
process.exit(failed || files.length === 0 ? 1 : 0);
