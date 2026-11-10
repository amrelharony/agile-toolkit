# Amr: tool sheets, fix round 1

**Status:** all 17 came back on 8 November 2026 (`AMR_Tool_Fix_{A,B}.zip`) and are built. The curls and facets are gone, nothing else moved, and S79's face is S01's again. The edited heads came back a shade lighter or browner than the untouched slots beside them, which the build now evens out (`match_hair` in `scripts/build-mascot-packs.py`).

All 50 [tool sheets](AMR-TOOLS-BRIEF.md) came back on 8 November 2026 (`AMR_Tool_Sheets_{A..E}_Completed.zip`). Every one is the right size, with a transparent background and nothing touching a slot edge. Every pose and prop matches its sheet, and nothing has text on it. Slot 1 is his standard stance in all 50.

Every head was then checked beside S01's at a size where curls show. **33 sheets are good as they are.** The other 17 need one more pass:

- **16 sheets have curly hair in some slots**, almost always where his head turns, tilts or looks down. ChatGPT draws S01's short, smooth cut when he faces us, then adds coils and volume on top at other angles. In S106 and S108 the hair is crumpled into hard facets instead. These are edits: only the hair changes.
- **S79 (Canvas) has a different face in every slot**: rounder, with puffy cheeks and heavy forehead lines, and curly hair in four slots. Editing eight faces would be a redraw anyway, so it's drawn again from its own prompt.

ChatGPT's own checks passed all 50, as they did in the hair rounds. Its review doesn't catch curls, so every sheet that comes back is still checked here first.

Skin colour, head size and thin side hair still don't need care in the art: the build matches all three to the live sprite.

---

## 1. The two zips

Upload one zip per conversation. Each holds this page, the references and its sheets.

| Image                                                          | Why                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `S01-faces.png`                                                | The face and haircut to match. Don't edit it                                    |
| [`reference/ref-hair-fix-3.png`](reference/ref-hair-fix-3.png) | The haircut to match (TARGET) above the curly hair to avoid (NOT THIS)          |
| [`reference/ref-hair.png`](reference/ref-hair.png)             | The haircut from eight angles: front, turned both ways, looking up and down     |
| `ref-1-stance.png`, `ref-current.png`, `ref-3-range.png`       | Zip A only, for redrawing S79: his stance, him as the site shows him, his range |

**Settings:** 1536 × 1024, transparent background, PNG, high quality, as before. If the image shows a select (brush) tool, paint over his hair in the slots you are fixing before you send the prompt, so nothing else is redrawn.

### Zip A: `AMR_Tool_Fix_A.zip`

| Sheet | File               | What                     |
| ----- | ------------------ | ------------------------ |
| S65   | `S65-capacity.png` | hair in slots 2, 4 and 5 |
| S68   | `S68-skeleton.png` | hair in all eight slots  |
| S70   | `S70-pi.png`       | hair in slots 3 and 4    |
| S71   | `S71-roadmap.png`  | hair in all eight slots  |
| S73   | `S73-links.png`    | hair in all eight slots  |
| S74   | `S74-blocker.png`  | hair in slots 3 and 5    |
| S75   | `S75-demo.png`     | hair in slots 5 and 7    |
| S79   | `S79-canvas.png`   | draw the sheet again     |
| S80   | `S80-burndown.png` | hair in all eight slots  |

### Zip B: `AMR_Tool_Fix_B.zip`

| Sheet | File               | What                           |
| ----- | ------------------ | ------------------------------ |
| S92   | `S92-raci.png`     | hair in all eight slots        |
| S97   | `S97-scale.png`    | hair in slots 2, 3, 5 and 6    |
| S100  | `S100-effort.png`  | hair in slots 2, 3, 6 and 7    |
| S101  | `S101-kano.png`    | hair in slots 2, 3, 5 and 6    |
| S105  | `S105-compass.png` | hair in slots 2 and 5          |
| S106  | `S106-okr.png`     | hair in all eight slots        |
| S108  | `S108-lab.png`     | hair in slots 2, 4, 5, 6 and 7 |
| S110  | `S110-tree.png`    | hair in slots 2, 3, 4 and 5    |

---

## 2. The hair edit

For each sheet, attach the sheet first, then `S01-faces.png`, `ref-hair-fix-3.png` and `ref-hair.png`. Paste this block, then the sheet's line from [section 3](#3-the-sheets), in the same message.

```text
Edit the first attached image, an Amr sprite sheet. Change ONLY his hair, in the slots named below, and keep everything else exactly as it is.

THE HAIR. It must match the attached S01-faces.png exactly, and the TARGET row of ref-hair-fix-3. It must not look like the NOT THIS row.
- Short all over and close to the shape of his skull. No round dome, no helmet, no extra volume on top: the top of his hair sits low and close above his head.
- A little more length on top, brushed slightly up and back at the front, with gently receding temples.
- Short and tapered at the sides and back: a thin, even layer of hair down each side to the top of his ears, as on S01. His ears show just past it.
- Very dark brown, not flat black, with soft lighter-brown highlights on top where the light falls.
- A fine, smooth texture with soft shading, as on S01. No curls, coils, ringlets, waves, frizz or bumpy outline, and no hard facets, crumpled planes or sharp-edged clumps.
- The same haircut in every slot. Where his head turns, tilts, rises or lowers, draw that same haircut from that angle, like the matching view in ref-hair. A turned or lowered head still has the short, smooth cut: no extra curls or volume at those angles.

KEEP UNCHANGED: his face, expression, eyes, eyebrows, ears and skin colour; the size and position of his head; his body, pose, hands and fingers; every prop; his shirt, T-shirt, lanyard, badge, belt, trousers and shoes; the black fitness band on his right wrist and the silver watch on his left; and the size and placement of every figure in its slot. Where a hand or a prop touches or overlaps his head, keep it exactly as it is and change only the hair around it. Slots not named below stay exactly as they are.

OUTPUT: the same 1536 x 1024 image with a fully transparent background, 4 columns x 2 rows, one figure per slot, nothing touching a slot edge. No background, floor, shadow, text, labels, grid lines, borders or effects. Do not mirror anything.
```

---

## 3. The sheets

Slots are numbered 1 to 4 along the top row and 5 to 8 along the bottom. Slot 1 is always his standing pose.

### Zip A

```text
S65 — SPRINT CAPACITY. Only slots 2, 4 and 5: holding the calendar, counting the team chips, and placing the blue chip, each looking down. The hair on top is curly there: change only his hair in those three slots, to the S01 haircut, and keep slots 1, 3, 6, 7 and 8 exactly as they are.
```

```text
S68 — WALKING SKELETON. All eight slots, slot 1 too. In slot 7 he holds the toy skeleton high above his head with both hands: keep the skeleton and his hands exactly as they are and change only the hair below them.
```

```text
S70 — PI PLANNING. Only slots 3 and 4: sorting the cards while looking down, and pressing an orange card onto the grid board. The hair on top is curly there: change only his hair in those two slots, to the S01 haircut, and keep every other slot exactly as it is.
```

```text
S71 — EPIC ROADMAP. All eight slots, slot 1 too. Most of them look down at the map, so the top of his head shows: use the looking-down views in ref-hair. In slot 6 he holds the rolled map to one eye like a spyglass: keep it exactly as it is.
```

```text
S73 — DEPENDENCY MAP. All eight slots, slot 1 too. Most of them look down at the cork board, so the top of his head shows: use the looking-down views in ref-hair.
```

```text
S74 — IMPEDIMENTS. Only slots 3 and 5: raising the red flag, and pushing the barrier aside with his head down. The hair is curly there: change only his hair in those two slots, to the S01 haircut, and keep the flag and every other slot exactly as they are.
```

```text
S75 — SPRINT REVIEW. Only slots 5 and 7: reading the yellow card, and the small bow with the laptop. In the bow his head is lowered, so the top of his head shows: use the looking-down views in ref-hair. Change only his hair in those two slots, and keep every other slot exactly as it is.
```

```text
S80 — BURNDOWN. All eight slots, slot 1 too. In slot 5 he scratches his head with the pointer, and in slot 8 he holds the pointer up high: keep the pointer and his hands exactly as they are and change only the hair around them.
```

### Zip B

```text
S92 — RACI. All eight slots, slot 1 too. In slot 4 he holds the red star card beside his face: keep it exactly as it is.
```

```text
S97 — WSJF. Only slots 2, 3, 5 and 6, where he looks down at the scale and the boxes. The hair there is fuller and curly on top: change only his hair in those four slots, to the S01 haircut, close to his skull, and keep every other slot exactly as it is.
```

```text
S100 — VALUE AND EFFORT. Only slots 2, 3, 6 and 7. The hair on top is curly there: change only his hair in those four slots, to the S01 haircut, and keep the star token, the board and every other slot exactly as they are.
```

```text
S101 — KANO MODEL. Only slots 2, 3, 5 and 6. The hair on top is curly there: change only his hair in those four slots, to the S01 haircut, and keep the clipboard, the gift box and every other slot exactly as they are.
```

```text
S105 — CYNEFIN. Only slots 2 and 5: looking down at the compass, and the compass against his chin. Change only his hair in those two slots, to the S01 haircut, and keep the compass and every other slot exactly as they are.
```

```text
S106 — OKRS. All eight slots, slot 1 too. The hair is crumpled into hard, sharp-edged facets: make it S01's smooth, softly shaded short cut. In slot 2 the target is beside his face and in slot 7 he holds it high above his head: keep the target and his hands exactly as they are and change only the hair around them.
```

```text
S108 — HYPOTHESIS TRACKER. Only slots 2, 4, 5, 6 and 7. The hair there is crumpled into hard facets and curls: make it S01's smooth, softly shaded short cut. Where the test tube is held up near his head, keep it exactly as it is. Keep slots 1, 3 and 8 exactly as they are.
```

```text
S110 — OPPORTUNITY TREE. Only slots 2, 3, 4 and 5, where he looks down at the tree. The hair on top is curly there: change only his hair in those four slots, to the S01 haircut, and keep the tree, the watering can and every other slot exactly as they are.
```

---

## 4. Draw S79 again

Start a new conversation for it. Attach `AMR-TOOLS-CHATGPT.md`, `ref-1-stance.png`, `ref-current.png`, `ref-hair-fix-3.png`, `ref-3-range.png` and `S01-faces.png` (the brief and five images, as in the first round), then paste:

```text
Draw sheet S79 (Canvas) from the attached brief, AMR-TOOLS-CHATGPT.md: follow its Master block, Context rules and Tool rules, then the S79 block under Batch B. One image, 1536 x 1024, fully transparent background, PNG.

The last version drew a different face: rounder, with puffy cheeks, heavy forehead lines and a doughy, smudged finish, and curly hair on top in the turned slots. Match S01-faces.png exactly in every slot: his face shape, cheeks, smile lines and eyes, the same smooth, soft shading, and S01's short, smooth haircut close to his skull, with no curls at any angle. Keep the props as the brief describes them: the small whiteboard on its stand with a blue circle, an orange square and a green arrow and no writing, and the black marker.

Check the image against the brief's checklist and redo any slot that fails before you give it to me.
```

---

## 5. Check every edit before you keep it

Put the edited sheet next to the one you started from, next to `S01-faces.png` and next to `ref-hair-fix-3.png`. Zoom in on the turned and lowered heads: that's where the curls come back.

- [ ] The hair matches S01 and the TARGET row: short and close to his skull, no dome on top, a thin even layer down the sides to the top of his ears.
- [ ] Very dark brown with soft highlights, not flat black. No curls and no hard facets, in any slot.
- [ ] The same haircut in every slot you edited, from whatever angle.
- [ ] Nothing else moved: the same faces and expressions, poses, hands, props, clothes, lanyard, band on his right wrist and watch on his left.
- [ ] S79 only: his face is S01's in every slot.
- [ ] Transparent background, 4 × 2 slots, one figure per slot, nothing touching a slot edge.

A small shift in skin colour or head size is fine: the build corrects both. **One or two slots still wrong:** edit again with _"Keep every slot exactly as it is except slot N. In slot N change only his hair, to match S01 and the other slots."_ **His face changed in an edit:** start again from the sheet in the zip, not from the edit.

---

## 6. Hand back

Send each zip's sheets back as one zip, under their usual names (`S65-capacity.png`, `S106-okr.png` …). Only these 17 are needed; the other 33 are kept as they came. The two zips can come back one at a time.

Claude will then check the heads again, build the tool packs (`scripts/build-mascot-packs.py`, which also matches skin and head size and thickens thin side hair), write each sheet's scenes, rerun the tests and republish the review page.
