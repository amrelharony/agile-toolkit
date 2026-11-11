// @vitest-environment node
/**
 * Every page change goes through lib/motion/page-transition.ts, so its rules
 * (instant for links that do not load ahead, the phone menu, bare routes,
 * reduced motion ...) hold everywhere. Internal links render
 * components/motion/transition-link.tsx; code that changes the page itself
 * calls pushWithTransition. The exceptions are named here with their
 * reasons, and the lists are checked against the code both ways, so a new
 * exception has to be written down and a stale one is noticed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

const sources = (function walk(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) return [];
    return [
      {
        file: path.relative(ROOT, full).split(path.sep).join("/"),
        text: readFileSync(full, "utf8"),
      },
    ];
  });
})(SRC);

const read = (file: string) => sources.find((s) => s.file === file)?.text ?? "";

const BARE =
  "a bare route: it renders without the app shell's router, so its links change pages as before";

/** The files that may import next/link, and why. */
const NEXT_LINK_ALLOWED: Record<string, string> = {
  "src/components/motion/transition-link.tsx": "the wrapper itself renders next/link",
  "src/app/auth/sign-in/sign-in-card.tsx": BARE,
  "src/app/not-authorized/page.tsx": BARE,
  "src/app/join/[tool]/[code]/page.tsx": BARE,
  "src/app/join/[tool]/[code]/join-room.tsx": BARE,
  "src/app/(guest)/guest/[tool]/[entityId]/guest-tool-placeholder.tsx": BARE,
  "src/app/(guest)/guest/canvas/[boardId]/guest-canvas-client.tsx": BARE,
  "src/app/(guest)/guest/kudos/[entityId]/guest-kudos-client.tsx": BARE,
  "src/app/(guest)/guest/planning-poker/[roomCode]/guest-poker-client.tsx": BARE,
  "src/app/(tools)/comics/components/story-nav.tsx":
    "the story buttons: the reader's page turn converts them with their own kinds",
};

/** The files that may call router.push or router.replace themselves, how often, and why. */
const PUSH_ALLOWED: Record<string, { calls: number; why: string }> = {
  "src/app/(guest)/guest/guest-home-client.tsx": { calls: 2, why: "a guest flow on a bare route" },
  "src/app/(guest)/guest/join/join-client.tsx": { calls: 1, why: "a guest flow on a bare route" },
  "src/app/(tools)/squad-session/squad-session-client.tsx": {
    calls: 3,
    why: "a query change on a force-dynamic page, which is never loaded ahead",
  },
  "src/components/auth/user-menu.tsx": {
    calls: 1,
    why: "the sign-out replace that leaves an owner page",
  },
  "src/app/(tools)/comics/components/story-nav.tsx": {
    calls: 2,
    why: "the story arrow keys: the reader's page turn takes them over",
  },
  "src/app/(tools)/sprint-planning/planning.tsx": {
    calls: 1,
    why: "after committing a sprint: /sprint is not loaded ahead",
  },
  "src/app/s/snapshot-client.tsx": {
    calls: 1,
    why: "after importing a snapshot: its target is not loaded ahead",
  },
};

/** Files that hold the router without pushing on it themselves. */
const ROUTER_HOLDERS = [
  // Lends it to page changes.
  "src/components/motion/route-signal.tsx",
  // Hands it to pushWithTransition for the plain path, and prefetches with it.
  "src/components/layout/command-palette.tsx",
];

const importsNextLink = (text: string) =>
  /from\s+["']next\/link["']|require\(\s*["']next\/link["']\s*\)|import\(\s*["']next\/link["']\s*\)/.test(
    text
  );

const pushCalls = (text: string) => (text.match(/\brouter\??\.(push|replace)\(/g) ?? []).length;

/** The shell's bare-route prefixes, read from app-shell.tsx. */
function barePrefixes(): string[] {
  const list = /export const BARE_ROUTE_PREFIXES = \[([^\]]*)\]/.exec(
    read("src/components/layout/app-shell.tsx")
  );
  expect(list, "app-shell.tsx exports BARE_ROUTE_PREFIXES").not.toBeNull();
  return Array.from(list![1].matchAll(/"([^"]+)"/g), (m) => m[1]);
}

/** A file's route under src/app, route groups taken out. */
function routeOf(file: string): string {
  const dir = path.posix.dirname(file.replace(/^src\/app\//, ""));
  return `/${dir
    .split("/")
    .filter((s) => s !== "." && !/^\(.*\)$/.test(s))
    .join("/")}`;
}

describe("next/link", () => {
  it("is imported only by TransitionLink and the named exceptions", () => {
    const importing = sources.filter((s) => importsNextLink(s.text)).map((s) => s.file);
    expect(importing.sort()).toEqual(Object.keys(NEXT_LINK_ALLOWED).sort());
  });

  it("gives every exception a reason", () => {
    for (const [file, why] of Object.entries(NEXT_LINK_ALLOWED)) {
      expect(why.length, file).toBeGreaterThan(10);
    }
  });

  it("names bare-route exceptions only under the shell's bare-route prefixes", () => {
    const prefixes = barePrefixes();
    for (const [file, why] of Object.entries(NEXT_LINK_ALLOWED)) {
      if (why !== BARE) continue;
      const route = routeOf(file);
      expect(
        prefixes.some((p) => route === p || route.startsWith(`${p}/`)),
        `${file} (${route}) is under a bare route`
      ).toBe(true);
    }
  });

  it("is replaced by the plain default import, with no legacyBehavior or passHref", () => {
    const converted = sources.filter((s) =>
      s.text.includes('from "@/components/motion/transition-link"')
    );
    expect(converted.length).toBeGreaterThan(100);
    for (const { file, text } of converted) {
      expect(text, file).toMatch(/^import Link from "@\/components\/motion\/transition-link";$/m);
      expect(text, file).not.toMatch(/\blegacyBehavior\b|\bpassHref\b/);
    }
  });
});

describe("router.push and router.replace", () => {
  it("are called only from the named exceptions, as often as listed", () => {
    const calling = Object.fromEntries(
      sources.filter((s) => pushCalls(s.text) > 0).map((s) => [s.file, pushCalls(s.text)])
    );
    const allowed = Object.fromEntries(
      Object.entries(PUSH_ALLOWED).map(([file, { calls }]) => [file, calls])
    );
    expect(calling).toEqual(allowed);
  });

  it("are not reached another way: no file takes push or replace out of the router", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/\{[^}]*\b(push|replace)\b[^}]*\}\s*=\s*useRouter\(/);
    }
  });

  it("leave the router hook to the exceptions and the two holders", () => {
    const users = sources
      .filter((s) => /\buseRouter\(\)/.test(s.text))
      .map((s) => s.file)
      .sort();
    expect(users).toEqual([...Object.keys(PUSH_ALLOWED), ...ROUTER_HOLDERS].sort());
  });

  it("go through pushWithTransition in the tool finder", () => {
    const palette = read("src/components/layout/command-palette.tsx");
    expect(palette).toMatch(/pushWithTransition\(tool\.path, \{ plain: router \}\)/);
    expect(pushCalls(palette)).toBe(0);
  });
});

describe("the shell's wiring", () => {
  const shell = read("src/components/layout/app-shell.tsx");
  const appShell = shell.slice(
    shell.indexOf("export function AppShell"),
    shell.indexOf("function FullAppShell")
  );

  it("renders RouteSignal inside its own Suspense, in both branches", () => {
    expect(appShell).toMatch(
      /const signal = \(\s*<Suspense fallback=\{null\}>\s*<RouteSignal isBare=\{isBareRoute\} \/>\s*<\/Suspense>\s*\);/
    );
    const returns = appShell.split(/\breturn\b/).slice(1);
    expect(returns).toHaveLength(2);
    for (const branch of returns) expect(branch).toContain("{signal}");
    // Nowhere else, so there is one arrival signal.
    expect(shell.match(/<RouteSignal\b/g)).toHaveLength(1);
  });

  it("keeps TransitionLink off next/navigation", () => {
    const link = read("src/components/motion/transition-link.tsx");
    expect(link).not.toMatch(/from\s+["']next\/navigation["']|import\(\s*["']next\/navigation/);
    expect(link).not.toMatch(/\b(useRouter|usePathname|useSearchParams)\b/);
  });
});
