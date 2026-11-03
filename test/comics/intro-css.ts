/**
 * Reads the animations out of an intro scene's CSS module, so a test can hold
 * the scene to its timing rules (see IntroOverlay in components/intro):
 *
 * - every animation is one `animation:` shorthand with a literal duration and,
 *   if it waits, a literal delay after it (`name 0.6s ease 2.4s both`);
 * - nothing loops (Amr's frames are global CSS, not the scene's);
 * - the overlay's class has exactly one animation, the exit, ending when the
 *   intro does.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export interface SceneAnimation {
  /** The rule's selector, as written. */
  selector: string;
  name: string;
  /** Seconds. */
  duration: number;
  /** Seconds. */
  delay: number;
  iterations: number | "infinite";
}

const KEYWORDS = new Set([
  "none",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "infinite",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
]);

function seconds(token: string): number | null {
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(token);
  if (!match) return null;
  return match[2] === "ms" ? Number(match[1]) / 1000 : Number(match[1]);
}

/** Split on `sep` outside parentheses: cubic-bezier(…) has commas of its own. */
function splitTop(value: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseOne(selector: string, value: string): SceneAnimation {
  // Function tokens (cubic-bezier(…), steps(…)) are timing, never a name.
  const tokens = splitTop(value.replace(/\s+/g, " "), " ");
  const times: number[] = [];
  let name = "";
  let iterations: number | "infinite" = 1;
  for (const token of tokens) {
    const time = seconds(token);
    if (time !== null) times.push(time);
    else if (token === "infinite") iterations = "infinite";
    else if (/^\d*\.?\d+$/.test(token)) iterations = Number(token);
    else if (/^(?:cubic-bezier|steps|linear)\(/.test(token) || KEYWORDS.has(token)) continue;
    else if (token.includes("(")) {
      // var(--d) or calc(…) would read as no delay and slip past the timing rules.
      throw new Error(`${selector}: "${token}" in "${value}" isn't a literal time`);
    } else name = token;
  }
  if (!name) throw new Error(`${selector}: no animation name in "${value}"`);
  if (times.length === 0) throw new Error(`${selector}: "${value}" has no literal duration`);
  return { selector, name, duration: times[0], delay: times[1] ?? 0, iterations };
}

/** Every animation in `file` (relative to the repo root), in source order. */
export function sceneAnimations(file: string): SceneAnimation[] {
  const css = readFileSync(path.join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found: SceneAnimation[] = [];
  // Innermost blocks only: a rule inside @media still has its own selector.
  for (const block of Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))) {
    const selector = block[1].trim();
    const decls = block[2].matchAll(/(?:^|;)\s*(animation(?:-[a-z-]+)?)\s*:\s*([^;]+)/g);
    for (const decl of Array.from(decls)) {
      if (decl[1] !== "animation") {
        // Inside @keyframes a timing function per step is fine; elsewhere the
        // longhands would hide a delay or a loop from this check.
        if (decl[1] === "animation-timing-function") continue;
        throw new Error(`${selector}: use the animation shorthand, not ${decl[1]}`);
      }
      for (const one of splitTop(decl[2], ",")) found.push(parseOne(selector, one));
    }
  }
  return found;
}

/** When an animation is over, in seconds after the overlay appears. */
export function endsAt(animation: SceneAnimation): number {
  if (animation.iterations === "infinite") return Infinity;
  return animation.delay + animation.duration * animation.iterations;
}
