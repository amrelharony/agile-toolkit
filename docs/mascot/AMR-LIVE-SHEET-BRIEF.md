# Amr: the live sheet, redrawn in the refined style

**Status:** brief ready, art not made yet (16 November 2026). The package to generate from is `AMR_Live_Sheet_Round_1.zip` on the Desktop.

The refined releases replaced every pack (S01–S114, N01–N10, X001–X124), but not the **live sheet**, `public/mascot/amr.*.webp`. It was never part of them. It is the image every visitor loads first, and Amr shows it most of the time:

- his idle breathing and blink, whenever nothing else is happening;
- the 16 directions he looks in to follow the cursor (and a phone's tilt);
- his everyday reactions: wave, excited and dance (jumping), surprised, confused and head-shake (puzzled), listening, thinking, talking and nodding;
- the stand-in while a pack loads, and every reduced-motion still;
- AmrStill in the tools' empty states, the comics intro and the VIP portrait.

So until it is redrawn, that is the old art still on the site. Its 73 poses are redrawn here as ten sheets in the refined release's own format.

## How they're made

Exactly as the refined release was made: one generation per sheet, with **IMAGE 1** the approved standing master (`AMR_Approved_Standing_Master_RAW.png`), **IMAGE 2** the canonical character (`canonical-base.png`), and the whole of that sheet's prompt (the release's shared master text, the release's "no old actor" paragraph, then the sheet's own part). 1536 × 1024, transparent PNG, eight 384 × 512 slots. The old sprite sheet is never attached. The zip holds the ten full prompts, the two references and a README.

Unlike the S and N sheets, every slot is a real frame (no calibration slot), and the prompts keep hands and jumps low: a live cell has only 25 px above his head at 1×, against 41 in a pack.

## The ten sheets

| Sheet | File                | Fills on the live sheet                                         | Reduced-motion still |
| ----- | ------------------- | --------------------------------------------------------------- | -------------------- |
| L01   | `L01-idle.png`      | idle (row 0), slots 1–6; the jump's last frame (slot 1)         | slot 1               |
| L02   | `L02-run-right.png` | running right (row 1)                                           | slot 2               |
| L03   | `L03-run-left.png`  | running left (row 2), drawn apart, never mirrored               | slot 2               |
| L04   | `L04-wave-jump.png` | waving (row 3), slots 1–4; jumping (row 4), slots 5–8           | slots 2 and 7        |
| L05   | `L05-puzzled.png`   | confused and head-shake (row 5)                                 | slot 4               |
| L06   | `L06-listening.png` | listening (row 6), slots 1–6                                    | slot 4               |
| L07   | `L07-thinking.png`  | thinking (row 7), slots 1–6                                     | slot 3               |
| L08   | `L08-talking.png`   | talking and nodding (row 8), slots 1–6; the thumbs-up is slot 5 | slot 5               |
| L09   | `L09-look-a.png`    | looks 0–7 (row 9): straight up, then clockwise to down-right    | —                    |
| L10   | `L10-look-b.png`    | looks 8–15 (row 10): straight down, then clockwise to up-left   | —                    |

Every slot's beat is in [`live-sheets.json`](live-sheets.json), which is also the build's map. The spare slots (L01 7–8, L06–L08 7–8) are drawn but not used yet.

## When they come back

```bash
python -I scripts/build-mascot-live.py <folder with the ten PNGs> --record --preview <scratch folder>
python -I scripts/build-mascot-live.py --check <folder with the ten PNGs>
```

`--record` takes the set in (each sheet's sha256 goes into the spec); after that only those files build. The build places each sheet as drawn, at the release's scale, on his own feet line, cuts each frame to the live cell, reports anything that reaches past a cell, writes `amr.<hash>.webp`, deletes the old sheet and points `MASCOT_SPRITE_URL` at the new one. `live-old-new.png` in the preview folder shows each row of the old sheet above the new one, for the review before it ships. As with the refined release, every frame is then checked by eye on light and dark grounds, and anything that needs another pass comes back as a short fix list.
