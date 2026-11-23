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

/**
 * One selector or declaration the way the minifier may write it: no quotes in
 * attribute values, one colon before before/after, no leading zero on a number.
 */
function minified(text) {
  return text
    .replace(/["']/g, "")
    .replace(/::(before|after)/g, ":$1")
    .replace(/(^|[^\d.])0+\.(\d)/g, "$1.$2");
}

/** Every declaration the rules naming `selector` give it, both sides read as minified. */
function declsLike(css, selector) {
  const wanted = minified(selector);
  return rules(css)
    .filter((r) => r.selectors.some((s) => minified(s) === wanted))
    .flatMap((r) => r.body.split(";").map(minified));
}

/**
 * `selector`'s ink and paper triangles: `ink` and `paper` hold the declarations
 * each must have, read as minified too (so `content:""` matches the build's).
 */
function tail(selector, ink, paper) {
  return (css) => {
    const before = declsLike(css, `${selector}::before`);
    const after = declsLike(css, `${selector}::after`);
    return (
      ink.every((d) => before.includes(minified(d))) &&
      paper.every((d) => after.includes(minified(d)))
    );
  };
}

/** The right tail, in ink then in the balloon's own paper. */
const RIGHT_TAIL = {
  ink: ["left:auto", "right:-.8rem", "border-color:transparenttransparenttransparentvar(--border)"],
  paper: [
    "left:auto",
    "right:-.6rem",
    "border-color:transparenttransparenttransparentvar(--balloon-fill)",
  ],
};

/** The chat panel's down tail, in the panel's own ink (--border) and paper (--card). */
const PANEL_DOWN_TAIL = {
  ink: [
    'content:""',
    "bottom:-.8rem",
    "left:var(--tail-at)",
    "border-width:.8rem.4rem0",
    "border-color:var(--border)transparenttransparent",
  ],
  paper: [
    'content:""',
    "bottom:-.6rem",
    "left:calc(var(--tail-at)+.1rem)",
    "border-width:.65rem.3rem0",
    "border-color:var(--card)transparenttransparent",
  ],
};

/** The name plate tilts and casts --shadow-1, and high contrast lays it flat. */
function namePlate(css) {
  const plate = declsLike(css, ".comic-name-plate");
  const flat = [".hc.comic-name-plate", "[data-theme=hc].comic-name-plate"].every((selector) => {
    const decls = declsLike(css, selector);
    return decls.includes("rotate:none") && decls.includes("box-shadow:none");
  });
  return plate.includes("box-shadow:var(--shadow-1)") && plate.includes("rotate:-1deg") && flat;
}

/**
 * The chat panel's entrance (mascot-assistant.module.css, hashed to
 * `…_panelEnter__…` in the build): under prefers-reduced-motion:no-preference, an
 * opacity and scale transition and an @starting-style block that starts it at
 * opacity:0 and scale:.96.
 */
function panelEntrance(css) {
  const named = (r) => r.selectors.some((s) => /panelEnter/.test(s));
  const decls = (r) => r.body.split(";").map(minified);
  return blocks(css, "@media")
    .filter((m) => m.params.includes("(prefers-reduced-motion:no-preference)"))
    .some(
      (m) =>
        rules(m.body).some((r) => {
          if (!named(r)) return false;
          const transition = decls(r).find((d) => d.startsWith("transition:")) ?? "";
          return ["opacity", "scale", "var(--dur-surface-in)", "var(--ease-calm)"].every((part) =>
            transition.includes(part)
          );
        }) &&
        blocks(m.body, "@starting-style").some((s) =>
          rules(s.body).some(
            (r) => named(r) && ["opacity:0", "scale:.96"].every((d) => decls(r).includes(d))
          )
        )
    );
}

/** Rules with where they start, so a fallback can be held before its @supports. */
function rulesAt(css) {
  return Array.from(css.matchAll(/([^{};]*)\{([^{}]*)\}/g), (m) => ({
    at: m.index,
    selectors: m[1].split(",").map(minified),
    body: m[2].split(";"),
  }));
}

/** The you caption: its outline and plain fallback paper, then the wash inside @supports. */
function youCaption(css) {
  const you = minified(".comic-caption[data-voice=you]");
  const guarded = blocks(css, "@supports")
    .filter((b) => b.params.includes("color-mix("))
    .map((b) => ({
      from: b.at,
      to: b.at + "@supports".length + b.params.length + 1 + b.body.length,
    }));
  const inside = (at) => guarded.some((b) => at > b.from && at < b.to);
  const mine = rulesAt(css).filter((r) => r.selectors.includes(you));
  const fallback = mine.find(
    (r) =>
      !inside(r.at) &&
      r.body.includes("background-color:var(--surface)") &&
      r.body.some(
        (d) =>
          d.startsWith("border:") &&
          ["var(--line-w)", "solid", "var(--border)"].every((part) => d.includes(part))
      )
  );
  return (
    fallback !== undefined &&
    mine.some(
      (r) =>
        r.at > fallback.at &&
        inside(r.at) &&
        r.body.includes("background-color:color-mix(insrgb,var(--accent2)14%,var(--card))")
    )
  );
}

/** The @media (forced-colors:active) blocks. */
function forcedColorBlocks(css) {
  return blocks(css, "@media").filter((b) => b.params.includes("(forced-colors:active)"));
}

/** Forced colours hide the balloon's tails. */
function tailsHiddenInForcedColors(css) {
  return forcedColorBlocks(css).some((b) =>
    ["before", "after"].every((p) => declsLike(b.body, `.balloon::${p}`).includes("display:none"))
  );
}

/** Forced colours give the you caption a start edge heavier than narration's --line-w. */
function youEdgeInForcedColors(css) {
  return forcedColorBlocks(css).some((b) =>
    declsLike(b.body, ".comic-caption[data-voice=you]").some((d) => {
      const [prop, value] = d.split(/:(.*)/);
      return (
        prop === "border-inline-start-width" && !!value && !/^(var\(--line-w\)|0)$/.test(value)
      );
    })
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
  AMR: [
    {
      name: ".balloon[data-tail=right]: the tail on the right edge, ink in --border and paper in --balloon-fill",
      test: tail(".balloon[data-tail=right]", RIGHT_TAIL.ink, RIGHT_TAIL.paper),
    },
    {
      name: ".comic-caption[data-voice=you]: a --line-w --border outline on --surface, then the --accent2 color-mix wash inside @supports",
      test: youCaption,
    },
    {
      name: "the amr alias: [data-amr-side=right] .balloon[data-tail=amr] takes the right tail, [data-amr-edge=top] counts it from the top",
      test: (css) =>
        tail(
          "[data-amr-side=right].balloon[data-tail=amr]",
          RIGHT_TAIL.ink,
          RIGHT_TAIL.paper
        )(css) &&
        tail(
          "[data-amr-edge=top].balloon[data-tail=amr]",
          ["top:var(--tail-at)", "bottom:auto"],
          ["top:calc(var(--tail-at)+.1rem)", "bottom:auto"]
        )(css),
    },
    {
      name: "forced colours: display:none on .balloon::before and ::after, in @media (forced-colors:active)",
      test: tailsHiddenInForcedColors,
    },
    {
      name: "forced colours: .comic-caption[data-voice=you] keeps a border-inline-start-width heavier than --line-w, in @media (forced-colors:active)",
      test: youEdgeInForcedColors,
    },
    {
      name: ".comic-tailed[data-tail=down]: the panel's tail on its bottom edge at --tail-at, ink in --border and paper in --card",
      test: tail(".comic-tailed[data-tail=down]", PANEL_DOWN_TAIL.ink, PANEL_DOWN_TAIL.paper),
    },
    {
      name: ".comic-name-plate: box-shadow:var(--shadow-1) and rotate:-1deg, laid flat (rotate:none, box-shadow:none) under .hc and [data-theme=hc]",
      test: namePlate,
    },
    {
      name: "@starting-style: the chat panel's entrance (panelEnter) starts at opacity:0 and scale:.96 and transitions both, in @media (prefers-reduced-motion:no-preference)",
      test: panelEntrance,
    },
  ],
};

export function stripWhitespace(css) {
  return css.replace(/\s+/g, "");
}

/**
 * @param {string[]} sheets CSS files, whitespace already removed
 * @param {Record<string, { name: string, test: (css: string) => boolean }[]>} [markers]
 *   MARKERS, or some of its groups
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
