/**
 * Static scan of the app's gamification event emitters, shared by the
 * outcome contract and XP coverage tests. It reads every .ts/.tsx file
 * under src and returns the canonical event names emitted with literal
 * arguments:
 *   - `emit("tool", "event")` / `sonify("tool", "event")` (a ternary second
 *     argument yields each branch; a `TOOL_ID` constant is resolved in-file);
 *   - `sonify("event")` in files bound with `useToolSonification("tool")`;
 *   - `emitUiEvent("x")` / `emitRtEvent("x")`;
 *   - any literal `"tool:<tool>:<event>"` string (direct engine dispatches).
 * Calls with non-literal names (e.g. a mood score lookup) are skipped.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/** Where event names are defined or consumed, not emitted. */
const DEFINITION_FILES = new Set([
  "lib/gamification/engine.ts",
  "lib/gamification/outcomes.ts",
  "lib/gamification/achievements.ts",
  "lib/gamification/challenges.ts",
  "lib/gamification/vdna-migrate.ts",
  "lib/sonification/emit.ts",
  "lib/sonification/use-sonification.ts",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "_generated") out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

export interface ScannedFile {
  path: string;
  text: string;
}

let cache: ScannedFile[] | null = null;

/** Every emitter-bearing source file (definition files left out). */
export function scannedFiles(): ScannedFile[] {
  if (!cache) {
    cache = sourceFiles(SRC)
      .map((full) => ({
        path: relative(SRC, full).replace(/\\/g, "/"),
        text: readFileSync(full, "utf8"),
      }))
      .filter((f) => !DEFINITION_FILES.has(f.path));
  }
  return cache;
}

/** The text of a call's argument list starting at `open` (index of "("). */
function callArgs(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return "";
}

/** Split on top-level commas. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of args) {
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Event names an argument can evaluate to: a bare literal, or the literals
 * in a ternary's branches (literals compared with ===/!== are conditions).
 * Null when the argument isn't built from literals.
 */
function literalValues(arg: string): string[] | null {
  const trimmed = arg.trim();
  const bare = /^"([^"]+)"$/.exec(trimmed);
  if (bare) return [bare[1]];
  if (!trimmed.includes("?")) return null;
  const out: string[] = [];
  const re = /(===|!==|==|!=)?\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) if (!m[1]) out.push(m[2]);
  return out.length ? out : null;
}

function canonical(toolId: string, eventName: string): string {
  if (toolId === "ui" || toolId === "rt" || toolId === "mascot") return `${toolId}:${eventName}`;
  return `tool:${toolId}:${eventName}`;
}

export interface Emission {
  name: string;
  file: string;
}

let emissionCache: Emission[] | null = null;

/** Canonical names of every literal emission in the app. */
export function scanEmissions(): Emission[] {
  if (emissionCache) return emissionCache;
  const out: Emission[] = [];
  for (const { path, text } of scannedFiles()) {
    const consts = new Map<string, string>();
    for (const m of Array.from(text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g))) {
      consts.set(m[1], m[2]);
    }
    const toolOf = (arg: string): string | null => {
      const t = arg.trim();
      const lit = /^"([a-z0-9-]+)"$/.exec(t);
      if (lit) return lit[1];
      return consts.get(t) ?? null;
    };

    // Two-argument emits.
    for (const m of Array.from(text.matchAll(/\b(?:emit|sonify)\(/g))) {
      const args = splitArgs(callArgs(text, m.index! + m[0].length - 1));
      if (args.length < 2) continue;
      const tool = toolOf(args[0]);
      const events = literalValues(args[1]);
      if (!tool || !events) continue;
      for (const e of events) out.push({ name: canonical(tool, e), file: path });
    }

    // Tool-bound sonify.
    const bound = /\bconst\s+(\w+)\s*=\s*useToolSonification\(\s*"([a-z0-9-]+)"\s*\)/.exec(text);
    if (bound) {
      const [, fn, tool] = bound;
      for (const m of Array.from(text.matchAll(new RegExp(`\\b${fn}\\(`, "g")))) {
        const args = splitArgs(callArgs(text, m.index! + m[0].length - 1));
        if (args.length !== 1) continue;
        for (const e of literalValues(args[0]) ?? []) {
          out.push({ name: canonical(tool, e), file: path });
        }
      }
    }

    for (const m of Array.from(text.matchAll(/\bemit(Ui|Rt)Event\(\s*"([a-z0-9-]+)"\s*\)/g))) {
      out.push({ name: canonical(m[1] === "Ui" ? "ui" : "rt", m[2]), file: path });
    }

    for (const m of Array.from(text.matchAll(/"(tool:[a-z0-9-]+:[a-z0-9-]+)"/g))) {
      out.push({ name: m[1], file: path });
    }
  }
  emissionCache = out;
  return out;
}

/** True when `literal` appears as a string literal in an emitter-bearing file. */
export function hasLiteral(literal: string): boolean {
  const quoted = `"${literal}"`;
  return scannedFiles().some((f) => f.text.includes(quoted));
}
