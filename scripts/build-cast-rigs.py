"""
Build the cast puppet rigs from the art ChatGPT returns (docs/cast/CAST-BUILD.md).

    python -I scripts/build-cast-rigs.py intake <zip | folder | png> [--id AAW-NN]
    python -I scripts/build-cast-rigs.py confirm <returns folder> [--file <name> ...]
    python -I scripts/build-cast-rigs.py check <AAW-NN | A..E | all> [--masters] [--file <png>]
                                                [--no-sheets] [--strict]
    python -I scripts/build-cast-rigs.py candidate <AAW-NN | A..E | all>
    python -I scripts/build-cast-rigs.py approve <AAW-NN> (--image <image> | --rig)
                                                --by owner|opus --words "..."
    python -I scripts/build-cast-rigs.py build <AAW-NN | A..E | all>
    python -I scripts/build-cast-rigs.py --print-tolerances

Every command takes --sources <dir> (default D:/Claude Desktop/Agile_At_Work_Cast_Sources),
the private folder holding the returns, the accepted and approved copies, the
ledgers and the review output. Nothing private is ever written into the repo:

  intake     archives a return untouched under returns/<date>-<stem>/, reads only its
             PNG images (by name, or sorted by what they hold when the names are
             missing), writes ledger/received.jsonl and copies the named ones to
             accepted/<id>/; the sorted ones wait for confirm
  confirm    accepts the content-sorted images of one return once their printed
             mapping is right, each over the current version
  check      audits what is accepted (C1-C4, and C9 on masters) and what is published
             (C16), into review/<batch>/; with --masters, only the masters, each with a
             contact sheet on light, dark and checker grounds. Exits 1 on a failure
             (and on a warning or a missing image with --strict)
  candidate  builds each rig into review/<batch>/<id>/ only (C1-C11)
  approve    records an approval bound to the file's (or the rig's) sha256 in
             ledger/approvals.jsonl and mirrors the sha into docs/cast/cast-rig.json
  build      refuses unless every source sha is approved and the owner approved the
             rig; writes public/cast/aaw-NN[@2x].<sha8>.webp and
             src/lib/cast/rigs.generated.ts; runs C16

Every threshold comes from docs/cast/cast-rig.json. Needs Pillow and numpy only.
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.stdout.reconfigure(errors="replace")  # a console without UTF-8 still prints
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cast import checks, intake, ledger, palette, publish, review, rig  # noqa: E402
from cast.spec import DEFAULT_SOURCES, TOL, batch_of, character, targets  # noqa: E402

MARK = {"pass": "ok  ", "warn": "WARN", "fail": "FAIL", "skip": "--  ", "missing": "....", "pending": "...."}


def owner_at_terminal(cid: str, what: str, sha: str) -> bool:
    """The owner's own confirmation: typed at a terminal, never by an agent's
    session (CLAUDECODE set) and never from a pipe."""
    if os.environ.get("CLAUDECODE") or not sys.stdin.isatty():
        raise SystemExit("--by owner is typed by the owner at a terminal; an agent records --by opus")
    want = f"{cid} {sha[:8]}"
    return input(f"Type {want} to approve {cid} {what} as the owner: ").strip() == want


def colours_for(sources: Path, cid: str):
    try:
        return palette.block_colours(sources, cid)
    except FileNotFoundError:
        return None


def print_master(rep: dict) -> None:
    print(f"{MARK[rep['status']]} {rep['id']} master {rep['file']}")
    for name, res in rep["checks"].items():
        notes = "; ".join(res.get("notes", []))
        line = f"       {name:6s} {res.get('status', 'skip'):4s}"
        if name == "height" and res.get("height_px"):
            line += f" {res['height_px']} px tall ({res['ratio']:.0%} of {TOL['master_height_px']})"
        if notes:
            line += f"  {notes}"
        print(line)
        if name == "C9":
            for row in res.get("colours", []):
                if row["status"] != "ok":
                    de = "-" if row.get("de00") is None else f"{row['de00']:.1f}"
                    print(f"              {row['status']:5s} dE00 {de:>5s}  {row['label']}")


def crashed(cid: str, e: Exception) -> None:
    """One character's unexpected error, printed so the rest of the batch runs on."""
    print(f"{MARK['fail']} {cid}: {type(e).__name__}: {e}")


def cmd_check(args, sources: Path) -> int:
    ids = targets(args.target)
    if args.file and len(ids) != 1:
        raise SystemExit("--file checks one character's file: name one AAW-NN")
    by_batch: dict = {}
    bad = False
    for cid in ids:
        try:
            bad |= check_one(args, sources, cid, by_batch)
        except SystemExit as e:
            print(f"{MARK['fail']} {e}")
            bad = True
        except Exception as e:  # noqa: BLE001 - one bad character never stops the batch
            crashed(cid, e)
            bad = True
    mode = "masters" if args.masters else "check"
    for batch, reps in by_batch.items():
        merged: dict = {}
        for r in reps:
            merged.setdefault(r["id"], {"id": r["id"], "images": {}})["images"][r["image"]] = r
        path = review.write_report(sources, batch, mode, list(merged.values()), args.review)
        print(f"report: {path}")
    if not args.masters and not args.file:
        for res in publish.check_published(ids):
            print(f"{MARK[res['status']]} {res['id']} published (C16)  {'; '.join(res['notes'])}")
            bad |= res["status"] == "fail"
    return 1 if bad else 0


def check_one(args, sources: Path, cid: str, by_batch: dict) -> bool:
    """Check one character's accepted images into by_batch; True when one failed."""
    bad = False
    c = character(cid)
    batch = batch_of(cid)
    images = ["master"] if args.masters else c["images"]
    waiting = []
    for img in images:
        path = Path(args.file) if args.file else ledger.accepted_file(sources, cid, img)
        if path is None:
            waiting.append(img)
            bad |= args.strict
            continue
        if img == "master":
            rep, extra = checks.check_master(path, c, colours_for(sources, cid))
            if not args.no_sheets:
                dest = review.review_dir(sources, batch, args.review) / f"{cid}_master-check.png"
                review.master_sheet(rep, extra, dest)
                rep["sheet"] = dest.name
            print_master(rep)
        else:
            s = rig.load_sheet(path, c, img)
            rep = {
                "id": cid,
                "image": img,
                "file": path.name,
                "sha256": s["sha256"],
                "checks": s["checks"],
                "status": checks.worst(*(v["status"] for v in s["checks"].values())),
            }
            notes = "; ".join(n for v in s["checks"].values() for n in v.get("notes", []))
            print(f"{MARK[rep['status']]} {cid} {img} {path.name}  {notes}")
        by_batch.setdefault(batch, []).append(rep)
        bad |= rep["status"] == "fail" or (args.strict and rep["status"] == "warn")
    if waiting:
        print(f"{MARK['missing']} {cid} {c['name']}: not returned yet: {', '.join(waiting)}")
    return bad


def cmd_candidate(args, sources: Path) -> int:
    by_batch: dict = {}
    bad = False
    for cid in targets(args.target):
        try:
            rep = rig.candidate(cid, sources, args.review)
        except SystemExit as e:
            print(f"{MARK['fail']} {e}")
            bad = True
            continue
        except Exception as e:  # noqa: BLE001 - one bad character never stops the batch
            crashed(cid, e)
            bad = True
            continue
        by_batch.setdefault(batch_of(cid), []).append(rep)
        bad |= rep["status"] == "fail"
    for batch, reps in by_batch.items():
        print(f"report: {review.write_report(sources, batch, 'candidate', reps, args.review)}")
    return 1 if bad else 0


def cmd_build(args, sources: Path) -> int:
    bad = False
    for cid in targets(args.target):
        try:
            res = publish.build(cid, sources, review_root=args.review)
        except SystemExit as e:
            print(f"{MARK['fail']} {e}")
            bad = True
            continue
        except Exception as e:  # noqa: BLE001 - one bad character never stops the batch
            crashed(cid, e)
            bad = True
            continue
        for n in res["notes"]:
            print(f"       {n}")
        bad |= res["status"] == "fail"
    return 1 if bad else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="build-cast-rigs.py", description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--sources", default=str(DEFAULT_SOURCES), help="the private cast sources folder")
    ap.add_argument("--review", help="write review output here instead of <sources>/review")
    ap.add_argument("--print-tolerances", action="store_true", help="print docs/cast/cast-rig.json tolerances")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("intake", help="take a return in")
    p.add_argument("src", help="ChatGPT's zip, a folder of PNGs or one PNG")
    p.add_argument("--id", help="whose loose PNGs these are, when no name or folder says")
    p = sub.add_parser("confirm", help="accept a return's content-sorted images")
    p.add_argument("ret", help="the return's folder under returns/ (intake prints it)")
    p.add_argument("--file", action="append", help="only this extracted name (repeatable)")
    p = sub.add_parser("check", help="audit accepted images and published rigs")
    p.add_argument("target", help="AAW-NN, a batch A..E, or all")
    p.add_argument("--masters", action="store_true", help="only the masters (batch A comes back first)")
    p.add_argument("--file", help="check this PNG instead of the accepted copy")
    p.add_argument("--no-sheets", action="store_true", help="skip the contact sheets")
    p.add_argument("--strict", action="store_true", help="fail on warnings and missing images too")
    p = sub.add_parser("candidate", help="build candidate rigs into review/ only")
    p.add_argument("target")
    p = sub.add_parser("approve", help="record an approval bound to a sha256")
    p.add_argument("target", help="AAW-NN")
    p.add_argument("--image", help="the accepted image to approve (master, parts, ...)")
    p.add_argument("--rig", action="store_true", help="approve the candidate rig")
    p.add_argument("--by", required=True, choices=publish.BY)
    p.add_argument("--words", required=True, help="the approval in the approver's words")
    p = sub.add_parser("build", help="publish approved rigs")
    p.add_argument("target")
    args = ap.parse_args(argv)
    sources = Path(args.sources)
    if args.print_tolerances:
        print(json.dumps(TOL, indent=2))
        return 0
    if args.cmd == "intake":
        intake.intake(Path(args.src), sources, cid=args.id)
        return 0
    if args.cmd == "confirm":
        intake.confirm(sources, args.ret, args.file)
        return 0
    if args.cmd == "check":
        return cmd_check(args, sources)
    if args.cmd == "candidate":
        return cmd_candidate(args, sources)
    if args.cmd == "approve":
        character(args.target)
        publish.approve(
            args.target,
            sources,
            args.by,
            args.words,
            image=args.image,
            rig_=args.rig,
            review_root=args.review,
            confirm=owner_at_terminal,
        )
        return 0
    if args.cmd == "build":
        return cmd_build(args, sources)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
