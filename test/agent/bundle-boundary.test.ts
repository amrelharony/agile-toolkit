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
 *
 * Visitor AI keeps the same line. The panel (visitor-panel) and the consent
 * card ship with the page and stay light; the visitor's chat
 * (visitor-agent-panel) is its own chunk, reached only by a dynamic import;
 * and the agent runtime behind it (lib/agent/visitor-runtime: the registry
 * and the client) loads only on the visitor's first message, again by a
 * dynamic import. No visitor file reaches the owner's Supabase persistence.
 */
const SHARED_MODULES = [
  "src/components/layout/app-shell.tsx",
  "src/components/layout/header.tsx",
  "src/components/agent/mascot/mascot-assistant.tsx",
  "src/components/agent/mascot/visitor-guide.tsx",
  "src/components/agent/mascot/visitor-panel.tsx",
  "src/components/agent/mascot/visitor-ai-consent.tsx",
];

const OWNER_ONLY = [
  "@/lib/actions/register-all",
  "@/lib/actions/registry",
  "@/lib/agent/client",
  "@/lib/agent/execute-tool",
  "@/lib/agent/visitor-tools",
  "@/lib/agent/visitor-runtime",
  "@/lib/agent/persist",
  "../agent-conversation",
  "../conversation-list",
  "./owner-agent-panel",
  "./visitor-agent-panel",
];

/** Every file a visitor's chat is made of (none may reach the owner's persistence statically). */
const VISITOR_FILES = [
  ...SHARED_MODULES.slice(2),
  "src/components/agent/mascot/visitor-agent-panel.tsx",
  "src/components/agent/message-bubble.tsx",
  "src/components/agent/confirm-action.tsx",
  "src/components/agent/markdown.tsx",
];

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

/** The specifiers a module imports statically (`import … from "x"` and `import "x"`). */
function staticImports(src: string): string[] {
  const from = Array.from(src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)).map((m) => m[1]);
  const bare = Array.from(src.matchAll(/^import\s+["']([^"']+)["']/gm)).map((m) => m[1]);
  return [...from, ...bare];
}

/** The specifiers a module loads with a dynamic `import("x")` call. */
function dynamicImports(src: string): string[] {
  return Array.from(src.matchAll(/(?<!typeof\s)\bimport\(\s*["']([^"']+)["']\s*\)/g)).map(
    (m) => m[1]
  );
}

describe("visitor bundle boundary", () => {
  it.each(SHARED_MODULES)("%s does not statically import the agent runtime", (file) => {
    for (const spec of staticImports(read(file))) {
      expect(OWNER_ONLY, `${file} imports ${spec}`).not.toContain(spec);
    }
  });

  it("reaches the visitor's chat only through a dynamic import in the panel", () => {
    const panel = read("src/components/agent/mascot/visitor-panel.tsx");
    expect(dynamicImports(panel)).toContain("./visitor-agent-panel");
    for (const file of SHARED_MODULES) {
      expect(staticImports(read(file)), file).not.toContain("./visitor-agent-panel");
    }
  });

  it("loads the agent runtime only with a dynamic import, from the visitor's chat", () => {
    const chat = read("src/components/agent/mascot/visitor-agent-panel.tsx");
    expect(dynamicImports(chat)).toContain("@/lib/agent/visitor-runtime");
    for (const file of VISITOR_FILES) {
      const imports = staticImports(read(file));
      for (const spec of [
        "@/lib/agent/visitor-runtime",
        "@/lib/actions/register-all",
        "@/lib/actions/registry",
        "@/lib/agent/client",
      ]) {
        expect(imports, `${file} statically imports ${spec}`).not.toContain(spec);
      }
    }
  });

  it("never imports the owner's Supabase persistence from a visitor file", () => {
    for (const file of VISITOR_FILES) {
      const src = read(file);
      const all = [...staticImports(src), ...dynamicImports(src)];
      expect(all, file).not.toContain("@/lib/agent/persist");
      expect(
        all.some((s) => /supabase/i.test(s)),
        `${file}: ${all.join(", ")}`
      ).toBe(false);
    }
  });

  it("keeps the runtime the only place the visitor chat gets the registry from", () => {
    const runtime = read("src/lib/agent/visitor-runtime.ts");
    expect(staticImports(runtime)).toContain("@/lib/actions/register-all");
  });
});
