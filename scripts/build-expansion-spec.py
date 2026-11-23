"""
Write the expansion scenes' spec and their code table from the release's catalog.

    python -I scripts/build-expansion-spec.py <folder with catalog.json> [--check]

The folder is where scripts/intake-refined-sprites.py put the expansion release
(Amr_Refined_Expansion_124.zip: X001-X124, eight key poses each, with catalog.json).

Writes three files:
  docs/mascot/expansion-sheets.json
      the whole catalog as the builds and tests read it: per sheet its id, pack,
      family, title, purpose, trigger rule, loop rule, props, file, sha256 and the
      eight slots (frame id and beat). Unlike S and N sheets, slot 1 is a real beat
      here, so all eight frames ship.
  src/components/agent/mascot/engine/expansion-table.ts
      the small table every scene needs (id, pack, family, and `last` where a scene
      ends early), so the beats and titles never reach the browser with the engine.
  src/components/agent/mascot/engine/expansion-titles.ts
      each scene's title, for the Scenes tab alone.

A sheet whose final beats are drawn wrong (HOLD_EARLIER) ends, and holds, on an
earlier beat until it is redrawn: `last` in the spec and the table, with why.

Pack names are "x" and the number (x001 ... x124): valid identifiers, one per sheet,
and none can clash with an S or N pack. --check writes nothing and fails if either
file is out of date with the catalog.

The sha256 of each sheet must match docs/mascot/refined-expansion-release.json,
the record of what was taken in.
"""

import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "mascot" / "expansion-sheets.json"
TABLE = ROOT / "src" / "components" / "agent" / "mascot" / "engine" / "expansion-table.ts"
TITLES = ROOT / "src" / "components" / "agent" / "mascot" / "engine" / "expansion-titles.ts"
RECORD = ROOT / "docs" / "mascot" / "refined-expansion-release.json"

# Sheets whose final beats contradict their own beat or loop rule, or lose the scene,
# as drawn in the release: they end, and hold, on an earlier beat until redrawn
# (docs/mascot/AMR-EXPANSION-FIX-1.md lists the redraws). {id: (beat, why)}.
HOLD_EARLIER: dict[str, tuple[int, str]] = {
    "X020": (7, "beat 8 draws him and the holder table smaller and lower than every other beat, so he shrinks for the held pose"),
    "X038": (7, "beat 8 shows a thumbs-up, the pass sign its own beat rules out (a restrained nod, no universal accessibility emblem)"),
    "X052": (7, "beat 8 drops the incompatible cartridge, the mismatch its loop rule says must stay in view"),
    "X064": (7, "beat 8 loses the source tray its beat says stays visibly mixed"),
    "X068": (7, "beat 8 swaps Amr and the steady easel to the other sides of the cell, a jump cut"),
    "X069": (7, "beat 8 drops the focus screen, its post, the tray and the folder, leaving only Amr walking"),
    "X072": (7, "beat 8 draws him a fifth smaller, standing above the floor"),
    "X088": (7, "beat 8 doubles the stencil: a loose plate in his hand while the jig keeps its own"),
}

# The catalog's categories, as the gallery groups them.
FAMILY = {
    "reader": "reading",
    "reader-learning": "reading",
    "tool-lab": "tools",
    "data_stewardship_quality": "team",
    "team_ceremony": "team",
    "decisions_discovery": "team",
    "cast-encounter": "cast",
    "useful-guide": "guides",
    "playful": "play",
}


def build(catalog: dict, record: dict) -> tuple[dict, str]:
    sheets = []
    for s in catalog["sheets"]:
        sid = s["id"]
        if sid not in record:
            raise SystemExit(f"{sid} isn't in {RECORD.name}: take the release in first")
        sha = record[sid]["sha256"]
        if s.get("accepted_sheet_sha256") and s["accepted_sheet_sha256"] != sha:
            raise SystemExit(f"{sid}: the catalog's hash isn't the sheet that was taken in")
        if s["category"] not in FAMILY:
            raise SystemExit(f"{sid}: unknown category {s['category']}")
        if len(s["beats"]) != 8:
            raise SystemExit(f"{sid}: {len(s['beats'])} beats, not 8")
        pack = "x" + sid[1:]
        early = HOLD_EARLIER.get(sid)
        sheets.append({
            "id": sid,
            "pack": pack,
            "family": FAMILY[s["category"]],
            "category": s["category"],
            "title": s["title"],
            "purpose": s["purpose"],
            "trigger": s["trigger"],
            "loop": s["loop"],
            "props": s.get("props", []),
            "routes": s.get("source_routes", []),
            "file": record[sid]["file"],
            "sha256": sha,
            "slots": [{"id": f"{pack}.{i}", "beat": beat} for i, beat in enumerate(s["beats"], start=1)],
            **({"last": early[0], "last_why": early[1]} if early else {}),
        })
    ids = [s["id"] for s in sheets]
    if ids != [f"X{n:03d}" for n in range(1, len(ids) + 1)]:
        raise SystemExit("the catalog's sheets aren't X001 onward in order")
    spec = {
        "about": (
            "Amr's expansion scenes X001-X124: eight key poses each (sheets 1536 x 1024, eight "
            "384 x 512 slots; slot 1 is a real beat, so all eight frames ship). From the refined "
            "expansion release of 13 November 2026 (Amr_Refined_Expansion_124.zip, catalog.json; "
            "docs/mascot/refined-expansion-release.json). scripts/build-expansion-spec.py writes "
            "this file, engine/expansion-table.ts and engine/expansion-titles.ts; "
            "scripts/build-mascot-expansion.py builds the packs as drawn. Each sheet's trigger and "
            "loop are the release's own rules: a scene may play only on the real event its trigger "
            "names, or when the visitor asks for it. docs/mascot/expansion-triggers.md records "
            "where each one plays. A sheet with `last` ends, and holds, on that beat: its later "
            "beats are drawn wrong (`last_why`)."
        ),
        "group": "expansion",
        "release": "Amr_Refined_Expansion_124.zip",
        "catalog_schema": catalog.get("schema"),
        "sheets": sheets,
    }
    rows = "\n".join(
        f"  {{ id: {json.dumps(s['id'])}, pack: {json.dumps(s['pack'])}, family: {json.dumps(s['family'])}"
        + (f", last: {s['last']}" if "last" in s else "") + " },"
        for s in sheets
    )
    table = f'''/**
 * The expansion scenes X001-X124: which pack each is and its family. `last` is the
 * beat a scene ends and holds on when its later beats are drawn wrong (the spec's
 * `last_why`). Written by scripts/build-expansion-spec.py from the release's catalog
 * (docs/mascot/expansion-sheets.json holds the whole of it; the titles are in
 * expansion-titles.ts); do not edit by hand.
 */

export type ExpansionFamily = "reading" | "tools" | "team" | "cast" | "guides" | "play";

export interface ExpansionSheet {{
  id: string;
  pack: string;
  family: ExpansionFamily;
  last?: number;
}}

export const EXPANSION_SHEETS: readonly ExpansionSheet[] = [
{rows}
];
'''
    names = "\n".join(f"  {s['pack']}: {json.dumps(s['title'], ensure_ascii=False)}," for s in sheets)
    titles = f'''/**
 * Each expansion scene's title, by pack, for the Scenes tab alone (the engine needs
 * none of them). Written by scripts/build-expansion-spec.py; do not edit by hand.
 */

export const EXPANSION_TITLES: Readonly<Record<string, string>> = {{
{names}
}};
'''
    return spec, table, titles


def folder_arg(args: list[str], valued: tuple[str, ...] = ()) -> Path:
    """The folder given on the command line: the first argument that is neither a flag
    nor a flag's value. No folder, or -h / --help, prints the usage."""
    if "-h" in args or "--help" in args:
        raise SystemExit(__doc__)
    skip = {i + 1 for i, a in enumerate(args) if a in valued}
    for i, a in enumerate(args):
        if i not in skip and not a.startswith("-"):
            return Path(a)
    raise SystemExit(__doc__)


def main(args: list[str]) -> None:
    catalog = json.loads((folder_arg(args) / "catalog.json").read_text(encoding="utf-8"))
    record = json.loads(RECORD.read_text(encoding="utf-8"))["sheets"]
    spec, table, titles = build(catalog, record)
    spec_text = json.dumps(spec, indent=2, ensure_ascii=False) + "\n"
    if "--check" in args:
        # Compared as data, not text: prettier formats both files after they're written.
        stale = []
        if not SPEC.exists() or json.loads(SPEC.read_text(encoding="utf-8")) != spec:
            stale.append(SPEC.name)
        text = TABLE.read_text(encoding="utf-8") if TABLE.exists() else ""
        rows = re.findall(r'id: "(X\d{3})",\s*pack: "(x\d{3})",\s*family: "(\w+)"(?:,\s*last: (\d+))?\s*\}', text)
        have = [(i, p, f, int(n) if n else None) for i, p, f, n in rows]
        want = [(s["id"], s["pack"], s["family"], s.get("last")) for s in spec["sheets"]]
        if have != want:
            stale.append(TABLE.name)
        text = TITLES.read_text(encoding="utf-8") if TITLES.exists() else ""
        names = re.findall(r'(x\d{3}):\s*("(?:[^"\\]|\\.)*"),', text)
        if [(p, json.loads(t)) for p, t in names] != [(s["pack"], s["title"]) for s in spec["sheets"]]:
            stale.append(TITLES.name)
        if stale:
            raise SystemExit(f"out of date with the catalog: {', '.join(stale)}")
        print("expansion spec and table agree with the catalog")
        return
    SPEC.write_text(spec_text, encoding="utf-8", newline="\n")
    TABLE.write_text(table, encoding="utf-8", newline="\n")
    TITLES.write_text(titles, encoding="utf-8", newline="\n")
    print(f"wrote {SPEC.relative_to(ROOT)}, {TABLE.relative_to(ROOT)} and {TITLES.relative_to(ROOT)}: "
          f"{len(spec['sheets'])} sheets")


if __name__ == "__main__":
    main(sys.argv[1:])
