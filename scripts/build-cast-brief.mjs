/**
 * Writes the ChatGPT brief for the cast puppets, one file per character.
 *
 *     node --no-warnings scripts/build-cast-brief.mjs [--sources <dir>] [--out <dir>]
 *                                                     [--page <dir>] [--batches <dir>] [--check]
 *
 * Reads the public half of the spec (docs/cast/cast-rig.json: families, images,
 * batches, keys, tolerances) and the private half in the sources folder
 * (<sources>/cast-private.json and the character blocks it names). The private half
 * is the bible's canon and never enters git; see docs/cast/CAST-BUILD.md.
 *
 * Writes into <out> (default: <sources>/../brief):
 *   CAST-AAW-NN.md   the one file ChatGPT gets for that character
 *   CAST-CHATGPT.md  all thirty, kept as the record
 *   CAST-PARTS.md    the Opus appendix: what each return must hold
 *   kickoff/AAW-NN.txt
 * With --page, the prompt page (index.html; thumbnails come from make-batches.py).
 * With --batches, one folder per batch and character, ready for make-batches.py.
 * With --check, writes nothing and exits 1 when a file in <out> is stale.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AMR_CHECK,
  IMAGE_WORDS,
  fileName,
  fixLines,
  howToAnswer,
  imageArms,
  imageArmsAmr,
  imageFace,
  imageFace2,
  imageMaster,
  imageParts,
  imageParts2,
  kickoff,
  masterBlock,
  masterCheck,
} from "./cast/brief-blocks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SOURCES = "D:/Claude Desktop/Agile_At_Work_Cast_Sources/sources";

/** Reference files that may never be attached, whatever the private half says. */
export const NEVER = [
  /Photographic_References/i,
  /Characters_Sheet_Ninja/i,
  /Web_Book_Panels/i,
  /comicagile-set-01/i,
  /public[\\/]mascot/i,
  /docs[\\/]mascot[\\/]reference/i,
  /R19/,
];

const ROLE_WORDS = {
  sheet: "the model sheet (the character from every side)",
  "story-1": "a weekly story panel (how the character looks today)",
  "story-2": "a weekly story panel (how the character looks today)",
  style: "a weekly story crop for the drawing style only, with no character in it",
};

export function loadSpec(file = path.join(ROOT, "docs", "cast", "cast-rig.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function loadPrivate(sources) {
  const file = path.join(sources, "cast-private.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const [id, c] of Object.entries(data.characters)) {
    c.blockText = readFileSync(path.join(sources, c.block), "utf8").replace(/\r\n/g, "\n").trim();
    for (const r of c.refs) {
      const p = r.file.replace(/\\/g, "/");
      if (NEVER.some((re) => re.test(p)) || NEVER.some((re) => re.test(r.src ?? "")))
        throw new Error(`${id}: reference ${r.file} is on the never-list`);
    }
  }
  return data;
}

const batchOf = (spec, id) => Object.keys(spec.batches).find((b) => spec.batches[b].includes(id));

function keyOf(spec, c) {
  const name = c.key ?? "magenta";
  return { name, hex: spec.keys[name] };
}

function imageBlock(spec, c, image) {
  const tol = spec.tolerances;
  const fam = spec.families[c.family];
  switch (image) {
    case "master":
      return imageMaster(c.id, tol);
    case "parts":
      return imageParts(c.id, tol);
    case "parts2":
      return imageParts2(c.id, tol);
    case "face":
      return imageFace(c.id, tol);
    case "face2":
      return imageFace2(c.id, tol);
    case "arms":
      return c.id === "AAW-01" ? imageArmsAmr(c.id, tol) : imageArms(c.id, tol, c.arms ?? fam.arms);
    default:
      throw new Error(`${c.id}: unknown image ${image}`);
  }
}

/** The character's own block with its background key filled in. */
function characterBlock(spec, c, priv) {
  const key = keyOf(spec, c);
  const text = priv.blockText.replace(/\{KEY_NAME\}/g, key.name).replace(/\{KEY_HEX\}/g, key.hex);
  if (/\{KEY_(NAME|HEX)\}/.test(text)) throw new Error(`${c.id}: key placeholder left in block`);
  return text;
}

const ROLE_ORDER = ["sheet", "story-1", "story-2", "style"];
const roleRank = (r) => ROLE_ORDER.indexOf(r.role) + 1 || 99;

function checkFor(c) {
  const base = masterCheck({ card: c.card !== false, arms: c.images.includes("arms") });
  return c.id === "AAW-01" ? [...base, ...AMR_CHECK] : base;
}

function fixesFor(c, key) {
  return fixLines(c.id, c.name, key.name, key.hex, { card: c.card !== false, images: c.images });
}

function refsFor(c, priv) {
  return [...priv.refs]
    .sort((a, b) => roleRank(a) - roleRank(b))
    .map((r) => ({
      file: path.basename(r.file),
      path: r.file,
      role: r.role,
      as: ROLE_WORDS[r.role] ?? r.role,
    }));
}

/** Everything one ChatGPT chat needs, for one character. */
export function characterFile(spec, c, priv) {
  const key = keyOf(spec, c);
  const fixes = fixesFor(c, key);
  const check = checkFor(c);
  const out = [
    `# CAST-${c.id}: ${c.name}`,
    "",
    `Brief v${spec.brief_version}. One chat draws only this character. Attach this file and its reference pictures (${refsFor(
      c,
      priv
    )
      .map((r) => r.file)
      .join(", ")}).`,
    "",
    "## For ChatGPT: how to answer",
    "",
    fence(howToAnswer(c.id, c.images, spec.tolerances)),
    "",
    "## Master block",
    "",
    fence(masterBlock(spec.tolerances)),
    "",
    "## Image blocks",
    "",
    ...c.images.flatMap((img) => [fence(imageBlock(spec, c, img)), ""]),
    "## Character block",
    "",
    fence(characterBlock(spec, c, priv)),
    "",
    "## For the person: master check",
    "",
    ...check.map((l, i) => `${i + 1}. ${l}`),
    "",
    "## For the person: fix lines to paste",
    "",
    ...Object.values(fixes).flatMap((f) => [fence(f), ""]),
  ];
  return (
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

const fence = (t) => "```text\n" + t.trim() + "\n```";

export function kickoffText(spec, c, priv) {
  return (
    kickoff({
      id: c.id,
      name: c.name,
      batch: batchOf(spec, c.id),
      version: spec.brief_version,
      refs: refsFor(c, priv),
      images: c.images,
      amr: c.id === "AAW-01",
    }) + "\n"
  );
}

/** One prompt per image, for a chat that was lost: master + image block + character. */
export function imagePrompt(spec, c, priv, image) {
  return [
    howToAnswer(c.id, c.images, spec.tolerances),
    masterBlock(spec.tolerances),
    imageBlock(spec, c, image),
    characterBlock(spec, c, priv),
    image === "master"
      ? "Make image 1, the master, now."
      : `Make ${IMAGE_WORDS[image]}, now, from the attached approved master ${fileName(c.id, "master")}.`,
  ].join("\n\n");
}

export function chatgptRecord(spec, priv) {
  const out = [
    "# Agile at Work: cast puppet brief (all thirty, the record)",
    "",
    `Brief v${spec.brief_version}. Each chat gets only its own CAST-AAW-NN.md; this file keeps every character block in one place.`,
    "",
    "## Master block",
    "",
    fence(masterBlock(spec.tolerances)),
    "",
  ];
  for (const c of spec.characters) {
    out.push(
      `## ${c.id} ${c.name} (batch ${batchOf(spec, c.id)})`,
      "",
      fence(characterBlock(spec, c, priv.characters[c.id])),
      ""
    );
  }
  return out.join("\n").trimEnd() + "\n";
}

/** The Opus appendix: what each return must hold and how to take it in. */
export function partsAppendix(spec, priv) {
  const out = [
    "# Cast puppets: what each return must hold (Opus appendix)",
    "",
    `Brief v${spec.brief_version}. Private: it names the character canon. Build rules: docs/cast/CAST-BUILD.md in the repo.`,
    "",
  ];
  for (const c of spec.characters) {
    const p = priv.characters[c.id];
    const fam = spec.families[c.family];
    const key = keyOf(spec, c);
    out.push(`## ${c.id} ${c.name}`, "");
    out.push(
      `- Batch ${batchOf(spec, c.id)}; family ${c.family}; arms ${fam.arms ?? "none"}; eyes ${fam.eyes}.`
    );
    out.push(`- Images: ${c.images.map((i) => fileName(c.id, i)).join(", ")}.`);
    out.push(`- Background key: ${key.name} ${key.hex}.`);
    if (c.parts) out.push(`- Expected parts (${c.parts.length}): ${c.parts.join(", ")}.`);
    if (c.parts2) out.push(`- Expected more parts (${c.parts2.length}): ${c.parts2.join(", ")}.`);
    out.push(
      `- Face cells: 1 open, 2 blink, 3 happy, 4 wide, 5 rest mouth, 6 smile, 7 ah, 8 o${c.images.includes("face2") ? "; face2: curious, talk" : ""}.`
    );
    if (c.images.includes("arms"))
      out.push(
        c.id === "AAW-01"
          ? "- Arm cells: right wave, right up, right open, left up."
          : "- Arm cells: top row own right (wave, up, open, point); bottom row own left (up, open, chin, signature)."
      );
    if (p.height_vs_amr) out.push(`- Height vs Amr: ${p.height_vs_amr}.`);
    if (p.plate) out.push(`- Plate text drawn at pack time: ${p.plate}.`);
    out.push(
      `- References: ${p.refs.map((r) => `${path.basename(r.file)} (${r.role}, from ${r.src ?? "?"})`).join("; ")}.`
    );
    if (p.conflicts?.length)
      out.push(
        `- Conflicts (model sheet wins unless the owner says otherwise): ${p.conflicts.join(" | ")}`
      );
    out.push("");
  }
  out.push(
    "## Taking a return in",
    "",
    "1. `python -I scripts/build-cast-rigs.py intake <zip or folder>`: archives it untouched, sorts loose PNGs by content when names are missing, prints found / missing / extra.",
    "2. `candidate <AAW-NN>`: builds into review/ only and runs the checks.",
    "3. Fix decision: 1–2 things wrong → an edit line; 3 or more, style drift, text, fused pieces or a bad background → regenerate from the master; identity wrong → a new master. At most 3 rounds per image.",
    ""
  );
  return out.join("\n");
}

// ── The prompt page ───────────────────────────────────────────────────────

export function pageData(spec, priv) {
  return {
    version: spec.brief_version,
    batches: Object.keys(spec.batches),
    characters: spec.characters.map((c) => {
      const p = priv.characters[c.id];
      const key = keyOf(spec, c);
      return {
        id: c.id,
        name: c.name,
        batch: batchOf(spec, c.id),
        family: c.family,
        refs: refsFor(c, p).map((r) => ({ file: r.file, role: r.role, thumb: `thumbs/${r.file}` })),
        kickoff: kickoffText(spec, c, p),
        images: c.images.map((img) => ({
          image: img,
          file: fileName(c.id, img),
          words: IMAGE_WORDS[img],
        })),
        check: checkFor(c),
        fixes: Object.entries(fixesFor(c, key)).map(([k, v]) => ({
          kind: k,
          text: v,
        })),
      };
    }),
  };
}

export function pageHtml(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<title>Cast Art Prompts</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@500;700&display=swap">
<style>
:root{--bg:#f7f3ea;--card:#fffdf8;--ink:#2b2420;--soft:#6c625a;--line:#ded5c6;--accent:#b4532a;--accent-ink:#fff;--chip:#efe7d8;--done:#3f7a4d}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1d1a17;--card:#26221e;--ink:#f1ebe2;--soft:#b5aa9c;--line:#3d3630;--accent:#e08a5c;--accent-ink:#1d1a17;--chip:#332d27;--done:#7fbf8c;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#1d1a17;--card:#26221e;--ink:#f1ebe2;--soft:#b5aa9c;--line:#3d3630;--accent:#e08a5c;--accent-ink:#1d1a17;--chip:#332d27;--done:#7fbf8c;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:24px 64px}
main{max-width:1080px;margin:0 auto;display:grid;gap:20px}
h1,h2{font-family:"Shantell Sans",system-ui,sans-serif;text-wrap:balance;margin:0}
h1{font-size:30px}h2{font-size:21px}
.lead{color:var(--soft);max-width:68ch;margin:6px 0 0}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.bar button,.btn{font:inherit;font-size:14px;border:1.5px solid var(--ink);background:var(--card);color:var(--ink);border-radius:999px;padding:5px 13px;cursor:pointer}
.bar button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.progress{flex:1 1 200px;min-width:0;height:10px;border-radius:999px;background:var(--chip);overflow:hidden}
.progress i{display:block;height:100%;background:var(--done);width:0}
.card{background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:16px;display:grid;gap:12px;min-width:0}
.head{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:baseline}
.slate{font:700 13px/1 ui-monospace,Consolas,monospace;letter-spacing:.06em;background:var(--chip);padding:5px 8px;border-radius:6px}
.meta{color:var(--soft);font-size:13px}
.refs{display:flex;gap:10px;flex-wrap:wrap}
.refs figure{margin:0;width:150px;max-width:100%}
.refs img{width:100%;height:110px;object-fit:contain;background:var(--chip);border-radius:8px;display:block}
.refs figcaption{font-size:12px;color:var(--soft);margin-top:3px}
.rows{display:grid;gap:6px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-top:1px dashed var(--line);padding-top:6px}
.row .what{flex:1 1 180px;min-width:0}
.file{font:12px ui-monospace,Consolas,monospace;background:var(--chip);padding:3px 7px;border-radius:6px;border:0;color:var(--ink);cursor:pointer}
.row label{display:flex;gap:6px;align-items:center;font-size:13px}
details{border-top:1px dashed var(--line);padding-top:6px}
summary{cursor:pointer;font-weight:600}
ol.check{margin:6px 0 0;padding-left:22px}
.fix{display:flex;gap:8px;align-items:flex-start;margin-top:6px}
.fix p{margin:0;flex:1;min-width:0;font-size:13px;color:var(--soft)}
.card.done{opacity:.6}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:999px;font-size:14px}
</style>
<main>
  <header>
    <h1>Cast Art Prompts</h1>
    <p class="lead">One chat per character in ChatGPT Images. Attach that character's <b>CAST-AAW-NN.md</b> and its pictures from the batch zip, paste the kickoff, check the master against the five lines, then say “next”. Lost a chat? Start a new one with the same file, the pictures and the approved master, and paste the kickoff again. Batch A is the pilot: send its six masters back before the rest.</p>
  </header>
  <div class="bar" id="filters" role="group" aria-label="Show"></div>
  <div class="bar"><span id="count"></span><div class="progress" aria-hidden="true"><i id="fill"></i></div></div>
  <section id="list" style="display:grid;gap:14px"></section>
</main>
<div class="toast" id="toast" role="status" hidden></div>
<script>
var DATA = ${json};
(function () {
  var KEY = "cast-art-prompts-v" + DATA.version;
  var done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { done = {}; }
  var filter = "all", hideDone = false;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {} }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (k === "on") n.addEventListener("click", attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  var timer;
  function toast(msg) { var t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(timer); timer = setTimeout(function () { t.hidden = true; }, 1800); }
  function copy(text, label) {
    function fallback() {
      var ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(label); } catch (e) { toast("Select and copy by hand"); }
      ta.remove();
    }
    try { navigator.clipboard.writeText(text).then(function () { toast(label); }, fallback); } catch (e) { fallback(); }
  }
  function charDone(c) { return c.images.every(function (i) { return done[i.file]; }); }
  function card(c) {
    var refs = el("div", { class: "refs" }, c.refs.map(function (r) {
      return el("figure", {}, [el("img", { src: r.thumb, alt: r.role + " reference for " + c.name, loading: "lazy" }), el("figcaption", { text: r.file })]);
    }));
    var rows = el("div", { class: "rows" }, c.images.map(function (i) {
      var box = el("input", { type: "checkbox" }); box.checked = !!done[i.file];
      box.addEventListener("change", function () { done[i.file] = box.checked; save(); render(); });
      return el("div", { class: "row" }, [
        el("span", { class: "what", text: i.words.charAt(0).toUpperCase() + i.words.slice(1) }),
        el("button", { class: "file", type: "button", text: i.file, title: "Copy the file name", on: function () { copy(i.file, "File name copied"); } }),
        el("label", {}, [box, el("span", { text: "Done" })])
      ]);
    }));
    var check = el("details", {}, [el("summary", { text: "Master check (" + c.check.length + " lines)" }), el("ol", { class: "check" }, c.check.map(function (l) { return el("li", { text: l }); }))]);
    var fixes = el("details", {}, [el("summary", { text: "Fix lines" })].concat(c.fixes.map(function (f) {
      return el("div", { class: "fix" }, [el("button", { class: "btn", type: "button", text: "Copy fix", on: function () { copy(f.text, "Fix copied"); } }), el("p", { text: f.text })]);
    })));
    var n = el("article", { class: "card" + (charDone(c) ? " done" : "") }, [
      el("div", { class: "head" }, [el("span", { class: "slate", text: c.id }), el("h2", { text: c.name }), el("span", { class: "meta", text: "Batch " + c.batch + " · " + c.family + " · " + c.images.length + " images" })]),
      refs,
      el("div", { class: "bar" }, [el("button", { class: "btn primary", type: "button", text: "Copy kickoff", on: function () { copy(c.kickoff, "Kickoff for " + c.id + " copied"); } })]),
      rows, check, fixes
    ]);
    return n;
  }
  function render() {
    var list = document.getElementById("list"); list.textContent = "";
    var total = 0, got = 0;
    DATA.characters.forEach(function (c) { c.images.forEach(function (i) { total++; if (done[i.file]) got++; }); });
    document.getElementById("count").textContent = got + " of " + total + " images done";
    document.getElementById("fill").style.width = (total ? (100 * got / total) : 0) + "%";
    DATA.characters.filter(function (c) { return (filter === "all" || c.batch === filter) && !(hideDone && charDone(c)); })
      .forEach(function (c) { list.appendChild(card(c)); });
  }
  var bar = document.getElementById("filters");
  ["all"].concat(DATA.batches).forEach(function (b) {
    var btn = el("button", { type: "button", text: b === "all" ? "All" : "Batch " + b, "aria-pressed": String(b === filter) });
    btn.addEventListener("click", function () { filter = b; Array.prototype.forEach.call(bar.querySelectorAll("button[data-f]"), function (x) { x.setAttribute("aria-pressed", String(x.dataset.f === b)); }); render(); });
    btn.dataset.f = b; bar.appendChild(btn);
  });
  var hide = el("button", { type: "button", text: "Hide done", "aria-pressed": "false" });
  hide.addEventListener("click", function () { hideDone = !hideDone; hide.setAttribute("aria-pressed", String(hideDone)); render(); });
  bar.appendChild(hide);
  render();
})();
</script>
`;
}

// ── Batch folders ─────────────────────────────────────────────────────────

export const BATCH_README = `AGILE AT WORK: CAST PUPPET ART, BATCH ZIPS

Each zip holds six folders, one per character. For each character:
1. Start a NEW ChatGPT chat (Images 2.5 or 2.6).
2. Attach that folder's CAST-AAW-NN.md and its reference pictures directly (not the zip).
3. Paste KICKOFF.txt (or use "Copy kickoff" on the Cast Art Prompts page).
4. Check the master with the five lines on the page, then say "next" or paste a fix line.
5. At the end ChatGPT gives you AAW-NN.zip. If it can't make a zip, download each image under its file name into a folder named AAW-NN.
6. Put a batch's results into one zip, AAW_Cast_Batch_X_Return.zip, and send it to Claude.

Batch A is the pilot: send its six masters first and wait for the go-ahead before drawing the rest of batch A.
Never attach photographs, and never let ChatGPT use saved pictures or memories of real people.
`;

function writeIfChanged(file, text, check, stale) {
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) stale.push(file);
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * @param {{ sources?: string, out?: string, page?: string, batches?: string, check?: boolean }} [opts]
 */
export function build({ sources = DEFAULT_SOURCES, out, page, batches, check = false } = {}) {
  const spec = loadSpec();
  const priv = loadPrivate(sources);
  out ??= path.join(sources, "..", "brief");
  const stale = [];
  const missing = spec.characters.filter((c) => !priv.characters[c.id]).map((c) => c.id);
  if (missing.length) throw new Error(`No private entry for ${missing.join(", ")}`);
  for (const c of spec.characters) {
    const p = priv.characters[c.id];
    writeIfChanged(path.join(out, `CAST-${c.id}.md`), characterFile(spec, c, p), check, stale);
    writeIfChanged(path.join(out, "kickoff", `${c.id}.txt`), kickoffText(spec, c, p), check, stale);
  }
  writeIfChanged(path.join(out, "CAST-CHATGPT.md"), chatgptRecord(spec, priv), check, stale);
  writeIfChanged(path.join(out, "CAST-PARTS.md"), partsAppendix(spec, priv), check, stale);
  if (page)
    writeIfChanged(path.join(page, "index.html"), pageHtml(pageData(spec, priv)), check, stale);
  if (batches && !check) {
    const plan = { readme: BATCH_README, batches: {} };
    for (const [b, ids] of Object.entries(spec.batches)) {
      plan.batches[b] = ids.map((id) => {
        const c = spec.characters.find((x) => x.id === id);
        const folder = `${id}_${c.name.replace(/[^A-Za-z0-9]+/g, "_")}`;
        return {
          id,
          folder,
          md: path.join(out, `CAST-${id}.md`),
          kickoff: path.join(out, "kickoff", `${id}.txt`),
          refs: priv.characters[id].refs.map((r) => path.join(sources, r.file)),
        };
      });
    }
    mkdirSync(batches, { recursive: true });
    writeFileSync(path.join(batches, "batch-plan.json"), JSON.stringify(plan, null, 1));
  }
  return { spec, stale };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const { stale } = build({
    sources: arg("--sources") ?? DEFAULT_SOURCES,
    out: arg("--out"),
    page: arg("--page"),
    batches: arg("--batches"),
    check,
  });
  if (check && stale.length) {
    console.error(`Stale:\n${stale.join("\n")}`);
    process.exit(1);
  }
  console.log(check ? "Brief is up to date." : "Brief written.");
}
