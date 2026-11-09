// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * A visitor's chat runs the toolkit's actions in the visitor's own tab
 * (visitor AI). That is only safe because an action's browser handler works
 * on this browser's data: it reads and writes the local stores and never
 * talks to the network itself. This scans every action module for anything
 * that would break that: a network call, a Supabase client, the cloud sync
 * engine, or a realtime channel.
 *
 * Two imports are allowed, and why:
 *  - `../server-store` (and `../user-state-blob`, which uses it) holds the
 *    MCP transport's server handlers (`mcpHandler`). The agent never calls
 *    those, and they can't run in a browser anyway: they need
 *    SUPABASE_SERVICE_ROLE_KEY, which is never exposed to the browser.
 *  - two pure modules of the vote rooms' wire format (validators and
 *    constants, no connection).
 *
 * `visitor: false` is for actions whose effects go beyond the tab on their own.
 * The canvas actions broadcast to live room peers through the board's store,
 * so they are closed to visitors (checked here too). A visitor live room is
 * handled separately: while this browser has one open, in any tab, the
 * visitor chat offers no actions at all (lib/realtime/live-visitor-room.ts).
 *
 * The scan covers the action folders, define-crud.ts (which builds about 120
 * of the workspace actions) and context.ts, and then one level further: every
 * module of the app those files import (the workspace store, the tools' model
 * code), so a store whose own code starts a sync or a fetch is caught too.
 */

const ROOT = path.join(process.cwd(), "src/lib/actions");
const SRC = path.join(process.cwd(), "src");
const FOLDERS = ["tools", "workspace", "intents"];

const files = [
  ...FOLDERS.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(dir, f))
  ),
  "define-crud.ts",
  "context.ts",
];

/** Static and dynamic import specifiers (multi-line imports included). */
function importsOf(src: string): string[] {
  const from = Array.from(src.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["']/gm)).map(
    (m) => m[1]
  );
  const bare = Array.from(src.matchAll(/^import\s+["']([^"']+)["']/gm)).map((m) => m[1]);
  const dynamic = Array.from(src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)).map((m) => m[1]);
  const required = Array.from(src.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)).map(
    (m) => m[1]
  );
  return [...from, ...bare, ...dynamic, ...required];
}

/** Code with comments and string contents blanked, so prose can't trip the scan. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
}

const ALLOWED_REALTIME = new Set([
  "@/lib/realtime/vote-room/protocol",
  "@/lib/realtime/vote-room/allocation",
  // Vote counting and reveal rules: pure, no store and no connection.
  "@/lib/realtime/vote-room/aggregate",
]);

/**
 * The one sync import allowed, one level down: the workspace store registers
 * its collections with the sync engine (a dynamic import of
 * @/lib/sync/register). That engine only ever starts for a signed-in owner
 * (CloudSyncProvider, checked below), so for a visitor a write stays in the
 * browser, as it always has when they edit a tool by hand.
 */
const SYNC_REGISTRATION_OK: Readonly<Record<string, string>> = {
  [path.join("lib", "stores", "workspace-store.ts")]: "@/lib/sync/register",
};
const SERVER_ONLY_OK = new Set([
  "../server-store",
  "../user-state-blob",
  "./server-store",
  "./user-state-blob",
]);

/** An `@/…` import as its source file, or null for a package or a path that isn't there. */
function resolveAlias(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = path.join(SRC, spec.slice(2));
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The app modules the action files import, one level down, as paths under src/. */
const reached = Array.from(
  new Set(
    files
      .flatMap((file) => importsOf(readFileSync(path.join(ROOT, file), "utf8")))
      .map(resolveAlias)
      .filter((f): f is string => f !== null)
  )
)
  .map((f) => path.relative(SRC, f))
  .sort();

/** One module's code: no network call of its own. */
function expectNoNetwork(code: string, label: string) {
  expect(code, label).not.toMatch(/\bfetch\s*\(/);
  expect(code, label).not.toMatch(/\bXMLHttpRequest\b/);
  expect(code, label).not.toMatch(/\bWebSocket\b/);
  expect(code, label).not.toMatch(/\bEventSource\b/);
  expect(code, label).not.toMatch(/\bsendBeacon\b/);
  expect(code, label).not.toMatch(/\.channel\s*\(/);
}

/** One module's imports: no Supabase, sync, auth, persistence or realtime connection. */
function expectNoClients(imports: string[], label: string) {
  for (const spec of imports) {
    if (SERVER_ONLY_OK.has(spec)) continue;
    expect(spec, `${label} imports ${spec}`).not.toMatch(/supabase/i);
    expect(spec, `${label} imports ${spec}`).not.toMatch(/(^|\/)sync(\/|-|$)|cloud-sync/i);
    expect(spec, `${label} imports ${spec}`).not.toMatch(/^@\/lib\/auth\//);
    expect(spec, `${label} imports ${spec}`).not.toMatch(/^@\/lib\/agent\/persist/);
    if (spec.includes("/realtime/")) {
      expect(ALLOWED_REALTIME.has(spec), `${label} imports ${spec}`).toBe(true);
    }
  }
}

describe("action modules are safe to run in a visitor's tab", () => {
  it("finds the action modules, define-crud included, and what they import", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("define-crud.ts");
    expect(reached).toContain(path.join("lib", "stores", "workspace-store.ts"));
  });

  it.each(files)("%s makes no network call of its own", (file) => {
    expectNoNetwork(codeOnly(readFileSync(path.join(ROOT, file), "utf8")), file);
  });

  it.each(files)("%s imports no Supabase, sync or realtime client", (file) => {
    expectNoClients(importsOf(readFileSync(path.join(ROOT, file), "utf8")), file);
  });

  it.each(reached)("%s (imported by an action) makes no network call either", (file) => {
    expectNoNetwork(codeOnly(readFileSync(path.join(SRC, file), "utf8")), file);
  });

  it.each(reached)("%s (imported by an action) imports no client either", (file) => {
    const imports = importsOf(readFileSync(path.join(SRC, file), "utf8"));
    expectNoClients(
      imports.filter((spec) => spec !== SYNC_REGISTRATION_OK[file]),
      file
    );
  });

  it("starts the sync engine only for a signed-in owner, so a visitor's writes stay local", () => {
    const provider = codeOnly(readFileSync(path.join(SRC, "lib/sync/sync-provider.tsx"), "utf8"));
    const gate = provider.indexOf("if (!gateOpen || !user || !supabase)");
    const stop = provider.indexOf("syncEngine.stop();", gate);
    const start = provider.indexOf("syncEngine.start(supabase, user.id)");
    expect(gate).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(gate);
    expect(start).toBeGreaterThan(stop);
    expect(provider.match(/syncEngine\.start\(/g)).toHaveLength(1);
  });

  it("keeps the server store's database client server-only", () => {
    const store = readFileSync(path.join(ROOT, "server-store.ts"), "utf8");
    expect(store).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(store).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE/);
    // Only the server helpers are taken from it.
    for (const file of files) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      const imports = Array.from(
        src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\.?\/server-store["']/g)
      );
      for (const m of imports) {
        const names = m[1]
          .split(",")
          .map((n: string) => n.trim().replace(/^type\s+/, ""))
          .filter(Boolean);
        for (const n of names)
          expect(n, `${file} takes ${n}`).toMatch(/^(server[A-Z]|kindFromToolId)/);
      }
    }
  });

  it("closes every canvas action to visitors", () => {
    const canvas = readFileSync(path.join(ROOT, "tools/canvas.ts"), "utf8");
    const registrations = canvas.split("registry.register(").slice(1);
    expect(registrations.length).toBeGreaterThan(0);
    for (const r of registrations) {
      expect(r, r.slice(0, 80)).toMatch(/toolId: "tool\.canvas",[\s\S]*?visitor: false,/);
    }
  });
});
