// @vitest-environment node
/**
 * The layers that never move during a page change: Amr's button, bubble and
 * chat panel, the docked timer and the top bar. globals.css names them only
 * while a transition runs (html[data-vt]), hides their old picture and shows
 * the live element as it is, above the moving page. The components carry the
 * matching data-vt-hold values, one element each.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type ChildNode, type Container, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const css = read("src/app/globals.css");
const tree = postcss.parse(css);

/** Each held name and the z-index of its group. */
const HELD: Record<string, string> = {
  header: "2",
  amr: "3",
  "amr-bubble": "3",
  "amr-panel": "3",
  "dock-timer": "3",
};
const NAMES = Object.keys(HELD).sort();

const SUPPORTS = "(view-transition-name: none)";

/** The at-rules around a node, innermost first. */
function atRulesAround(node: ChildNode): AtRule[] {
  const out: AtRule[] = [];
  let p = node.parent as Container | undefined;
  while (p && p.type !== "root") {
    if (p.type === "atrule") out.push(p as AtRule);
    p = p.parent as Container | undefined;
  }
  return out;
}

/** Inside @supports (view-transition-name: none), and then @media screen within it. */
function inScreenBlock(node: ChildNode): boolean {
  const around = atRulesAround(node);
  const supports = around.findIndex((a) => a.name === "supports" && a.params === SUPPORTS);
  const screen = around.findIndex((a) => a.name === "media" && a.params === "screen");
  return supports >= 0 && screen >= 0 && screen < supports;
}

function rules(): Rule[] {
  const out: Rule[] = [];
  tree.walkRules((r) => {
    out.push(r);
  });
  return out;
}

/** Every declaration applying to `selector`, from rules that list it, in the screen block. */
function declsFor(selector: string): Record<string, string> {
  const found = rules().filter((r) => r.selectors.includes(selector));
  expect(found.length, `${selector} has rules`).toBeGreaterThan(0);
  const out: Record<string, string> = {};
  for (const r of found) {
    expect(inScreenBlock(r), `${selector} sits in the screen block`).toBe(true);
    r.walkDecls((d) => {
      out[d.prop] = d.value;
    });
  }
  return out;
}

/**
 * The JSX opening tag containing `marker` (its first match), from its `<` to
 * its own `>`. A RegExp marker tells an attribute from the same words in a
 * selector string.
 */
function openingTag(src: string, marker: string | RegExp): string {
  const at = typeof marker === "string" ? src.indexOf(marker) : (marker.exec(src)?.index ?? -1);
  expect(at, `${marker} is in the file`).toBeGreaterThan(-1);
  const start = src.lastIndexOf("<", at);
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (depth > 0 && c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      continue;
    }
    if (depth > 0 && c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`no end to the tag around ${marker}`);
}

const holds = (tag: string, value: string) =>
  new RegExp(`\\sdata-vt-hold="${value}"(?=[\\s/>])`).test(tag);

/**
 * Every data-vt-hold value in src, with the files that use it, and the files
 * that set one from a variable. Read once at load, as guards.test.ts does,
 * so the walk does not count against a test's timeout on a slow runner.
 */
const holdValues: Record<string, string[]> = {};
const holdFromVariable: string[] = [];
(function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      const text = readFileSync(full, "utf8");
      if (!text.includes("data-vt-hold")) continue;
      const file = path.relative(ROOT, full).split(path.sep).join("/");
      for (const m of Array.from(text.matchAll(/data-vt-hold=["']([^"']*)["']/g))) {
        (holdValues[m[1]] ??= []).push(file);
      }
      if (/data-vt-hold=\{/.test(text)) holdFromVariable.push(file);
    }
  }
})(path.join(ROOT, "src"));

describe("the VIEW TRANSITIONS block", () => {
  it("sits after REDUCED MOTION and before MOBILE FOUNDATION", () => {
    const reduced = /^ {3}REDUCED MOTION$/m.exec(css)!.index;
    const banner = /^ {3}VIEW TRANSITIONS\b/m.exec(css)!.index;
    const mobile = /^ {3}MOBILE FOUNDATION\b/m.exec(css)!.index;
    expect(reduced).toBeLessThan(banner);
    expect(banner).toBeLessThan(mobile);
    const supports: AtRule[] = [];
    tree.walkAtRules("supports", (a) => {
      if (a.params === SUPPORTS) supports.push(a);
    });
    expect(supports.length).toBeGreaterThan(0);
    for (const a of supports) {
      expect(a.parent?.type, "the @supports is top level").toBe("root");
      expect(a.source!.start!.offset).toBeGreaterThan(banner);
      expect(a.source!.start!.offset).toBeLessThan(mobile);
    }
  });

  it("does not contain the words other tests slice globals.css at", () => {
    const banner = /^ {3}VIEW TRANSITIONS\b/m.exec(css)!.index;
    const mobile = /^ {3}MOBILE FOUNDATION\b/m.exec(css)!.index;
    const block = css.slice(banner, mobile);
    for (const words of ["INK GRAPHICS", "COMIC INTROS", "HOVER INTERACTION PATTERNS"]) {
      expect(block).not.toContain(words);
    }
  });

  it("names the five held layers only under html[data-vt], once each", () => {
    const named: string[] = [];
    tree.walkDecls("view-transition-name", (d) => {
      const r = d.parent as Rule;
      expect(inScreenBlock(r), `${r.selector} sits in the screen block`).toBe(true);
      expect(r.selectors).toEqual([`html[data-vt] [data-vt-hold="${d.value}"]`]);
      named.push(d.value);
    });
    expect(named.sort()).toEqual(NAMES);
  });

  it("holds each layer still: no travel, no old picture, the live new one as it is", () => {
    for (const name of NAMES) {
      expect(declsFor(`::view-transition-group(${name})`)).toMatchObject({
        animation: "none",
        "z-index": HELD[name],
      });
      expect(declsFor(`::view-transition-old(${name})`)).toMatchObject({ display: "none" });
      expect(declsFor(`::view-transition-new(${name})`)).toMatchObject({
        animation: "none",
        opacity: "1",
        "mix-blend-mode": "normal",
      });
    }
  });

  it("keeps every transition pseudo-element rule inside the @supports", () => {
    for (const r of rules().filter((x) => x.selector.includes("::view-transition"))) {
      const around = atRulesAround(r);
      expect(
        around.some((a) => a.name === "supports" && a.params === SUPPORTS),
        r.selector
      ).toBe(true);
    }
  });

  it("lets taps through the transition layer, in one rule", () => {
    const layer = rules().filter((r) => r.selectors.includes("::view-transition"));
    expect(layer).toHaveLength(1);
    expect(inScreenBlock(layer[0])).toBe(true);
    const decls: string[] = [];
    layer[0].walkDecls((d) => {
      decls.push(`${d.prop}: ${d.value}`);
    });
    expect(decls).toEqual(["pointer-events: none"]);
    const pointer = css.match(/::view-transition\s*\{[^}]*pointer-events:\s*none/g) ?? [];
    expect(pointer).toHaveLength(1);
  });

  it("sets the --vt-ready marker on html in the screen block, with the rules it stands for", () => {
    const marks: Rule[] = [];
    tree.walkDecls("--vt-ready", (d) => {
      expect(d.value).toBe("1");
      marks.push(d.parent as Rule);
    });
    expect(marks).toHaveLength(1);
    expect(marks[0].selector).toBe("html");
    expect(inScreenBlock(marks[0])).toBe(true);
  });

  it("switches the transition layer's animations off under reduced motion", () => {
    const guards = rules().filter((r) => {
      const media = atRulesAround(r)[0];
      return media?.name === "media" && media.params === "(prefers-reduced-motion: reduce)";
    });
    const guard = guards.find((r) => r.selectors.includes("::view-transition-group(*)"));
    expect(guard, "a reduced-motion rule for the transition pseudo-elements").toBeDefined();
    expect(inScreenBlock(guard!)).toBe(true);
    expect(guard!.selectors).toEqual(
      expect.arrayContaining([
        "::view-transition-group(*)",
        "::view-transition-old(*)",
        "::view-transition-new(*)",
      ])
    );
    const animation: { value: string; important: boolean }[] = [];
    guard!.walkDecls("animation", (d) => {
      animation.push({ value: d.value, important: Boolean(d.important) });
    });
    expect(animation).toEqual([{ value: "none", important: true }]);
  });
});

describe("the held elements", () => {
  const assistant = read("src/components/agent/mascot/mascot-assistant.tsx");

  it("marks Amr's button and his chat panel", () => {
    expect(holds(openingTag(assistant, "ref={buttonRef}"), "amr")).toBe(true);
    expect(openingTag(assistant, "ref={buttonRef}").startsWith("<button")).toBe(true);
    // The attribute itself, on its own line: the same words also appear in selectors.
    const panel = openingTag(assistant, /^\s+data-agent-sheet-root$/m);
    expect(panel.startsWith("<div")).toBe(true);
    expect(panel).toContain('role="dialog"');
    expect(holds(panel, "amr-panel")).toBe(true);
  });

  it("marks the top bar's header element", () => {
    const tag = openingTag(read("src/components/layout/header.tsx"), 'data-chrome="header"');
    expect(tag.startsWith("<header")).toBe(true);
    expect(holds(tag, "header")).toBe(true);
  });

  it("marks the bubble region and the docked timer", () => {
    const bubble = read("src/components/agent/mascot/mascot-bubble.tsx");
    expect(holds(openingTag(bubble, "data-amr-bubble-region"), "amr-bubble")).toBe(true);
    const timer = read("src/components/timer/docked-timer.tsx");
    expect(holds(openingTag(timer, 'data-vt-hold="dock-timer"'), "dock-timer")).toBe(true);
  });

  it("gives each held name to one element in the app, and no other values", () => {
    expect(Object.keys(holdValues).sort()).toEqual(NAMES);
    for (const name of NAMES) expect(holdValues[name], name).toHaveLength(1);
    // No element gets one from a variable either.
    expect(holdFromVariable).toEqual([]);
  });

  it("leaves Amr's phone band to its own variables, and renders him after the page", () => {
    const motionDir = path.join(ROOT, "src/lib/motion");
    for (const name of readdirSync(motionDir)) {
      expect(readFileSync(path.join(motionDir, name), "utf8"), name).not.toContain("--amr-band");
    }
    const shell = read("src/components/layout/app-shell.tsx");
    const main = shell.indexOf("</main>");
    expect(main).toBeGreaterThan(-1);
    expect(shell.indexOf("<MascotAssistant />")).toBeGreaterThan(main);
  });
});
