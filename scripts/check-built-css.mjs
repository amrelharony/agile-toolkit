/**
 * Check the production CSS for the newer features the source relies on.
 *
 *   npm run build && node scripts/check-built-css.mjs   # exit 1 if a marker is missing
 *
 * Next minifies CSS (its bundled cssnano-simple), and a minifier may merge a
 * repeated property, reorder rules or drop what it does not know. A source scan
 * cannot see that, so this reads every .next/static/css file, takes all
 * whitespace out, and looks for each marker below. Each PR lists its own
 * markers under its id. A dev check, like check-ui-classes.mjs; not in CI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Every top-level or nested block opened by `head` (e.g. "@supports"), with its body. */
function blocks(css, head) {
  const found = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) break;
    }
    found.push({ at, params: css.slice(at + head.length, open), body: css.slice(open + 1, i) });
  }
  return found;
}

/** Innermost rules as { selectors, body }. */
function rules(css) {
  return Array.from(css.matchAll(/([^{};]*)\{([^{}]*)\}/g), (m) => ({
    selectors: m[1].split(","),
    body: m[2],
  }));
}

/** A custom property's fallback is declared, then an @supports block replaces it with linear(). */
function linearAfterFallback(name) {
  return (css) => {
    const fallback = css.indexOf(`${name}:cubic-bezier(`);
    if (fallback === -1) return false;
    return blocks(css, "@supports").some(
      (b) => b.at > fallback && b.params.includes("linear(") && b.body.includes(`${name}:linear(`)
    );
  };
}

const GRAIN = /background-image:url\(["']?data:image\/svg\+xml/g;

/** Whitespace is gone, so `html.light body` reads `html.lightbody`. */
function grainOn(selector) {
  return (css) =>
    rules(css).some(
      (r) =>
        r.selectors.includes(selector) &&
        (r.body.match(GRAIN) ?? []).length === 1 &&
        (r.body.match(/url\(["']?data:image\/svg\+xml/g) ?? []).length === 2
    );
}

function grainRemoved(css) {
  return blocks(css, "@media").some(
    (b) =>
      b.params.includes("print") &&
      b.params.includes("(forced-colors:active)") &&
      b.params.includes("(prefers-contrast:more)") &&
      rules(b.body).some(
        (r) =>
          r.selectors.includes("html.lightbody") &&
          r.selectors.includes("html.darkbody") &&
          r.body.includes("background-image:none")
      )
  );
}

/** The layers held still during a view transition, by name, with their group's z-index. */
const HELD_LAYERS = {
  header: "2",
  amr: "3",
  "amr-bubble": "3",
  "amr-panel": "3",
  "dock-timer": "3",
};

/** The @media screen blocks inside @supports (view-transition-name: none). */
function vtScreenBlocks(css) {
  return blocks(css, "@supports")
    .filter((b) => b.params.includes("(view-transition-name:none)"))
    .flatMap((b) => blocks(b.body, "@media").filter((m) => m.params === "screen"));
}

/** Every declaration that rules naming `selector` give it, quotes taken out of attribute values. */
function declsFor(css, selector) {
  return rules(css)
    .filter((r) => r.selectors.some((s) => s.replace(/["']/g, "") === selector))
    .flatMap((r) => r.body.split(";"));
}

/** Some VIEW TRANSITIONS screen block gives each selector all its declarations. */
function inVtScreen(wanted) {
  return (css) =>
    vtScreenBlocks(css).some((b) =>
      Object.entries(wanted).every(([selector, decls]) => {
        const found = declsFor(b.body, selector);
        return decls.every((d) => found.includes(d));
      })
    );
}

function heldLayersWanted() {
  const wanted = {};
  for (const [name, z] of Object.entries(HELD_LAYERS)) {
    wanted[`html[data-vt][data-vt-hold=${name}]`] = [`view-transition-name:${name}`];
    wanted[`::view-transition-group(${name})`] = ["animation:none", `z-index:${z}`];
    wanted[`::view-transition-old(${name})`] = ["display:none"];
    wanted[`::view-transition-new(${name})`] = [
      "animation:none",
      "opacity:1",
      "mix-blend-mode:normal",
    ];
  }
  return wanted;
}

/** The pseudo-elements' own reduced-motion rule, nested in the VIEW TRANSITIONS screen block. */
function vtReducedMotion(css) {
  return vtScreenBlocks(css).some((b) =>
    blocks(b.body, "@media")
      .filter((m) => m.params.includes("(prefers-reduced-motion:reduce)"))
      .some((m) =>
        ["group", "old", "new"].every((p) =>
          declsFor(m.body, `::view-transition-${p}(*)`).includes("animation:none!important")
        )
      )
  );
}

/** Markers by PR id. Each `test` gets one file's CSS with all whitespace removed. */
export const MARKERS = {
  F1: [
    {
      name: "--ease-settle: cubic-bezier fallback, then linear() inside @supports",
      test: linearAfterFallback("--ease-settle"),
    },
    {
      name: "--ease-pop: cubic-bezier fallback, then linear() inside @supports",
      test: linearAfterFallback("--ease-pop"),
    },
    {
      name: "paper grain: two url(data:image/svg+xml) layers on html.light body",
      test: grainOn("html.lightbody"),
    },
    {
      name: "paper grain: two url(data:image/svg+xml) layers on html.dark body",
      test: grainOn("html.darkbody"),
    },
    {
      name: "paper grain: removed for print, forced colours and more contrast",
      test: grainRemoved,
    },
  ],
  F2: [
    {
      name: "held layers: view-transition-name under html[data-vt] and the held ::view-transition-group( pictures, in @supports(view-transition-name:none) and @media screen",
      test: inVtScreen(heldLayersWanted()),
    },
    {
      name: "--vt-ready:1 on html, in @supports(view-transition-name:none) and @media screen",
      test: inVtScreen({ html: ["--vt-ready:1"] }),
    },
    {
      name: "::view-transition lets taps through (pointer-events:none), in the same block",
      test: inVtScreen({ "::view-transition": ["pointer-events:none"] }),
    },
    {
      name: "reduced motion: animation:none!important on the transition pseudo-elements, in the same block",
      test: vtReducedMotion,
    },
  ],
};

export function stripWhitespace(css) {
  return css.replace(/\s+/g, "");
}

/**
 * @param {string[]} sheets CSS files, whitespace already removed
 * @returns {{ id: string, name: string, ok: boolean }[]} one entry per marker;
 *   a marker passes when any one file has it
 */
export function checkMarkers(sheets, markers = MARKERS) {
  return Object.entries(markers).flatMap(([id, list]) =>
    list.map(({ name, test }) => ({ id, name, ok: sheets.some((css) => test(css)) }))
  );
}

function cssFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return entry.endsWith(".css") ? [full] : [];
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = path.resolve(process.cwd(), process.argv[2] ?? ".next/static/css");
  const files = existsSync(dir) ? cssFiles(dir) : [];
  if (files.length === 0) {
    console.error(`No built CSS in ${dir}. Run npm run build first.`);
    process.exit(1);
  }
  const results = checkMarkers(files.map((f) => stripWhitespace(readFileSync(f, "utf8"))));
  for (const r of results) console.log(`${r.ok ? "ok     " : "MISSING"}  ${r.id}  ${r.name}`);
  const missing = results.filter((r) => !r.ok);
  if (missing.length > 0) {
    console.error(
      `\n${missing.length} marker(s) missing from ${files.length} built CSS file(s) in ${dir}.`
    );
    process.exit(1);
  }
  console.log(`\nAll ${results.length} markers found in ${files.length} built CSS file(s).`);
}
