# Amr: hair edits for the ten sheets

The first art round came back with the wrong hair. On the live site (`public/mascot/amr.*.webp`, the 88 frames that still play beside the new ones) Amr has **short, smooth, close-cropped hair**. The generated sheets give him a **fuller, curly mop**, and it changes from slot to slot. The brief caused it: it described "a tight curly texture" and pointed at `ref-2-detail.png`, whose hair is curly. The brief is now fixed.

This page is for **OpenAI image generation** again, but as **edits** of the sheets you already have. Only the hair changes. Everything else is already reviewed and wired into the site.

---

## 1. What to attach

| Image                                              | Why                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The sheet you are editing, e.g. `S04-touch.png`    | The image to edit. Attach it first                                                                  |
| [`reference/ref-hair.png`](reference/ref-hair.png) | His real haircut, taken from the live sprite: from the front, turned both ways, looking up and down |
| Your corrected `S01-faces.png` (for S02 to S10)    | Once S01 passes the checklist, it shows the new hair in the generator's own style                   |

Don't attach `ref-2-detail.png` for these edits. Its hair is the problem.

**Settings:** the same as the brief: 1536 × 1024, transparent background, PNG, high quality. API users: the image edit endpoint with the images above, `size: "1536x1024"`, `background: "transparent"`, `quality: "high"`, `input_fidelity: "high"` if your model accepts it.

**In ChatGPT,** if the image shows a select (brush) tool, paint over his hair in all eight slots before you send the prompt. That keeps the rest of the picture from being redrawn. Without it the whole image is regenerated, which is fine as long as the checklist passes.

**Order:** S01 first. It sets the hair for every other sheet, and its heads are reused on all 24 talking frames. Check it, then do S02 to S10 with the corrected S01 attached, in any order. Doing them all in one conversation helps keep the haircut the same.

---

## 2. The prompt

Paste the shared block, then the line for that sheet from [section 3](#3-the-line-for-each-sheet), in the same message.

```text
Edit the first attached image, an Amr sprite sheet. Change ONLY his hair, in all eight slots, and keep everything else exactly as it is.

THE HAIR. Draw exactly the haircut in the hair reference (ref-hair), which shows his head from the front, turned both ways, looking up and looking down:
- Short, close-cropped, near-black hair that follows the shape of his head. No puffy volume and no rounded dome.
- A dense, fine, smooth texture with a soft sheen. No curls, no coils, no ringlets, no waves, no spiky tufts.
- Only a little height at the front, brushed slightly up and back. A fairly straight front hairline with gently receding temples.
- Short, neatly tapered sides and back. His ears are fully visible, with a little skin showing above them.
- The same length, shape and hairline in all eight slots. Where his head is turned, tilted, raised or lowered, draw the same haircut from that angle, like the matching view in ref-hair.
- If a corrected S01 sheet is attached, his hair must match it exactly.

KEEP UNCHANGED: his face, expression, eyes, eyebrows, ears and skin; the size and position of his head; his body, pose, hands and fingers; his shirt, T-shirt, lanyard, badge, belt, trousers and shoes; the black fitness band on his right wrist and the silver watch on his left; and the size and placement of every figure in its slot. Where a hand touches or covers his head, keep the hand exactly as it is and change only the hair around it.

OUTPUT: the same 1536 x 1024 image with a fully transparent background, 4 columns x 2 rows, one figure per slot, nothing touching a slot edge. No background, floor, shadow, text, labels, grid lines, borders, effects or props. Do not mirror anything.
```

---

## 3. The line for each sheet

```text
S01 — FACES. All eight heads face us, upright and the same size, so all eight get exactly the same haircut as the first view in ref-hair. Only the face changes between slots, never the hair.
```

```text
S02 — EXPLAINING. His head faces us in every slot. In slot 5 his raised index finger is beside his head: keep it.
```

```text
S03 — POINTING. His head turns to look where he points: toward the viewer's left in slots 2 and 3, straight up in slot 4, toward the viewer's right in slots 5 and 6, and down in slots 7 and 8. Use the matching views in ref-hair. In slot 4 his raised hand is near his hair: keep it.
```

```text
S04 — TOUCH. In slot 3 a hand covers his mouth. Slots 4 to 7 tilt his head. In slot 8 his hand rubs the back of his head: keep that hand exactly as it is and show the short hair around it.
```

```text
S05 — PICKED UP. In slots 2 to 5 he hangs by his collar with his shoulders raised. In slot 5 his hands wave beside his head: keep them. In slot 8 he looks down at himself, so more of the top of his head shows, as in the looking-down views of ref-hair.
```

```text
S06 — BALANCE AND DIZZY. In slots 2 to 4 his whole body tips, so his head tips with it. In slots 6 and 7 one hand rests on his forehead: keep it and change only the hair around it. In slot 8 his head is turned a little.
```

```text
S07 — REST. In slot 2 a hand covers his mouth. In slot 3 his raised hands are just above his hair: keep them. In slots 6 and 7 his head droops forward, so the top of his head shows, as in the looking-down views of ref-hair. In slot 8 his head is raised.
```

```text
S08 — PAGE MOMENTS. In slots 2 and 3 he leans into the wind with a forearm raised to shield his eyes: keep the arm. His hair is too short for the wind to lift, so it stays neat. In slot 4 he looks up toward the viewer's left. In slot 8 he looks down at the floor, so the top of his head shows, as in the looking-down views of ref-hair.
```

```text
S09 — SOCIAL. In slots 2 to 4 his hand is raised near his head, in slot 5 his hands cover his eyes, and in slot 6 his hands are beside his face: keep every hand as it is. In slot 8 he bows, so his head is lowered and the top of his haircut shows, as in the looking-down views of ref-hair.
```

```text
S10 — STROLL. Slots 2 to 7 are three-quarter views: slots 2 to 4 turn toward the viewer's right and slots 5 to 7 toward the viewer's left, so use the turned views in ref-hair. Slot 8 is halfway between a turned view and facing us.
```

---

## 4. Check every edit before you keep it

Put the edited sheet next to the one you started from, and next to `ref-hair.png`.

- [ ] All eight slots have the short, smooth haircut of `ref-hair.png`: close to the head, no curls, ears visible.
- [ ] The haircut is the same in every slot, and the same as on the corrected S01.
- [ ] Nothing else moved: the same faces and expressions, poses, hands, clothes, lanyard, band on his right wrist and watch on his left.
- [ ] Transparent background, 4 × 2 slots, one figure per slot, nothing touching a slot edge.

**One or two slots still wrong:** edit again with _"Keep every slot exactly as it is except slot N. In slot N change only his hair, to match the other slots and ref-hair."_ **His face changed:** start again from your original sheet, not from the edit.

---

## 5. Hand back

Send the edited sheets under their usual names (`S01-faces.png` … `S10-stroll.png`), as a zip or a folder path. Any sheet you haven't redone yet can be the original: the build takes the ten together.

Claude will then rebuild the packs (`scripts/build-mascot-packs.py`; its previews include `hair@2x.png`, every head beneath the live sprite's eight angles), check the hair against the live sprite, republish the review page and rerun the tests. The code doesn't change: the new frames line up the same way the old ones did.
