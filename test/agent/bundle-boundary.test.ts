// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Modules every visitor downloads must not statically import the owner's
 * agent runtime: the action registry (305 actions + zod) and the agent
 * client used to ride along with the app shell and the mascot, adding
 * ~100 KB brotli to every page for a feature only the owner can use.
 * The owner chat loads them from components/agent/mascot/owner-agent-panel.
 */
const SHARED_MODULES = [
  "src/components/layout/app-shell.tsx",
  "src/components/layout/header.tsx",
  "src/components/agent/mascot/mascot-assistant.tsx",
  "src/components/agent/mascot/visitor-guide.tsx",
];

const OWNER_ONLY = [
  "@/lib/actions/register-all",
  "@/lib/actions/registry",
  "@/lib/agent/client",
  "../agent-conversation",
  "../conversation-list",
];

describe("visitor bundle boundary", () => {
  it.each(SHARED_MODULES)("%s does not statically import the agent runtime", (file) => {
    const src = readFileSync(path.join(process.cwd(), file), "utf8");
    const staticImports = Array.from(src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gms)).map(
      (m) => m[1]
    );
    const sideEffectImports = Array.from(src.matchAll(/^import\s+["']([^"']+)["']/gm)).map(
      (m) => m[1]
    );
    for (const spec of [...staticImports, ...sideEffectImports]) {
      expect(OWNER_ONLY, `${file} imports ${spec}`).not.toContain(spec);
    }
  });
});
