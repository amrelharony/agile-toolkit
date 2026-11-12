"""Approving and building: the only way art reaches the repo.

    approve(cid, sources, image=..., rig=..., by=..., words=...)
        appends to ledger/approvals.jsonl and mirrors the sha into cast-rig.json
        (each character's `approved`); AAW-01 takes only the owner's word
    build(cid, sources)
        refuses unless every source image's current sha has an approval, the
        candidate is untouched and the owner approved that rig, and (before
        writing anything) unless the atlases fit their budget and C16 passes on
        the bytes in hand; then writes public/cast/aaw-NN[@2x].<sha8>.webp and
        src/lib/cast/rigs.generated.ts (keeping the other characters'), removes the
        rig's old atlases and runs C16 on what it wrote
    c16(man, public_dir)
        bytes within budget, names = sha256[:8] of the bytes, 2x exactly 2x 1x,
        sprite rects inside the atlas and apart, nodes and animated parts capped
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

from PIL import Image

from . import atlas, fmt, ledger, rig
from . import imaging as im
from .spec import AMR, BUDGETS, ROOT, SPEC_PATH, batch_of, character, is_complex, load_spec, signature_problem

PUBLIC = ROOT / "public" / "cast"
TS_PATH = ROOT / "src" / "lib" / "cast" / "rigs.generated.ts"
BY = ("owner", "opus")


def candidate_path(sources: Path, cid: str, review_root: Path | None = None) -> Path:
    root = Path(review_root) if review_root else Path(sources) / "review"
    return root / batch_of(cid) / cid / "candidate.json"


def mirror(spec_path: Path, cid: str, image: str, sha: str) -> None:
    """Write the approved sha into the spec file, keeping its formatting."""
    spec = load_spec(spec_path)
    c = next(x for x in spec["characters"] if x["id"] == cid)
    c.setdefault("approved", {})[image] = sha
    spec_path.write_text(fmt.json_text(spec), encoding="utf-8", newline="\n")


def mirror_built(spec_path: Path, cid: str, built: dict) -> None:
    """Write what build shipped (the rig sha it built from and the atlas names)
    into the spec file, so C16 can hold the published rig to its approval."""
    spec = load_spec(spec_path)
    c = next(x for x in spec["characters"] if x["id"] == cid)
    c["built"] = built
    spec_path.write_text(fmt.json_text(spec), encoding="utf-8", newline="\n")


def approve(
    cid: str,
    sources: Path,
    by: str,
    words: str,
    image: str | None = None,
    rig_: bool = False,
    spec_path: Path = SPEC_PATH,
    review_root: Path | None = None,
    out=print,
    confirm=None,
) -> dict:
    """Record one approval. The owner's word is never a flag: `confirm(cid, what,
    sha)` must come back True, which the CLI only does when the owner types the
    id and the sha's first 8 at a terminal (an agent records --by opus)."""
    c = character(cid)
    if by not in BY:
        raise SystemExit(f"--by must be one of {', '.join(BY)}")
    if cid == AMR and by != "owner":
        raise SystemExit(f"{cid} takes only the owner's approval (--by owner)")
    if not words or not words.strip():
        raise SystemExit("--words: the approval's own words are required")
    if bool(image) == bool(rig_):
        raise SystemExit("approve one thing: --image <image> or --rig")
    if rig_:
        cp = candidate_path(sources, cid, review_root)
        if not cp.exists():
            raise SystemExit(f"{cid}: no candidate to approve; run candidate first")
        cand = json.loads(cp.read_text(encoding="utf-8"))
        if rig.rig_sha(cand) != cand.get("rig_sha256"):
            raise SystemExit(f"{cid}: candidate.json was changed after it was built")
        for img, sha in cand["sources"].items():
            p = ledger.accepted_file(sources, cid, img)
            if p is None or im.sha256_file(p) != sha:
                raise SystemExit(f"{cid}: {img} changed since the candidate; build a new candidate")
        what, sha, name = "rig", cand["rig_sha256"], cp.name
    else:
        if image not in c["images"]:
            raise SystemExit(f"{cid} has no {image} image")
        p = ledger.accepted_file(sources, cid, image)
        if p is None:
            raise SystemExit(f"{cid}: no accepted {image}")
        what, sha, name = image, im.sha256_file(p), p.name
    if by == "owner":
        if confirm is None:
            raise SystemExit("--by owner is typed by the owner at a terminal; an agent records --by opus")
        if not confirm(cid, what, sha):
            raise SystemExit(f"{cid} {what}: not confirmed; nothing recorded")
    row = {"id": cid, "image": what, "file": name, "sha256": sha, "by": by, "words": words.strip(), "date": ledger.now()}
    if by == "owner":
        row["tty"] = True
    ledger.append(ledger.approvals_path(sources), row)
    mirror(spec_path, cid, what, sha)
    out(f"approved {cid} {what} {sha[:12]} by {by}")
    return row


def owner_approval(sources: Path, cid: str, image: str, sha: str) -> dict | None:
    """The owner's approval of exactly this sha, as the owner confirmed it at a
    terminal (a row that only says by: owner is not one)."""
    for r in reversed(ledger.approvals_for(sources, cid, image)):
        if r.get("sha256") == sha and r.get("by") == "owner" and r.get("tty") is True:
            return r
    return None


def refusals(cid: str, sources: Path, review_root: Path | None = None) -> tuple[list[str], dict | None]:
    c = character(cid)
    why = []
    cp = candidate_path(sources, cid, review_root)
    cand = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else None
    for img in c["images"]:
        p = ledger.accepted_file(sources, cid, img)
        if p is None:
            why.append(f"{img}: nothing accepted")
            continue
        sha = im.sha256_file(p)
        if ledger.approval_of(sources, cid, img, sha) is None:
            why.append(f"{img}: {p.name} ({sha[:12]}) has no approval")
        elif cid == AMR and owner_approval(sources, cid, img, sha) is None:
            why.append(f"{img}: {cid} needs the owner's approval")
        if cand and cand["sources"].get(img) != sha:
            why.append(f"{img}: changed since the candidate")
    if cand is None:
        why.append("no candidate")
        return why, None
    a2 = cp.parent / "atlas@2x.png"
    if not a2.exists() or im.sha256_file(a2) != cand["atlas2x"]:
        why.append("the candidate's atlas changed or is gone")
    if rig.rig_sha(cand) != cand.get("rig_sha256"):
        why.append("candidate.json was changed after it was built")
    elif owner_approval(sources, cid, "rig", cand["rig_sha256"]) is None:
        why.append(f"rig {cand['rig_sha256'][:12]} has no owner approval")
    return why, cand


def build(
    cid: str,
    sources: Path,
    public_dir: Path = PUBLIC,
    ts_path: Path = TS_PATH,
    review_root: Path | None = None,
    spec_path: Path = SPEC_PATH,
    out=print,
) -> dict:
    why, cand = refusals(cid, sources, review_root)
    if why:
        raise SystemExit(f"{cid}: build refused:\n  " + "\n  ".join(why))
    a2 = Image.open(candidate_path(sources, cid, review_root).parent / "atlas@2x.png").convert("RGBA")
    a1, amount = atlas.one_x(a2)
    k = "atlas_complex_" if is_complex(cid) else "atlas_"
    b1, q1, ok1 = atlas.webp(a1, BUDGETS[k + "1x_kb"])
    b2, q2, ok2 = atlas.webp(a2, BUDGETS[k + "2x_kb"])
    if not (ok1 and ok2):
        raise SystemExit(
            f"{cid}: atlas over budget even at q{q1}/q{q2} ({len(b1)} B 1x, {len(b2)} B 2x; caps "
            f"{BUDGETS[k + '1x_kb']} KB / {BUDGETS[k + '2x_kb']} KB); nothing written"
        )
    n1, n2 = atlas.atlas_names(cid, b1, b2)
    man = json.loads(json.dumps(cand["manifest"]))
    man["atlas"] = {"x1": f"/cast/{n1}", "x2": f"/cast/{n2}", "bytes1": len(b1), "bytes2": len(b2)}
    spec = load_spec(spec_path)
    # C16 on the bytes in hand first: a rig that would fail it never reaches the repo.
    built = {"rig": cand["rig_sha256"], "x1": n1, "x2": n2}
    pre = c16_bytes(man, {n1: b1, n2: b2}, spec, built=built)
    if pre["status"] == "fail":
        raise SystemExit(f"{cid}: C16 would fail, nothing written:\n  " + "\n  ".join(pre["notes"]))
    rigs = rig.read_ts(ts_path)  # stops here, before any write, on a file it can't read back
    rigs[cid] = man
    # New files first, the module swapped in whole, and only then the old atlases go,
    # so a build cut short never leaves the repo without a rig's last good atlas.
    public_dir.mkdir(parents=True, exist_ok=True)
    (public_dir / n1).write_bytes(b1)
    (public_dir / n2).write_bytes(b2)
    ts_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = ts_path.with_name(ts_path.name + ".tmp")
    tmp.write_text(rig.ts_file(rigs), encoding="utf-8", newline="\n")
    os.replace(tmp, ts_path)
    nn = cid.split("-")[1]
    for old in list(public_dir.glob(f"aaw-{nn}.*.webp")) + list(public_dir.glob(f"aaw-{nn}@2x.*.webp")):
        if old.name not in (n1, n2):
            old.unlink()
    mirror_built(spec_path, cid, built)
    res = c16(man, public_dir, load_spec(spec_path), sources)
    res["quality"] = {"1x": q1, "2x": q2, "sharpen": amount}
    out(f"{cid}: built {n1} ({len(b1)} B), {n2} ({len(b2)} B); C16 {res['status']}")
    return res


def _rects(man: dict, size: tuple[int, int]) -> list[tuple[float, float, float, float]]:
    AW, AH = size
    out = []

    def one(sp):
        sx, sy, px, py = sp["bg"]
        w, h = AW * 100 / sx, AH * 100 / sy
        out.append((px / 100 * (AW - w), py / 100 * (AH - h), w, h))

    for p in man["parts"]:
        if p.get("sprite"):
            one(p["sprite"])
    for s in man["swaps"]:
        for ch in s["choices"]:
            if ch.get("sprite"):
                one(ch["sprite"])
    return out


def c16(man: dict, public_dir: Path = PUBLIC, spec: dict | None = None, sources: Path | None = None) -> dict:
    """C16 on one published rig: its atlases as they are in public_dir."""
    files = {}
    for key_ in ("x1", "x2"):
        f = Path(public_dir) / Path(man["atlas"][key_]).name
        if f.exists():
            files[f.name] = f.read_bytes()
    return c16_bytes(man, files, spec, sources=sources)


def c16_bytes(
    man: dict, files: dict, spec: dict | None = None, built: dict | None = None, sources: Path | None = None
) -> dict:
    """C16 on a rig and its atlas bytes ({file name: bytes}). Fails on a missing
    or misnamed atlas, bytes over budget, a 2x that isn't twice the 1x, rects
    outside or overlapping, node or animation counts over the caps, a bad tap-move
    list; with the spec, an approval not mirrored, or a rig not the one built
    from the approved rig sha under these atlas names (`built`, or the spec's own
    record); with the sources, a mirrored sha with no row in the approvals ledger."""
    notes = []
    cid = man["id"]
    k = "atlas_complex_" if is_complex(cid) else "atlas_"
    sizes = {}
    for which, key_, bkey, cap in (("1x", "x1", "bytes1", k + "1x_kb"), ("2x", "x2", "bytes2", k + "2x_kb")):
        name = Path(man["atlas"][key_]).name
        data = files.get(name)
        if data is None:
            notes.append(f"{which} atlas {name} missing")
            continue
        if not name.endswith(f".{im.sha256_bytes(data)[:8]}.webp"):
            notes.append(f"{name} is not named after its bytes")
        if len(data) != man["atlas"][bkey]:
            notes.append(f"{name} is {len(data)} B, the manifest says {man['atlas'][bkey]}")
        if len(data) > BUDGETS[cap] * 1024:
            notes.append(f"{name} is {len(data)} B, over {BUDGETS[cap]} KB")
        with Image.open(io.BytesIO(data)) as img:
            sizes[which] = img.size
    if len(sizes) == 2 and sizes["2x"] != (2 * sizes["1x"][0], 2 * sizes["1x"][1]):
        notes.append(f"2x atlas {sizes['2x']} is not twice the 1x {sizes['1x']}")
    if "1x" in sizes:
        rects = [(round(x), round(y), round(w), round(h)) for x, y, w, h in _rects(man, sizes["1x"])]
        if not atlas.rects_ok(rects, sizes["1x"]):
            notes.append("sprite rects leave the atlas or overlap")
    if man["counts"]["nodes"] > BUDGETS["rig_nodes_max"]:
        notes.append(f"{man['counts']['nodes']} nodes, over {BUDGETS['rig_nodes_max']}")
    if man["counts"]["animated"] > BUDGETS["rig_animated_max"]:
        notes.append(f"{man['counts']['animated']} animated parts, over {BUDGETS['rig_animated_max']}")
    why = signature_problem(man.get("signature"), cid)
    if why:
        notes.append(f"signature: {why}")
    if "translucent" in man and not 0 < man["translucent"] < 1:
        notes.append(f"translucent {man['translucent']} is not between 0 and 1")
    if spec is not None:
        c = next((x for x in spec["characters"] if x["id"] == cid), None)
        appr = (c or {}).get("approved", {})
        if "rig" not in appr:
            notes.append("no approved rig sha in cast-rig.json")
        for img in (c or {}).get("images", []):
            if img not in appr:
                notes.append(f"no approved {img} sha in cast-rig.json")
        made = built if built is not None else (c or {}).get("built")
        if not made:
            notes.append("no build record in cast-rig.json")
        else:
            if made.get("rig") != appr.get("rig"):
                notes.append("built from a rig sha the owner didn't approve")
            names = (Path(man["atlas"]["x1"]).name, Path(man["atlas"]["x2"]).name)
            if names != (made.get("x1"), made.get("x2")):
                notes.append("its atlases are not the ones build wrote")
        if sources is not None:
            for img, sha in appr.items():
                if ledger.approval_of(sources, cid, img, sha) is None:
                    notes.append(f"{img}: the sha in cast-rig.json has no row in the approvals ledger")
    return {"status": "fail" if notes else "pass", "notes": notes, "id": cid}


def published(ts_path: Path = TS_PATH) -> dict:
    return rig.read_ts(ts_path)


def check_published(
    ids: list[str],
    public_dir: Path = PUBLIC,
    ts_path: Path = TS_PATH,
    sources: Path | None = None,
    spec_path: Path = SPEC_PATH,
) -> list[dict]:
    """C16 for every published rig among ids, plus files in public/cast that no
    rig names."""
    rigs = published(ts_path)
    spec = load_spec(spec_path)
    res = [c16(rigs[i], public_dir, spec, sources) for i in ids if i in rigs]
    named = {Path(m["atlas"][k]).name for m in rigs.values() for k in ("x1", "x2")}
    if Path(public_dir).is_dir():
        stray = sorted(p.name for p in Path(public_dir).iterdir() if p.is_file() and p.name not in named)
        if stray:
            res.append({"status": "fail", "notes": [f"public/cast holds files no rig names: {', '.join(stray)}"], "id": "public/cast"})
    return res

