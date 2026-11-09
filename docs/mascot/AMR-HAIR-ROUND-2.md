# Amr: hair, round 2

[The first hair round](AMR-HAIR-EDITS.md) fixed the length and the hairline. The audit on 5 November 2026 measured what's left against the live sprite (`public/mascot/amr.*.webp`):

- **Fuller at the sides.** The hair covers about 26% of his head instead of 22%: it fills his temples and the sides above his ears, where the live haircut is cut very close and his ears stick out past it.
- **A round, near-black helmet.** Live hair is very dark brown with soft lighter highlights on top; the generated hair is flat black (its brightest tenth is L\* 19 against live's 25).
- **Curls left in five sheets**, plus one slot in six more (listed below).

Skin colour and head size no longer need care in the art: the pack builder now matches both to the live sprite for every frame. So this round changes only the hair, and a new generator's colour grade or head size won't matter.

This page is for **ChatGPT image generation** (any version), as **edits** of the sheets you already have.

**Status:** all 12 sheets came back on 5 November 2026 (`AMR_Hair_Round_2_Review_Checkpoint.zip`) and are built. Across them, hair outlines bumpier than 90% of live frames went from 13 to 3. The talking head's hair has highlights again (L\* 22, live 25, before 19), but its sides came out thinner than live's, about 7 px down each side at 2× against 9, so the build now thickens thin side hair (see the [README](README.md)). The figures moved a little inside some slots, which the build's alignment absorbs. The six one-slot sheets kept round 1's hair in their other seven slots: they and the 47 sheets this round didn't touch are in [round 3](AMR-HAIR-ROUND-3.md).

---

## 1. What to attach

| Image                                                      | Why                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The sheet you are editing, e.g. `S05-lifted.png`           | The image to edit, from the last round (the hair-corrected sheets). Attach it first  |
| [`reference/ref-hair-fix.png`](reference/ref-hair-fix.png) | The live haircut (TARGET) above the generated hair as it is now (NOT THIS)           |
| [`reference/ref-hair.png`](reference/ref-hair.png)         | The live haircut from eight angles: front, turned both ways, looking up and down     |
| Your new `S01-faces.png` (for every sheet after S01)       | Once S01 passes the checklist, it shows the new haircut in the generator's own style |

**Settings:** 1536 × 1024, transparent background, PNG, high quality, as before. If the image shows a select (brush) tool, paint over his hair in the slots you are fixing before you send the prompt, so nothing else is redrawn.

**Order:** S01 first. Its heads are reused on all 24 talking frames, so they are on screen whenever he talks. Check it against [section 4](#4-check-every-edit-before-you-keep-it), then do the rest with the new S01 attached, in one conversation if you can.

---

## 2. The prompt

Paste the shared block, then the line for that sheet from [section 3](#3-the-sheets), in the same message.

```text
Edit the first attached image, an Amr sprite sheet. Change ONLY his hair, in the slots named below, and keep everything else exactly as it is.

THE HAIR. Match the TARGET row of ref-hair-fix and the views in ref-hair. It must not look like the NOT THIS row.
- Very short at the sides and back, tapered close to his skull. Above each ear there is only a thin layer of hair, and his ears stick out clearly beyond it.
- Gently receding temples: a little skin shows at each temple, so the front hairline dips in at both corners.
- A little more length on top, brushed slightly up and back at the front. A gently flattened top: not a round dome, not a helmet.
- Very dark brown, not flat black, with soft lighter-brown highlights on top where the light falls.
- A fine, smooth texture. No curls, coils, ringlets, waves, frizz or bumpy outline.
- The same haircut in every slot. Where his head turns, tilts, rises or lowers, draw that same haircut from that angle, like the matching view in ref-hair.
- If a new S01 sheet is attached, his hair must match it exactly.

KEEP UNCHANGED: his face, expression, eyes, eyebrows, ears and skin colour; the size and position of his head; his body, pose, hands and fingers; every prop; his shirt, T-shirt, lanyard, badge, belt, trousers and shoes; the black fitness band on his right wrist and the silver watch on his left; and the size and placement of every figure in its slot. Where a hand or a prop touches his head, keep it exactly as it is and change only the hair around it. Slots not named below stay exactly as they are.

OUTPUT: the same 1536 x 1024 image with a fully transparent background, 4 columns x 2 rows, one figure per slot, nothing touching a slot edge. No background, floor, shadow, text, labels, grid lines, borders or effects. Do not mirror anything.
```

---

## 3. The sheets

Slots are numbered 1 to 4 along the top row and 5 to 8 along the bottom. Slot 1 is always his standing pose.

### Must do

```text
S01 — FACES. All eight slots. All eight heads face us, upright and the same size, so all eight get exactly the TARGET front haircut. Only the face changes between slots, never the hair.
```

```text
S05 — PICKED UP. All eight slots; slots 2, 4, 6 and 8 still have curly hair. In slots 2 to 5 he hangs by his collar with his shoulders raised, so his head sits low between them. In slot 5 his hands wave beside his head: keep them. In slot 8 he looks down at himself, so more of the top of his head shows, as in the looking-down views of ref-hair.
```

```text
S23 — KHAMASEEN DUST. All eight slots; slots 4 and 6 still have curly hair. In slot 4 he pulls his white T-shirt up over his nose. In slot 6 he coughs into his fist with his eyes closed. In slot 8 he ruffles his hair with both hands: keep the hands, and the hair stays short and the same shape.
```

```text
S25 — BREAKFAST. All eight slots; slots 2 and 5 still have curly hair. In slot 2 he holds the sandwich up in both hands. In slot 5 his cheeks are full and he gives a thumbs-up. Keep the sandwich exactly as it is.
```

```text
S33 — KONAFA AND QATAYEF. All eight slots; slots 2 and 7 still have curly hair. In slot 2 he sniffs the konafa tray with his eyes closed, his head bent over it. In slot 7 he reaches toward the tray for one more piece. Keep the tray and the pastry exactly as they are.
```

```text
S47 — GREEN DAY. All eight slots; slots 2 and 8 still have curly hair. In slot 2 he holds the seedling pot and tips the watering can over it. In slot 8 he gives a thumbs-up with the watering can in his other hand.
```

### One slot each (worth doing in the same conversation)

For these, use this line in place of a sheet line, with the sheet and slot filled in:

```text
<SHEET>. Only slot <N>: change only his hair there, to the TARGET haircut, and keep every other slot exactly as it is.
```

| Sheet | Slot | The pose                                                  |
| ----- | ---- | --------------------------------------------------------- |
| S12   | 6    | Wilting in the heat, head tilted, eyes half closed        |
| S14   | 6    | Hands in his pockets, shoulders hunched, chin tucked down |
| S30   | 5    | Holding the lantern out to us with both hands             |
| S36   | 7    | Offering the plate of fatta to us                         |
| S44   | 8    | Both hands on his cheeks, eyes wide: keep the hands       |
| S55   | 5    | The chosen card held face down against his chest          |

### Later, if the new S01 looks clearly better

Every other sheet has the fuller sides and the flat black too, but no curls. Once you have a new S01 you like, the same prompt with _"All eight slots."_ as the sheet line works for any of them, S02 to S64.

---

## 4. Check every edit before you keep it

Put the edited sheet next to the one you started from, and next to `ref-hair-fix.png`.

- [ ] The hair matches the TARGET row: short and close at the sides, ears sticking out past it, a little skin at the temples, a flattened top.
- [ ] Very dark brown with soft highlights, not flat black. No curls anywhere.
- [ ] The same haircut in every slot, and the same as on the new S01.
- [ ] Nothing else moved: the same faces and expressions, poses, hands, props, clothes, lanyard, band on his right wrist and watch on his left.
- [ ] Transparent background, 4 × 2 slots, one figure per slot, nothing touching a slot edge.

A small shift in skin colour or head size is fine: the build corrects both. **One or two slots still wrong:** edit again with _"Keep every slot exactly as it is except slot N. In slot N change only his hair, to match the other slots and the TARGET row."_ **His face changed:** start again from your original sheet, not from the edit.

---

## 5. Hand back

Send the edited sheets under their usual names (`S01-faces.png`, `S05-lifted.png`, `S23-dust.png` …), as a zip or a folder path. Only the sheets you redid are needed; the rest come from the last round.

Claude will then rebuild the packs (`scripts/build-mascot-packs.py`, which also matches skin and head size), measure the hair against the live sprite again (`scripts/audit-mascot-heads.py`; the hair check in the previews puts every head beneath the live sprite's eight angles), republish the review page and rerun the tests. The code doesn't change.
