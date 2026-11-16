// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * What every visitor downloads must stay light. The owner's agent runtime
 * (the action registry with its 305 actions and zod, and the agent client)
 * used to ride along with the app shell and the mascot, adding ~100 KB
 * brotli to every page for a feature only the owner can use. The owner
 * chat loads it from components/agent/mascot/owner-agent-panel, behind a
 * dynamic import.
 *
 * Visitor AI keeps the same line. The panel (visitor-panel), the tool
 * finder (visitor-guide) and the consent card are one chunk of their own
 * (visitor-body), which Amr's chunk reaches only by a dynamic import
 * (lazy-visitor-body) and fetches ahead on every visitor's page, so the walk
 * keeps it to the every-page rules; the visitor's chat (visitor-agent-panel)
 * is a further chunk, reached only by a dynamic import; and the runtime
 * behind it (lib/agent/visitor-runtime: the registry and the client) loads
 * only on the visitor's first message, by another dynamic import. No visitor
 * file reaches the owner's Supabase persistence.
 *
 * The chat revamp adds two folders. src/components/agent/comic/ holds the
 * runtime-free comic parts (balloons, captions), which every page may use;
 * src/components/agent/chat/ holds the runtime chat parts, which no
 * every-page module may reach.
 *
 * Instead of hand-kept file lists, the test walks the import graph: it
 * parses each module with the TypeScript parser, resolves `@/` and relative
 * specifiers to files, and follows static imports and re-exports
 * (`export … from`). It never follows an `import()` call, which is what
 * next/dynamic, React.lazy and the hand-written loaders all use: a dynamic
 * import is a chunk boundary. `import type` and all-`type` binding lists
 * are skipped, because the compiler drops them; a plain import used only
 * for types is still followed, so the walk errs on the strict side. Every
 * repo specifier must resolve, or a whole subtree would drop out unseen.
 */

const ROOT = process.cwd();

const APP_SHELL = "src/components/layout/app-shell.tsx";
const HEADER = "src/components/layout/header.tsx";
const MASCOT = "src/components/agent/mascot/mascot-assistant.tsx";
const MOMENT_CHIP = "src/components/notify/moment-chip.tsx";
const VISITOR_BODY = "src/components/agent/mascot/visitor-body.tsx";
const VISITOR_BODY_LOADER = "src/components/agent/mascot/lazy-visitor-body.tsx";
const VISITOR_PANEL = "src/components/agent/mascot/visitor-panel.tsx";
const VISITOR_GUIDE = "src/components/agent/mascot/visitor-guide.tsx";
const VISITOR_CONSENT = "src/components/agent/mascot/visitor-ai-consent.tsx";
const VISITOR_CHAT = "src/components/agent/mascot/visitor-agent-panel.tsx";
const VISITOR_RUNTIME = "src/lib/agent/visitor-runtime.ts";
const OWNER_PANEL = "src/components/agent/mascot/owner-agent-panel.tsx";
const REGISTER_ALL = "src/lib/actions/register-all.ts";
const AGENT_CLIENT = "src/lib/agent/client.ts";
const PERSIST = "src/lib/agent/persist.ts";
const MARKDOWN_VIEW = "src/components/agent/markdown.tsx";
const MARKDOWN_PARSER = "src/lib/agent/markdown.ts";
const UTILS = "src/lib/utils.ts";
const COMIC_DIR = "src/components/agent/comic/";
const STRIP_PARTS = `${COMIC_DIR}strip-parts.tsx`;
const CHAT_DIR = "src/components/agent/chat/";
const INK_DIRS = ["src/components/ink/", "src/lib/ink/"];

/**
 * The modules on every page. The app shell loads mascot-assistant with
 * next/dynamic, so the walk would stop there, but Amr mounts on every page:
 * it is a root of its own. So is the visitor body: Amr's chunk loads it with
 * a dynamic import, but fetches it ahead on every visitor's page.
 */
const EVERY_PAGE = [APP_SHELL, HEADER, MASCOT, VISITOR_BODY];

/**
 * What the visitor body takes out of Amr's own chunk (every page loads that
 * one, and its budget is tight): the visitor views and the guide's data.
 */
const VISITOR_BODY_MODULES = [
  VISITOR_BODY,
  VISITOR_PANEL,
  VISITOR_GUIDE,
  VISITOR_CONSENT,
  "src/lib/constants/jobs.ts",
  "src/lib/search/tool-search.ts",
  "src/lib/tools/guides/index.ts",
];

/** The first-load shell, without what it loads through next/dynamic. */
const STATIC_SHELL = [APP_SHELL, HEADER, MOMENT_CHIP];

/** The owner's agent runtime and the owner's chat. */
const OWNER_RUNTIME = [
  REGISTER_ALL,
  "src/lib/actions/registry.ts",
  AGENT_CLIENT,
  "src/lib/agent/execute-tool.ts",
  "src/lib/agent/visitor-tools.ts",
  VISITOR_RUNTIME,
  PERSIST,
  OWNER_PANEL,
  "src/components/agent/agent-conversation.tsx",
  "src/components/agent/conversation-list.tsx",
];

/** Amr's sprite engine: the scene tables, the pose maths, the clips and the packs. */
const HEAVY_ENGINE = [
  "src/components/agent/mascot/mascot-packs.ts",
  "src/components/agent/mascot/engine/scenes.ts",
  "src/components/agent/mascot/engine/sprite-poses.ts",
  "src/components/agent/mascot/engine/clips.ts",
];

// ── The parser ──────────────────────────────────────────────────────────

interface Imports {
  /** Specifiers that ship in the importer's chunk: imports, re-exports, require(). */
  static: string[];
  /** Specifiers loaded with an `import()` call: next/dynamic, React.lazy, loaders. */
  lazy: string[];
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** `{ type A, type B }`: every binding is a type, so the compiler drops the statement. */
function onlyTypes(bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined): boolean {
  if (!bindings || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) return false;
  return bindings.elements.length > 0 && bindings.elements.every((el) => el.isTypeOnly);
}

/** The specifiers a module imports, split into same-chunk and dynamic ones. */
function moduleImports(source: string, fileName = "inline.tsx"): Imports {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(fileName)
  );
  const found: Imports = { static: [], lazy: [] };
  for (const node of file.statements) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause && !clause.name && onlyTypes(clause.namedBindings)) continue;
      if (ts.isStringLiteral(node.moduleSpecifier)) found.static.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly || onlyTypes(node.exportClause)) continue;
      if (ts.isStringLiteral(node.moduleSpecifier)) found.static.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.static.push(node.moduleReference.expression.text);
    }
  }
  // `typeof import("x")` is a type node, not a call, so it never lands here.
  if (/\b(?:import|require)\s*\(/.test(source)) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const [first] = node.arguments;
        if (first && ts.isStringLiteralLike(first)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.lazy.push(first.text);
          else if (ts.isIdentifier(node.expression) && node.expression.text === "require")
            found.static.push(first.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

// ── The resolver ────────────────────────────────────────────────────────

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const CODE = /\.[cm]?[jt]sx?$/;

type Target = { file: string } | { pkg: string } | { unresolved: string };

function isFile(abs: string): boolean {
  return statSync(abs, { throwIfNoEntry: false })?.isFile() ?? false;
}

function repoPath(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

/** Where a specifier points: a repo file (POSIX, from the repo root) or a package. */
function resolveImport(spec: string, from: string): Target {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../"))
    base = path.resolve(ROOT, path.dirname(from), spec);
  else return { pkg: spec };
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  const hit = candidates.find(isFile);
  return hit ? { file: repoPath(hit) } : { unresolved: `${from} imports "${spec}"` };
}

/** "@scope/name/sub" → "@scope/name"; "name/sub" → "name". */
function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// ── The walk ────────────────────────────────────────────────────────────

const parsed = new Map<string, Imports>();
const unresolved = new Set<string>();

/** A repo file's imports; CSS, JSON and other assets import nothing. */
function importsOf(file: string): Imports {
  let found = parsed.get(file);
  if (!found) {
    found = CODE.test(file)
      ? moduleImports(readFileSync(path.join(ROOT, file), "utf8"), file)
      : { static: [], lazy: [] };
    parsed.set(file, found);
  }
  return found;
}

/** The files and packages a module's dynamic imports load. */
function lazyTargets(file: string): string[] {
  const out: string[] = [];
  for (const spec of importsOf(file).lazy) {
    const target = resolveImport(spec, file);
    if ("file" in target) out.push(target.file);
    else if ("pkg" in target) out.push(target.pkg);
    else unresolved.add(target.unresolved);
  }
  return out;
}

function staticTargets(file: string): string[] {
  const out: string[] = [];
  for (const spec of importsOf(file).static) {
    const target = resolveImport(spec, file);
    if ("file" in target) out.push(target.file);
    else if ("pkg" in target) out.push(target.pkg);
    else unresolved.add(target.unresolved);
  }
  return out;
}

interface Closure {
  /** Every repo file reached, with the file that first imported it (null for a root). */
  files: Map<string, string | null>;
  /** Every package reached, with the file that first imported it. */
  packages: Map<string, string>;
}

/** Everything the roots pull into their chunks, breadth first (shortest chains). */
function closure(roots: readonly string[]): Closure {
  const files = new Map<string, string | null>();
  const packages = new Map<string, string>();
  const queue: string[] = [];
  for (const root of roots) {
    if (!isFile(path.join(ROOT, root))) throw new Error(`walk root ${root} does not exist`);
    if (!files.has(root)) {
      files.set(root, null);
      queue.push(root);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    for (const spec of importsOf(file).static) {
      const target = resolveImport(spec, file);
      if ("file" in target) {
        if (!files.has(target.file)) {
          files.set(target.file, file);
          queue.push(target.file);
        }
      } else if ("pkg" in target) {
        if (!packages.has(target.pkg)) packages.set(target.pkg, file);
      } else {
        unresolved.add(target.unresolved);
      }
    }
  }
  return { files, packages };
}

/** "root → … → file", for failure messages. */
function chainTo(c: Closure, file: string): string {
  const steps: string[] = [];
  let at: string | null | undefined = file;
  while (at) {
    steps.unshift(at);
    at = c.files.get(at);
  }
  return steps.join(" → ");
}

interface Ban {
  label: string;
  file?: (file: string) => boolean;
  pkg?: (spec: string) => boolean;
}

const exactly = (file: string): Ban => ({ label: file, file: (f) => f === file });
const under = (dir: string): Ban => ({ label: `${dir}**`, file: (f) => f.startsWith(dir) });
const pkgNamed = (re: RegExp, label: string): Ban => ({
  label,
  pkg: (spec) => re.test(packageName(spec)),
});

/** Each banned file or package the closure reaches, with the chain that reaches it. */
function violations(c: Closure, bans: readonly Ban[]): string[] {
  const out: string[] = [];
  for (const ban of bans) {
    if (ban.file) {
      for (const file of Array.from(c.files.keys())) {
        if (ban.file(file)) out.push(`${ban.label}: ${chainTo(c, file)}`);
      }
    }
    if (ban.pkg) {
      for (const [spec, importer] of Array.from(c.packages)) {
        if (ban.pkg(spec)) out.push(`${ban.label}: ${chainTo(c, importer)} → ${spec}`);
      }
    }
  }
  return out;
}

function filesUnder(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}${entry.name}`;
    if (entry.isDirectory()) return filesUnder(`${rel}/`);
    return CODE.test(entry.name) ? [rel] : [];
  });
}

const OWNER_BANS = OWNER_RUNTIME.map(exactly);
const SUPABASE: Ban = {
  label: "Supabase",
  file: (f) => /supabase/i.test(f),
  pkg: (spec) => /supabase/i.test(spec),
};

let everyPage: Closure;
let mascotChunk: Closure;
let staticShell: Closure;
let visitorPanel: Closure;
let visitorChat: Closure;
let comic: Closure;
let comicFiles: string[];
let utilsPackages: string[];

beforeAll(() => {
  everyPage = closure(EVERY_PAGE);
  mascotChunk = closure([MASCOT]);
  staticShell = closure(STATIC_SHELL);
  visitorPanel = closure([VISITOR_PANEL]);
  visitorChat = closure([VISITOR_CHAT]);
  comicFiles = filesUnder(COMIC_DIR);
  comic = closure(comicFiles);
  utilsPackages = Array.from(closure([UTILS]).packages.keys());
}, 60_000);

// ── Self-tests: the parser, the resolver and the walk ───────────────────

describe("import graph walk (self-tests)", () => {
  it("parses every import form, skips types, comments and strings, and splits off import()", () => {
    const src = [
      'import a from "./a";',
      "import {",
      "  b,",
      "  type B,",
      '} from "./b";',
      'import type { T } from "./type-only";',
      'import { type U, type V } from "./inline-types";',
      'import "./side-effect.css";',
      'import * as ns from "./namespace";',
      'export { c } from "./re-export";',
      'export * from "./star";',
      'export * as all from "./star-as";',
      'export type { W } from "./type-export";',
      'export { type X } from "./inline-type-export";',
      'import cjs = require("./import-equals");',
      'const req = require("./required");',
      '// import nope from "./line-comment";',
      '/* import "./block-comment"; */',
      "const s = \"import('./in-a-string')\";",
      'type M = typeof import("./type-position");',
      'const Dyn = dynamic(() => import("./next-dynamic"), { ssr: false });',
      'const Lazy = lazy(() => import("./react-lazy"));',
      'const load = () => import("./loader").then((m) => m.x);',
      "const tpl = () => import(`./template`);",
    ].join("\n");
    const found = moduleImports(src);
    expect(found.static.sort()).toEqual(
      [
        "./a",
        "./b",
        "./side-effect.css",
        "./namespace",
        "./re-export",
        "./star",
        "./star-as",
        "./import-equals",
        "./required",
      ].sort()
    );
    expect(found.lazy.sort()).toEqual(
      ["./next-dynamic", "./react-lazy", "./loader", "./template"].sort()
    );
  });

  it("finds the imports real modules are known to have", () => {
    const mascot = importsOf(MASCOT);
    expect(mascot.static).toEqual(
      expect.arrayContaining([
        "react",
        "./mascot-bubble",
        "./panel-parts",
        "./lazy-visitor-body",
        "./engine/figure-metrics",
        "./mascot-assistant.module.css",
      ])
    );
    // React.lazy, through loaders that can try again after a failed import.
    expect(mascot.lazy).toEqual(expect.arrayContaining(["./mascot-sprite", "./owner-agent-panel"]));
    expect(mascot.static).not.toContain("./owner-agent-panel");
    expect(mascot.static).not.toContain("./mascot-sprite");
    for (const spec of ["./visitor-body", "./visitor-guide", "./visitor-panel"]) {
      expect(mascot.static, spec).not.toContain(spec);
    }
    // A loader function's import(): the visitor body.
    expect(importsOf(VISITOR_BODY_LOADER).lazy).toEqual(["./visitor-body"]);
    expect(importsOf(VISITOR_BODY_LOADER).static).not.toContain("./visitor-body");

    // Multi-line named imports.
    expect(importsOf(HEADER).static).toEqual(
      expect.arrayContaining(["@/components/ui/breadcrumb", "lucide-react", "next/link"])
    );
    // next/dynamic with a .then() picker.
    expect(importsOf(APP_SHELL).lazy).toContain("@/components/agent/mascot/mascot-assistant");
    // A re-export.
    expect(importsOf("src/components/agent/mascot/engine/sprite-poses.ts").static).toContain(
      "./figure-metrics"
    );
    // A bare side-effect import.
    expect(importsOf(OWNER_PANEL).static).toContain("@/lib/actions/register-all");
    // React.lazy through a loader; `import type` and `typeof import()` are not imports.
    const panel = importsOf(VISITOR_PANEL);
    expect(panel.lazy).toContain("./visitor-agent-panel");
    expect(panel.static).not.toContain("./visitor-agent-panel");
    expect(panel.static).not.toContain("@/lib/visitor-ai/contract");
  });

  it("resolves aliases, relative paths, folder indexes, assets and packages", () => {
    expect(resolveImport("@/lib/utils", HEADER)).toEqual({ file: UTILS });
    expect(resolveImport("./header", APP_SHELL)).toEqual({ file: HEADER });
    expect(resolveImport("./engine/figure-metrics", MASCOT)).toEqual({
      file: "src/components/agent/mascot/engine/figure-metrics.ts",
    });
    expect(resolveImport("@/components/collab/vote-room", HEADER)).toEqual({
      file: "src/components/collab/vote-room/index.ts",
    });
    expect(resolveImport("./mascot-assistant.module.css", MASCOT)).toEqual({
      file: "src/components/agent/mascot/mascot-assistant.module.css",
    });
    expect(resolveImport("next/dynamic", MASCOT)).toEqual({ pkg: "next/dynamic" });
    expect(resolveImport("./no-such-module", MASCOT)).toHaveProperty("unresolved");
    expect(packageName("@supabase/ssr/dist/x")).toBe("@supabase/ssr");
    expect(packageName("remark-gfm")).toBe("remark-gfm");
  });

  it("resolves every repo import the walks meet, static and dynamic", () => {
    // A specifier that resolves nowhere would drop its whole subtree unseen.
    for (const c of [everyPage, mascotChunk, staticShell, visitorPanel, visitorChat, comic]) {
      for (const file of Array.from(c.files.keys())) lazyTargets(file);
    }
    expect(Array.from(unresolved)).toEqual([]);
  });

  it("walks into mascot-assistant and the visitor body on every page, though both load lazily", () => {
    expect(lazyTargets(APP_SHELL)).toContain(MASCOT);
    expect(staticTargets(APP_SHELL)).not.toContain(MASCOT);
    expect(everyPage.files.has(MASCOT)).toBe(true);
    expect(staticTargets(MASCOT)).toContain(VISITOR_BODY_LOADER);
    expect(lazyTargets(VISITOR_BODY_LOADER)).toContain(VISITOR_BODY);
    expect(everyPage.files.has(VISITOR_BODY)).toBe(true);
    for (const file of [
      "src/components/agent/mascot/mascot-bubble.tsx",
      VISITOR_PANEL,
      VISITOR_GUIDE,
      VISITOR_CONSENT,
    ]) {
      expect(everyPage.files.has(file), `${file} on every page`).toBe(true);
    }
    // A dynamic import is a boundary: the sprite stays out of the walk.
    expect(everyPage.files.has("src/components/agent/mascot/mascot-sprite.tsx")).toBe(false);
  });

  it("stops the static shell at next/dynamic", () => {
    // The extra roots must be what app-shell really ships in its first chunk:
    // a walk from app-shell alone, which seeds nothing else, has to reach them.
    const fromShell = closure([APP_SHELL]);
    for (const file of STATIC_SHELL) {
      expect(fromShell.files.has(file), `app-shell statically reaches ${file}`).toBe(true);
    }
    expect(fromShell.files.has(MASCOT)).toBe(false);
    expect(staticShell.files.has(MASCOT)).toBe(false);
  });

  it("names real files in every ban, and walks the modules the bans are about", () => {
    for (const file of [
      ...OWNER_RUNTIME,
      ...HEAVY_ENGINE,
      ...VISITOR_BODY_MODULES,
      MARKDOWN_VIEW,
      MARKDOWN_PARSER,
    ]) {
      expect(isFile(path.join(ROOT, file)), `${file} exists`).toBe(true);
    }
    // The owner chunk is where the runtime lives, so banning it means something:
    // it loads the registry itself, and its chat reaches the client.
    expect(staticTargets(OWNER_PANEL)).toContain(REGISTER_ALL);
    expect(closure([OWNER_PANEL]).files.has(AGENT_CLIENT)).toBe(true);
    // Amr's own chunk uses the engine the static shell must not carry.
    expect(staticTargets(MASCOT)).toEqual(
      expect.arrayContaining([
        "src/components/agent/mascot/engine/sprite-poses.ts",
        "src/components/agent/mascot/engine/scenes.ts",
      ])
    );
    // The visitor's chat renders markdown, so its walk reaches the renderer.
    expect(visitorChat.files.has(MARKDOWN_VIEW)).toBe(true);
    expect(visitorPanel.files.has(VISITOR_GUIDE)).toBe(true);
    expect(visitorPanel.files.has(VISITOR_CONSENT)).toBe(true);
    expect(comicFiles).toContain("src/components/agent/comic/comic-parts.tsx");
  });
});

// ── The rules ───────────────────────────────────────────────────────────

describe("every-page bundle", () => {
  it("never reaches the owner runtime, the visitor's chat, the chat parts or markdown", () => {
    const bans = [
      ...OWNER_BANS,
      exactly(VISITOR_CHAT),
      under(CHAT_DIR),
      {
        label: "src/components/agent/markdown.*",
        file: (f: string) => f.startsWith("src/components/agent/markdown."),
      },
      exactly(MARKDOWN_PARSER),
    ];
    expect(violations(everyPage, bans)).toEqual([]);
  });

  it("keeps the visitor body out of Amr's own chunk: only a dynamic import reaches it", () => {
    expect(violations(mascotChunk, VISITOR_BODY_MODULES.map(exactly))).toEqual([]);
    // The walk sees the views once it follows that import, so the ban above bites.
    expect(closure([VISITOR_BODY]).files.has(VISITOR_GUIDE)).toBe(true);
  });

  it("keeps Amr's sprite engine out of the static shell", () => {
    expect(violations(staticShell, HEAVY_ENGINE.map(exactly))).toEqual([]);
  });

  it("reaches the owner's chat only through a dynamic import in mascot-assistant", () => {
    expect(lazyTargets(MASCOT)).toContain(OWNER_PANEL);
  });
});

describe("the chat strip (chat/)", () => {
  const OWNER_CHAT = "src/components/agent/agent-conversation.tsx";
  const STRIP = [
    `${CHAT_DIR}chat-strip.tsx`,
    `${CHAT_DIR}chat-frame.tsx`,
    `${CHAT_DIR}chat-log.tsx`,
    `${CHAT_DIR}chat-items.tsx`,
    `${CHAT_DIR}chat-context.tsx`,
    `${CHAT_DIR}use-stick-to-bottom.ts`,
    `${CHAT_DIR}use-turn-announcer.ts`,
  ];

  it("is what both chats draw, reached by a static import from each container", () => {
    const ownerChat = closure([OWNER_CHAT]);
    for (const file of STRIP) {
      expect(isFile(path.join(ROOT, file)), `${file} exists`).toBe(true);
      expect(visitorChat.files.has(file), `the visitor's chat reaches ${file}`).toBe(true);
      expect(ownerChat.files.has(file), `the owner's chat reaches ${file}`).toBe(true);
    }
    expect(staticTargets(VISITOR_CHAT)).toContain(`${CHAT_DIR}chat-strip.tsx`);
    expect(staticTargets(OWNER_CHAT)).toContain(`${CHAT_DIR}chat-strip.tsx`);
  });

  it("is reached from no every-page root: the ban covers every file in the folder", () => {
    const chatFiles = filesUnder(CHAT_DIR);
    expect(chatFiles).toEqual(expect.arrayContaining(STRIP));
    for (const file of chatFiles) {
      expect(everyPage.files.has(file), `${file} stays off every page`).toBe(false);
      expect(staticShell.files.has(file), `${file} stays out of the static shell`).toBe(false);
    }
  });

  it("keeps the chat's own comic parts off every page, though both chats reach them", () => {
    // webpack keeps each export a chunk uses inside the module that holds it,
    // so a part in comic-parts.tsx (which every-page code imports) would ship
    // on every page once the chat drew it. The chat-only parts live apart.
    expect(comicFiles).toContain(STRIP_PARTS);
    expect(everyPage.files.has(STRIP_PARTS), "strip-parts stays off every page").toBe(false);
    expect(staticShell.files.has(STRIP_PARTS), "strip-parts stays out of the static shell").toBe(
      false
    );
    expect(visitorChat.files.has(STRIP_PARTS)).toBe(true);
    expect(closure([OWNER_CHAT]).files.has(STRIP_PARTS)).toBe(true);
  });

  it("keeps the owner's step Details out of the visitor's chat: only the owner's chat imports it", () => {
    const owned = [`${CHAT_DIR}step-details.tsx`, "src/lib/agent/tool-details.ts"];
    const ownerChat = closure([OWNER_CHAT]);
    for (const file of owned) {
      expect(isFile(path.join(ROOT, file)), `${file} exists`).toBe(true);
      expect(ownerChat.files.has(file), `the owner's chat reaches ${file}`).toBe(true);
      expect(visitorChat.files.has(file), `the visitor's chat never reaches ${file}`).toBe(false);
    }
    expect(staticTargets(OWNER_CHAT)).toContain(`${CHAT_DIR}step-details.tsx`);
  });

  it("replaced message-bubble: no file is left, and nothing imports it", () => {
    expect(isFile(path.join(ROOT, "src/components/agent/message-bubble.tsx"))).toBe(false);
    const reached = new Set([
      ...Array.from(visitorChat.files.keys()),
      ...Array.from(closure([OWNER_CHAT]).files.keys()),
    ]);
    expect(Array.from(reached).filter((f) => /message-bubble/.test(f))).toEqual([]);
  });
});

describe("comic parts", () => {
  const allowedFile = (f: string) =>
    f === UTILS || f.startsWith(COMIC_DIR) || INK_DIRS.some((dir) => f.startsWith(dir));

  it("import only react, @/lib/utils, ink and each other", () => {
    const stray: string[] = [];
    for (const file of comicFiles) {
      for (const target of [...staticTargets(file), ...lazyTargets(file)]) {
        const ok = target.startsWith("src/") ? allowedFile(target) : target === "react";
        if (!ok) stray.push(`${file} imports ${target}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it("pull in nothing beyond them, whatever ink and utils import", () => {
    const allowedPackages = new Set(["react", ...utilsPackages]);
    const stray = [
      ...Array.from(comic.files.keys())
        .filter((f) => !allowedFile(f))
        .map((f) => chainTo(comic, f)),
      ...Array.from(comic.packages)
        .filter(([spec]) => !allowedPackages.has(spec))
        .map(([spec, importer]) => `${chainTo(comic, importer)} → ${spec}`),
    ];
    expect(stray).toEqual([]);
  });
});

describe("visitor bundle", () => {
  it("reaches the visitor's chat only through a dynamic import in the panel", () => {
    expect(lazyTargets(VISITOR_PANEL)).toContain(VISITOR_CHAT);
  });

  it("loads the agent runtime only with a dynamic import, from the visitor's chat", () => {
    expect(lazyTargets(VISITOR_CHAT)).toContain(VISITOR_RUNTIME);
  });

  it("keeps the runtime the only place the visitor chat gets the registry from", () => {
    expect(staticTargets(VISITOR_RUNTIME)).toContain(REGISTER_ALL);
  });

  it("keeps the visitor's chat free of the runtime, Supabase, export and remark code", () => {
    const bans = [
      ...OWNER_BANS,
      SUPABASE,
      pkgNamed(/^html-to-image$/, "html-to-image"),
      pkgNamed(/^file-saver$/, "file-saver"),
      pkgNamed(/^remark/, "remark*"),
    ];
    expect(violations(visitorChat, bans)).toEqual([]);
  });

  it("keeps the panel, tool finder and consent card off the owner's persistence", () => {
    expect(violations(visitorPanel, [exactly(PERSIST), SUPABASE])).toEqual([]);
  });

  it("never loads the owner's persistence or Supabase from a visitor file, even lazily", () => {
    const visitorFiles = new Set(
      Array.from(visitorPanel.files.keys()).concat(Array.from(visitorChat.files.keys()))
    );
    const lazyHits: string[] = [];
    for (const file of Array.from(visitorFiles)) {
      for (const target of lazyTargets(file)) {
        if (target === PERSIST || /supabase/i.test(target)) lazyHits.push(`${file} → ${target}`);
      }
    }
    expect(lazyHits).toEqual([]);
  });
});
