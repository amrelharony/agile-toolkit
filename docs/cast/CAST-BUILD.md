# Cast puppets: the build contract

The thirty colleagues of _Agile at Work_ appear on the site as cut-out puppets.

- **The art:** ChatGPT Images (2.5 or 2.6) draws each character once, as separate pieces, from a per-character brief.
- **The motion:** code pins the pieces together and moves them a little.

This file is the public-safe half of the contract: what returns from ChatGPT, how it's taken in, checked and approved, and what may never enter git. The character canon lives elsewhere.

## Where things live

| What                                                                                                                             | Where                                                                              | In git?                               |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| Families, images per character, batches, keys, tolerances, budgets, part ids, what the face cells hold, tap moves, approved shas | `docs/cast/cast-rig.json`                                                          | yes                                   |
| Generic brief text (how to answer, master block, image blocks, arm wording, checks, fix lines)                                   | `scripts/cast/brief-blocks.mjs`                                                    | yes                                   |
| Brief generator / batch packer                                                                                                   | `scripts/build-cast-brief.mjs`, `scripts/cast/make-batches.py`                     | yes                                   |
| Character canon (looks, colours, references, never-lists, conflicts) and the generated briefs                                    | `D:\Claude Desktop\Agile_At_Work_Cast_Sources\` (`sources/`, `brief/`, `batches/`) | **never**                             |
| Returns from ChatGPT, approved copies, ledgers, review pages                                                                     | the same folder (`returns/`, `accepted/`, `approved/`, `ledger/`, `review/`)       | **never**                             |
| Built atlases and the rig manifest                                                                                               | `public/cast/aaw-NN[@2x].<sha8>.webp`, `src/lib/cast/rigs.generated.ts`            | yes, built only from approved sources |

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
  - hip ±10° (every leg on a side, its front, middle and hind legs too);
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

Every command takes `--sources <dir>` (default `D:\Claude Desktop\Agile_At_Work_Cast_Sources`) and `--review <dir>` (instead of `<sources>/review`), both refused inside a git work tree, since they hold the private swatches; `--print-tolerances` prints the thresholds.

1. **Intake.** `python -I scripts/build-cast-rigs.py intake <zip | folder | png> [--id AAW-NN]`:
   - archives the return untouched in `returns/<date>-<stem>/original/`, and takes a return it has seen before (same sha256) only once;
   - reads only PNG images from it, as bytes, into a new `returns/<date>-<stem>/extracted/`: names matching `^AAW-(0[1-9]|[12][0-9]|30)_(master|parts|parts2|face|face2|arms)(-v[0-9]+)?\.png$` as they are; other PNGs, whose owner comes from their folder, the zip's name or `--id`, are sorted by content (one figure = master; the face sheet's heads, one silhouette repeated = face or face2; one arm per cell of the arms grid = arms; otherwise parts or parts2 by count) and the mapping is printed for confirmation (a loose PNG never stands in for an image the return names); every read is capped by `intake` in `cast-rig.json`;
   - writes `ledger/received.jsonl` and copies each named image to `accepted/AAW-NN/` (a changed file under the same name moves to `_old/<date>/`; the highest `-vN` is current);
   - prints found / still missing / sorted by content / extra.

   The content-sorted images wait in `extracted/` until `confirm <returns folder> [--file <name> ...]` accepts them, each as the next `-vN` over the current one, so a sorted file never moves an accepted copy.

2. **Check.** `check <AAW-NN | A..E | all> [--masters] [--file <png> [--image <image>]] [--no-sheets] [--strict]` audits the accepted images (or one file, as the image its name or `--image` says) (C1–C4, and C9 on masters against the private block's colours, read at run time) and every published rig (C16), into `review/<batch>/report.json`. `--masters` checks the masters alone (batch A's come back first) and writes a contact sheet per master on light, dark and checker grounds with the margin and height guides. It exits 1 on a failure; with `--strict` also on a warning, an image not returned yet, or a master with no private block to check its colours against.
3. **Candidate.** `candidate <AAW-NN | A..E | all>` builds into `review/<batch>/AAW-NN/` only, in this order:
   1. key-out with despill, and the palette lock (the master onto the private swatches, every later sheet onto the master's own colours; it moves colour only, so it runs here);
   2. slice;
   3. assign pieces: name each piece by where imageParts lays it (a tail anywhere at the sides) and by generic bands of size and shape, with a pair's two pieces alike and its right piece on your left (parts2 in the order of its list);
   4. register each piece onto the approved master, and search a piece that explains none of the master on its own (a mostly hidden tail) again where the placed pieces leave the master unexplained;
   5. find pivots from the cap circles (a folded corner from its fold edge, an open fan from its base point);
   6. cut the pupils from the master and build the face patches;
   7. pin the arm swaps;
   8. compose;
   9. run checks C1–C11 (C12–C15 are the reviewers' and the owner's).
4. **Approve.** `approve <AAW-NN> --image <img> | --rig --by owner|opus --words "…"` appends to `ledger/approvals.jsonl` and mirrors the sha into `cast-rig.json` (each character's `approved`). Every rig needs the owner's approval, and Amr refuses anything else. `--by owner` is the owner at a terminal: it asks for the id and the sha's first 8 characters to be typed, and refuses a pipe or an agent's session, which record `--by opus`.
5. **Build.** `build <AAW-NN | A..E | all>` refuses unless every source sha equals its approval and the owner approved the candidate rig. It checks the atlases' budget and C16 on the bytes in hand before writing anything, then writes the atlases, `rigs.generated.ts` and the character's `built` record in `cast-rig.json` (the rig sha it built from and the atlas names), and runs C16 on what it wrote.

## Checks (thresholds are keys in `cast-rig.json` → `tolerances`)

| #   | Check                                                       | Pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | names, PNG, canvas size, the character's expected image set | all present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| C2  | background                                                  | real alpha (≥ `bg_transparent_min` of pixels clear, no drawn checkerboard) or the key colour; residue after despill ≤ `despill_residue_max` of edge pixels                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C3  | margins                                                     | nothing within `margin_fail_px` of an edge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C4  | counts                                                      | specks < `speck_px` dropped and listed; parts match the spec; face 8 (face2 2); arms 8 (Amr 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| C5  | separation                                                  | gaps ≥ `gap_fail_px`; no piece over 1.6× its expected area (fused)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| C6  | registration                                                | NCC ≥ `ncc_min` (warn below `ncc_warn`) over what the master shows of the piece; at most `reg_unexplained_max` of a piece off the figure or drawn otherwise where no other piece lies, and at least `reg_coverage_min` of it on the figure; at least `own_visible_min_px` master pixels that it alone explains (its own colours, where no other placed piece's are), so a mostly hidden piece can't lie on another of the same colours; scale within `scale_min`–`scale_max`; tilt ≤ `tilt_deg`; rest-pose IoU ≥ `iou_rest` (`iou_rest_complex` for complex rigs)                                                                      |
| C7  | caps and joints                                             | circle residual ≤ `cap_residual`; ≥ `cap_cover` of cap pixels under the parent at rest; the joint disc stays ≥ `joint_cover` covered across its range; a folded corner turns about the middle of its straight fold edge (no cap to fit) and warns when its disc opens                                                                                                                                                                                                                                                                                                                                                                  |
| C8  | hidden fill                                                 | the torso is solid between the shoulder and hip lines; a neck stub exists under the head's pivot, on the piece the head hangs on (the body, or a neck); every fill region is opaque                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C9  | palette                                                     | the master is within `de00_fix` of the private swatches; each later sheet's colours come within `de00_regen` of the master's own (past it: regenerate; past `de00_fix`: an edit line), and agree after the lock (median ≤ `lock_median_max`, each ≤ `lock_swatch_max`)                                                                                                                                                                                                                                                                                                                                                                 |
| C10 | face swaps                                                  | aligned to the head; each state changes the head only inside its slot's band (the eyes and mouth bands are read from where the face cells differ, the fixed `face_eyes_*` and `face_mouth_*` shares of the head standing in, with a warning, when they can't be); the patch ring matches; open and wide whites are empty; pupils ≥ `pupil_min_px` and stay inside the white. An eye white is the character's own eye-white colour (its private block, read at run time; light and nearly grey when the block names none) in a patch no bigger than `eye_white_max` of the head; a pupil is whatever else lies inside it, iris included |
| C11 | arm swaps (by family)                                       | the shoulder end matches the rest arm's; the sleeve colour holds; straight poses keep the arm's length; the top row is the own right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C12 | text and marks                                              | none, viewed at 50% and 100% on light and dark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| C13 | identity and style                                          | two reviewers and a skeptic against the sheet and panels; three judges on Amr's face against R16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C14 | assembly and motion                                         | every move's extreme frames compose with no gaps; **the owner's anatomy review**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C15 | size and ground                                             | contact sheets at 96, 160 and 240 px in Comic, Night and high contrast; the owner approves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C16 | pack                                                        | bytes within `budgets`; names are sha256[:8]; 2x is exactly 2× 1x; nodes ≤ `rig_nodes_max` (`rig_nodes_max_complex` for a rig in `budgets.complex`); animated ≤ `rig_animated_max`; one or two tap moves; source shas match the approvals and the approvals ledger; the rig is the one `built` from the approved rig sha                                                                                                                                                                                                                                                                                                               |

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
