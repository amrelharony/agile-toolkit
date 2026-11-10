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
