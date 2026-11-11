# Cast puppets: the build contract

The thirty colleagues of _Agile at Work_ appear on the site as cut-out puppets.

- **The art:** ChatGPT Images (2.5 or 2.6) draws each character once, as separate pieces, from a per-character brief.
- **The motion:** code pins the pieces together and moves them a little.

This file is the public-safe half of the contract: what returns from ChatGPT, how it's taken in, checked and approved, and what may never enter git. The character canon lives elsewhere.

## Where things live

| What                                                                                                   | Where                                                                              | In git?                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------- |
| Families, images per character, batches, keys, tolerances, budgets, part ids, tap moves, approved shas | `docs/cast/cast-rig.json`                                                          | yes                                   |
| Generic brief text (how to answer, master block, image blocks, arm wording, checks, fix lines)         | `scripts/cast/brief-blocks.mjs`                                                    | yes                                   |
| Brief generator / batch packer                                                                         | `scripts/build-cast-brief.mjs`, `scripts/cast/make-batches.py`                     | yes                                   |
| Character canon (looks, colours, references, never-lists, conflicts) and the generated briefs          | `D:\Claude Desktop\Agile_At_Work_Cast_Sources\` (`sources/`, `brief/`, `batches/`) | **never**                             |
| Returns from ChatGPT, approved copies, ledgers, review pages                                           | the same folder (`returns/`, `accepted/`, `approved/`, `ledger/`, `review/`)       | **never**                             |
| Built atlases and the rig manifest                                                                     | `public/cast/aaw-NN[@2x].<sha8>.webp`, `src/lib/cast/rigs.generated.ts`            | yes, built only from approved sources |

**Custody rules:**

- The bible's visual canon is private (`test/vip/private-fields.ts`). It never goes in a repo file or a PR description, even after the repo is private again. `test/cast/cast-private-guard.test.ts` holds that line.
- Returns are archived untouched, and nothing from a zip is ever run.
- An approval is bound to the sha256 of the file it approves, so a changed file voids it.
- Never attached to ChatGPT:
  - photographs of real people;
  - the retired Ninja lead;
  - the 26 book episodes' panels;
  - third-party comics;
  - the mascot sprites or their reference sheets.

  The generator refuses them (`NEVER` in `scripts/build-cast-brief.mjs`).

## The lesson the rig is built on

On 2026-11-02 the owner rejected a sliced and rotated arm rig as "it looks malformed" (BOOK-ANATOMY-001 in the companion kit). Passing numeric checks had not established coherent shoulder, elbow, wrist or hand anatomy. The accepted replacement was a pose drawn whole. So:

- **Code turns joints only a little:**
  - head ±10°;
  - an arm ±15° at the shoulder;
  - hip ±10°;
  - tail ±15°;
  - ears ±12°;
  - tie ±8°;
  - cord ±6°;
  - a tentacle or spider leg ±12°.
- **Every big gesture is a drawn whole-arm pose** pinned at the shoulder: wave, arms up, open palm, point, hand at chin, and a signature prop held in that one arm. No limb is ever bent into place, and no prop is pinned to a hand at runtime.
- **The owner's anatomy review is a gate.** Every move's extreme frames are shown at native 240 px, phone 96–128 px and desktop 160–240 px, in Comic, Night and high contrast, and the owner judges each one. That review is the gate, not the numbers.

## What each character's chat returns

Every image is `AAW-NN_<image>.png`, at `canvas_w` × `canvas_h` (1536 × 1024), landscape. Each chat draws the master first and stops for the owner's master check, and every later image is drawn from the approved master.

| Image    | Content                                                                                                                                                                                         | Who                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `master` | front rest pose, arms a little away from the body, blank ID card                                                                                                                                | all                             |
| `parts`  | an exploded edit of the master: listed pieces only, at one size, `gap_ask_px` apart, round overlap caps where a piece tucks under, hidden areas drawn in, empty white eyes with separate pupils | all                             |
| `parts2` | the extra pieces: legs and tail, the fan open and closed, tentacles, spider legs                                                                                                                | Camel, Peacock, Octopus, Spider |
| `face`   | 8 heads: eyes open, blink, happy, wide; mouth rest, smile, "ah", "o"                                                                                                                            | all                             |
| `face2`  | 2 heads: curious, mid-word talk                                                                                                                                                                 | Amr                             |
| `arms`   | 8 whole arms. Top row own right: wave, up, open, point. Bottom row own left: up, open, chin, signature. Amr has 4: right wave, right up, right open, left up                                    | all but Camel                   |

The arm wording follows the body family (`families[*].arms`): human, wing, tube (with a glove), mitten, tentacle or spider leg.

## Taking a return in

Every command takes `--sources <dir>` (default `D:\Claude Desktop\Agile_At_Work_Cast_Sources`) and `--review <dir>` (instead of `<sources>/review`); `--print-tolerances` prints the thresholds.

1. **Intake.** `python -I scripts/build-cast-rigs.py intake <zip | folder | png> [--id AAW-NN]`:
   - archives the return untouched in `returns/<date>-<stem>/original/`, and takes a return it has seen before (same sha256) only once;
   - reads only PNG images from it, as bytes, into a new `returns/<date>-<stem>/extracted/`: names matching `^AAW-(0[1-9]|[12][0-9]|30)_(master|parts|parts2|face|face2|arms)(-v[0-9]+)?\.png$` as they are; other PNGs, whose owner comes from their folder, the zip's name or `--id`, are sorted by content (one figure = master; the face sheet's heads, one silhouette repeated = face or face2; one arm per cell of the arms grid = arms; otherwise parts or parts2 by count) and the mapping is printed for confirmation (a loose PNG never stands in for an image the return names); every read is capped by `intake` in `cast-rig.json`;
   - writes `ledger/received.jsonl` and copies each named image to `accepted/AAW-NN/` (a changed file under the same name moves to `_old/<date>/`; the highest `-vN` is current);
   - prints found / still missing / sorted by content / extra.

   The content-sorted images wait in `extracted/` until `confirm <returns folder> [--file <name> ...]` accepts them, each as the next `-vN` over the current one, so a sorted file never moves an accepted copy.

2. **Check.** `check <AAW-NN | A..E | all> [--masters] [--file <png>] [--no-sheets] [--strict]` audits the accepted images (C1–C4, and C9 on masters against the private block's colours, read at run time) and every published rig (C16), into `review/<batch>/report.json`. `--masters` checks the masters alone (batch A's come back first) and writes a contact sheet per master on light, dark and checker grounds with the margin and height guides. It exits 1 on a failure; with `--strict` also on a warning or an image not returned yet.
3. **Candidate.** `candidate <AAW-NN | A..E | all>` builds into `review/<batch>/AAW-NN/` only, in this order:
   1. key-out with despill, and the palette lock (the master onto the private swatches, every later sheet onto the master's own colours; it moves colour only, so it runs here);
   2. slice;
   3. assign pieces;
   4. register each piece onto the approved master;
   5. find pivots from the cap circles;
   6. cut the pupils from the master and build the face patches;
   7. pin the arm swaps;
   8. compose;
   9. run checks C1–C11 (C12–C15 are the reviewers' and the owner's).
4. **Approve.** `approve <AAW-NN> --image <img> | --rig --by owner|opus --words "…"` appends to `ledger/approvals.jsonl` and mirrors the sha into `cast-rig.json` (each character's `approved`). Every rig needs the owner's approval, and Amr refuses anything else.
5. **Build.** `build <AAW-NN | A..E | all>` refuses unless every source sha equals its approval and the owner approved the candidate rig. It then writes the atlases and `rigs.generated.ts` and runs C16.

## Checks (thresholds are keys in `cast-rig.json` → `tolerances`)

| #   | Check                                                       | Pass                                                                                                                                                               |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | names, PNG, canvas size, the character's expected image set | all present                                                                                                                                                        |
| C2  | background                                                  | real alpha (≥ `bg_transparent_min` of pixels clear, no drawn checkerboard) or the key colour; residue after despill ≤ `despill_residue_max` of edge pixels         |
| C3  | margins                                                     | nothing within `margin_fail_px` of an edge                                                                                                                         |
| C4  | counts                                                      | specks < `speck_px` dropped and listed; parts match the spec; face 8 (face2 2); arms 8 (Amr 4)                                                                     |
| C5  | separation                                                  | gaps ≥ `gap_fail_px`; no piece over 1.6× its expected area (fused)                                                                                                 |
| C6  | registration                                                | NCC ≥ `ncc_min` (warn below `ncc_warn`); scale within `scale_min`–`scale_max`; tilt ≤ `tilt_deg`; rest-pose IoU ≥ `iou_rest` (`iou_rest_complex` for complex rigs) |
| C7  | caps and joints                                             | circle residual ≤ `cap_residual`; ≥ `cap_cover` of cap pixels under the parent at rest; the joint disc stays ≥ `joint_cover` covered across its range              |
| C8  | hidden fill                                                 | the torso is solid between the shoulder and hip lines; a neck stub exists; every fill region is opaque                                                             |
| C9  | palette                                                     | the master is within `de00_fix` of the private swatches; later sheets are shifted to the master and agree after the lock                                           |
| C10 | face swaps                                                  | aligned to the head; the patch ring matches; open and wide whites are empty; pupils ≥ `pupil_min_px` and stay inside the white                                     |
| C11 | arm swaps (by family)                                       | the shoulder end matches the rest arm's; the sleeve colour holds; straight poses keep the arm's length; the top row is the own right                               |
| C12 | text and marks                                              | none, viewed at 50% and 100% on light and dark                                                                                                                     |
| C13 | identity and style                                          | two reviewers and a skeptic against the sheet and panels; three judges on Amr's face against R16                                                                   |
| C14 | assembly and motion                                         | every move's extreme frames compose with no gaps; **the owner's anatomy review**                                                                                   |
| C15 | size and ground                                             | contact sheets at 96, 160 and 240 px in Comic, Night and high contrast; the owner approves                                                                         |
| C16 | pack                                                        | bytes within `budgets`; names are sha256[:8]; 2x is exactly 2× 1x; nodes ≤ `rig_nodes_max`; animated ≤ `rig_animated_max`; source shas match the approvals         |

## Fix rounds

- **1–2 things wrong:** an edit line ("keep everything except …").
- **3 or more things wrong, style drift, text, fused pieces or a bad background:** regenerate from the approved master.
- **Wrong identity:** a new master, and everything after it again.
- **After 3 rounds on one image:** only code repairs, each logged in the ledger (extend a cap, clone a hidden fill from the master, clear specks).

## Batches and the pilot

There are five batches of six. Batch A is the pilot, one character per body family: Amr, Dependable Beaver, Capacity Camel, Overengineering Octopus, Vanity Metrics Peacock and Agile Sticky.

1. Batch A's masters come back first.
2. Batches B–E may draw their masters once batch A's masters pass.
3. Their parts, faces and arms wait for the owner's pilot approval of batch A's assembled rigs.
4. The pilot also measures real atlases and rewrites `budgets`.
