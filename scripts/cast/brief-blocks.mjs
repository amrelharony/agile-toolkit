/**
 * The generic words of the cast puppet brief: how ChatGPT answers, the master
 * block, one block per image, the arm wording per body family, the owner's master
 * check and the fix templates. No character canon lives here: each character's own
 * block comes from the private sources folder (see docs/cast/CAST-BUILD.md).
 *
 * Every number the image model reads comes from `tol` (docs/cast/cast-rig.json →
 * tolerances), the same numbers the builder's checks use.
 */

/** "AAW-04" + "parts" → "AAW-04_parts.png" */
export const fileName = (id, image) => `${id}_${image}.png`;

/** The order ChatGPT draws in, and what each image is called in words. */
export const IMAGE_WORDS = {
  master: "image 1, the master",
  parts: "image 2, the parts",
  parts2: "image 2B, more parts",
  face: "image 3, the face",
  face2: "image 3B, more faces",
  arms: "image 4, the arms",
};

export function howToAnswer(id, images, tol) {
  const steps = images
    .slice(1)
    .map((img) => IMAGE_WORDS[img])
    .join("; ");
  return [
    "FOR CHATGPT: HOW TO ANSWER",
    `This file is the brief for the puppet art of one colleague from the comic “Agile at Work”. In this chat you draw only this character.`,
    "1. For every image, follow the Master block, then that image's block, then the character's block. Where they differ, the character's block wins, then the image block.",
    `2. Make exactly one image per step: ${tol.canvas_w} x ${tol.canvas_h} pixels, landscape, PNG.`,
    `3. Order: image 1, the master; then stop until the person says “next”. Then, one at a time, each after the person says “next”: ${steps}.`,
    `4. From image 2 on, copy the approved master exactly. It is your image 1 in this chat; in a new chat the person attaches it as ${fileName(id, "master")}.`,
    "5. Draw nothing from this file as text: no names, codes, file names, list numbers or labels.",
    "6. Show your first attempt with its file name and say nothing else. Make it again on your own only if the background is not transparent or one flat colour, or if text appeared.",
    "7. Ask nothing back. If the person pastes a fix, follow it exactly and change nothing else.",
    `8. When the character is finished, give the person one zip named ${id}.zip with exactly its images under their file names. If you cannot make a zip, give each image as its own download under its file name.`,
  ].join("\n");
}

export function masterBlock(tol) {
  return `AGILE AT WORK: CAST PUPPET ART
You are drawing art for a website that brings the colleagues of the comic “Agile at Work” to life as cut-out puppets. The website pins separately drawn pieces together and moves them only a little: a body breathes, a head turns a little, a tail or an ear sways. Every bigger movement (waving, pointing, arms up) is its own complete drawing of the whole arm, which the website swaps in. Faces change by swapping small drawings of the eyes and the mouth. Every image you make shows ONE character: whole, taken apart into pieces, as a set of heads, or as a set of arms. The same drawings are used for years, so they must match the references exactly. Do not redesign the character.

WHAT EACH REFERENCE IS FOR
- The WEEKLY STORY PANELS (the files ending in “_ref-story-1” and “_ref-story-2”, or “_ref-style”) decide how the character LOOKS today: its proportions, its clothes, its colours, its ink line and its shading, exactly as the weekly stories draw it. They are cropped to this character, and the flat grey shapes in them cover other characters and lettering. Ignore those grey shapes, the rooms, the furniture and the pose.
- The MODEL SHEET (the file ending in “_ref-sheet”) shows the character from every side: use it for its species and body shape, its face and markings, the number of fingers, arms, legs or tentacles, and anything the panels do not show. Where the sheet and the panels differ, the panels win. Copy the design from the sheet, never the way it is drawn: ignore its paper colour, sketchy lines, watercolour texture, any grey shapes and any small scenes.
- The APPROVED MASTER (from the second image on) is the first image you made for this character, already approved. Every later image copies it exactly: the same character, proportions, colours and line.
- The words in the character's block win over every picture: colours, counts, sides and clothes.
- Never use a photograph, a saved picture or anything you remember about this character or about a real person from other chats.

THE LOOK
- A polished, hand-inked editorial workplace cartoon, exactly like the weekly story panels: clean, confident dark brown-black ink outlines of even weight, a little heavier on the outer edge of the figure; flat, warm, fairly saturated colours; one soft cel-shade tone per colour on the side away from the light, with the light from the upper left; small white highlights in the eyes, on noses and on glasses.
- No paper texture, no watercolour, no pencil or sketch lines, no cross-hatching unless the design itself has a pattern, no gradients, no glow, no airbrush, no glossy 3D render, no realistic fur strands.
- Friendly adult professionals, never babyish. Coherent anatomy: limbs bend only where this character's body really bends (a person's or an animal's arm bends only at the elbow and the wrist), hands are complete with the right number of fingers, and there are exactly the right number of arms, legs, wings or tentacles.

EVERY IMAGE
- ${tol.canvas_w} x ${tol.canvas_h} pixels, landscape, PNG, high quality. One image per request.
- Background: fully transparent if you can make real transparency. If you cannot, fill everything outside the drawing with ONE flat, solid colour, the BACKGROUND COLOUR in the character's block, edge to edge: no gradient, texture, shadow or checkerboard. Never white, never cream, never paper.
- Only this one character. No people, no other characters, no background, floor, furniture or ground shadow, and nothing in the hands unless the character's block names it for that image.
- No text anywhere: no letters, numbers, names, labels, captions, arrows, grid lines, frames, borders or dividing lines. The ID card is always BLANK: a plain white card with a thin border, no picture and no name.
- No motion lines, speech balloons, sweat drops, sparkles, steam, hearts or other effects.
- Never mirror or flip anything. Left and right are always drawn for real. “His right”, “her right” or “its right” means the character's own right, which is on YOUR LEFT when the character faces you.
- Keep at least ${tol.margin_ask_px} pixels of background between the drawing and every edge, and at least ${tol.gap_ask_px} pixels between separate pieces, heads or arms.

WHAT THE WEBSITE FIXES BY ITSELF (never redo an image for these)
- The exact size and position of the drawing, and where each piece, head or arm lands.
- Pieces drawn between ${pct(tol.scale_min)} and ${pct(tol.scale_max)} of their size in the master, all at one size.
- A piece tilted by up to ${tol.tilt_deg} degrees.
- Colours a little off from the master: the website matches them.
- Soft edges, and specks smaller than ${tol.speck_px} pixels.

HOW TO WORK
- Show your first attempt. Make it again on your own only if the background is not transparent or one flat colour, or if any text appeared. Otherwise show it, with its file name, and wait.`;
}

const pct = (x) => `${Math.round(x * 100)}%`;

export function imageMaster(id, tol) {
  return `IMAGE 1: THE MASTER
The whole character at rest, from the front, facing you, like the “Front” view on the model sheet (unless the character's block gives another view).
- Standing straight and relaxed, weight on both feet, feet a little apart and flat on an invisible floor (a floating character floats level instead).
- Arms hanging loosely a little away from the body, with background showing between each arm and the body all the way down. Hands open and relaxed, palms toward the body, nothing in them.
- Head upright, facing you, eyes open and looking straight at you, with the DEFAULT FACE from the character's block.
- Tail, ears, fan, tentacles or extra legs exactly as the character's block says; where the block says how much of one shows, follow it, otherwise show it fully, not hidden behind the body.
- All the clothes, the tie, the lanyard and the blank ID card as the block lists them; the card hangs straight down at the middle of the chest.
- Size: from the highest point (head, ears, horns, crest) to the lowest point about ${tol.master_height_px} pixels tall, centred, the lowest point about ${tol.sole_px} pixels above the bottom edge. A wide character (a big fan, tentacles, eight legs, four legs) instead fits as large as it can inside the ${tol.margin_ask_px}-pixel margin.
- Draw every detail clearly and completely: every later image copies this one.
File name: ${fileName(id, "master")}`;
}

export function imageParts(id, tol) {
  return `IMAGE 2: THE PARTS
Take the approved master apart into separate pieces, like a paper puppet before it is pinned together.
- Exactly the pieces in the character's PARTS list: no more, no fewer, and no other drawing. The numbers in the list are only for counting; draw no numbers.
- The same character, colours, line and shading as the master, all pieces at one size, as large as the image allows.
- Lay the pieces out roughly where they belong on the body, pulled apart: the head at the top in the middle, with any ears beside it and the pupils just below it; the body in the middle, with the tie and the lanyard just to your right of it; the character's right arm on your left of the body and its left arm on your right; the legs below the body, the right leg on your left; a tail and anything else at the sides wherever there is room.
- At least ${tol.gap_ask_px} pixels of clear background all round every piece. No piece touches, overlaps or is joined to another.
- Each piece is complete on its own. Draw in everything the master hid: the clothes under the arms, the neck under the chin, the top of each arm and leg, the body behind the tie and the lanyard.
- Joints: where two pieces meet, the piece the list says tucks UNDER ends in a smooth round cap, a half circle as wide as the piece, reaching past the joint into where the piece on top sits, so no gap opens when the puppet moves a little. A piece that sits ON TOP keeps its own neat rounded end. A cap is part of its piece: the same colour and line, with no extra line across it.
- Every piece in its rest shape and upright, unless the list says otherwise: each arm one piece from the shoulder to the fingertips, hanging straight down, the hand relaxed and open; each leg one piece from the hip to the sole; a tail in its rest curve.
- Eyes that have pupils are drawn as empty white eyes with their outlines; the pupils are separate pieces, each at least ${tol.pupil_min_px} pixels across.
File name: ${fileName(id, "parts")}`;
}

export function imageParts2(id, tol) {
  return `IMAGE 2B: MORE PARTS
The rest of the approved master's pieces, listed under MORE PARTS in the character's block. Draw them exactly like the parts image: the same size as the pieces in your parts image, each piece separate, complete and upright in its rest shape, a round cap where the list says, at least ${tol.gap_ask_px} pixels of clear background all round every piece, no numbers, nothing else. Lay them out in tidy rows from left to right in the order of the list.
File name: ${fileName(id, "parts2")}`;
}

export function imageFace(id, tol) {
  return `IMAGE 3: THE FACE
The character's FACE PIECE (see its block) eight times, in two rows of four, copied from the approved master.
- All eight the same size (about ${tol.face_head_px} pixels tall, or less for a head wider than it is tall, so that four fit across a row), the same angle and upright, each in the middle of its own quarter of its row, with at least ${tol.margin_ask_px} pixels of background between them and from the edges. No grid lines.
- Top row, from your left, where only the eyes, eyelids and eyebrows change and the mouth stays exactly as in the master: 1 eyes open, exactly as in the master; 2 eyes shut in a blink, a short curved line each; 3 happy, eyes shut as upward curved arcs; 4 surprised in a friendly way, eyes wide and round, brows raised high.
- Bottom row, from your left, where only the mouth changes (for a bird, the beak) and the eyes stay open exactly as in the master: 5 the master's own mouth; 6 a big, warm smile; 7 open wide in a cheerful “ah”; 8 a small round “o” of friendly surprise.
- Everything else stays exactly as in the master: outline, ears, hair, fur, feathers, markings, glasses and nose. Teeth and tongue only as this character has them on the model sheet.
- Never a sad, angry, sneering or mocking face.
- Heads only, cut off cleanly just below the chin or beak, with no shoulders, clothes or lanyard. A character whose FACE PIECE (in its block) is its whole body keeps its body, without arms or legs.
File name: ${fileName(id, "face")}`;
}

/** Amr only: the two extra heads his intro moves use. */
export function imageFace2(id, tol) {
  return `IMAGE 3B: MORE FACES
His head two times in one row across the middle of the image, the same size and angle as in your face image, copied from the approved master, with at least ${tol.margin_ask_px} pixels between the heads and from the edges. Only the named part changes; everything else stays exactly as in the master.
1 curious, asking a question: both brows raised, his left brow (on your right) a little higher, eyes open and friendly, mouth as in the master. 2 his mouth slightly open in the middle of a word, his eyes as in the master.
File name: ${fileName(id, "face2")}`;
}

/**
 * What one arm is, per body family. The arms image is never asked of a character
 * without arms (the camel).
 */
export const ARM_WORDS = {
  human:
    "A real arm: one upper arm, one forearm and one hand, bending only at the elbow and the wrist, never stretched, rubbery or twisted; the sleeve is continuous and the hand is attached at the wrist with the right number of fingers.",
  wing: "A real wing-arm, as this bird's arms are drawn on its model sheet: the feathered wing bends only where a wing bends, its tip feathers spread like fingers to wave, point or hold; never a human arm, never stretched or rubbery.",
  feathered:
    "A real wing-arm with its own hand, as on the model sheet: one upper arm and one forearm, bending only at the elbow and the wrist, ending in a feathered hand with the right number of feather-fingers that waves, points and holds; the wing never opens into a spread fan in place of the hand; never stretched, rubbery or twisted.",
  tube: "A real tube arm, as on the model sheet: one thin black tube that curves smoothly from the body to a white cartoon glove with the right number of fingers; it curves, it never has a sharp kink or a second elbow.",
  mitten:
    "A real mitten arm, as on the model sheet: one soft rounded arm ending in a mitten-like hand with no separate fingers; it curves smoothly, never stretched or twisted.",
  tentacle:
    "A real tentacle used as an arm: one smooth curving tentacle with its suckers on the inner side, tapering to the tip, with no joints at all; the tip curls to wave or point, and holds something only in the signature arm when the character's block says so.",
  glove:
    "A real soft arm, as on the model sheet: one smooth arm that bends only at the elbow and the wrist and ends in a white cartoon glove with the right number of fingers; never stretched, rubbery or twisted.",
  soft: "A real soft arm, as on the model sheet: one smooth arm that bends only where an elbow and a wrist would be and ends in its own hand with the right number of fingers; never stretched, rubbery or twisted.",
  spider:
    "A real spider leg used as an arm: thin and jointed in at most two segments, ending in a small tip; it bends only at its one joint, never stretched or rubbery.",
};

export function imageArms(id, tol, armFamily) {
  return `IMAGE 4: THE ARMS
Eight whole arms in two rows of four, each a separate drawing, copied from the approved master's arms: the same sleeve, colours, hand, number of fingers, fur or feathers, watch or band, and the same size as the arms in your parts image.
- Top row: the character's own RIGHT arm (the one on your left in the master), four times. Bottom row: its own LEFT arm (on your right in the master), four times, drawn for real, never a flipped copy.
- Each arm is one piece from the shoulder to the tip, drawn upright the way it would look on the character standing in front of you: up is up. Every arm begins with exactly the same round shoulder end as the arm in your parts image, the same width, so the website can pin it at the shoulder.
- ${ARM_WORDS[armFamily] ?? ARM_WORDS.human}
- Top row, from your left: 1 waving: the upper arm out to the side, the forearm up, the open palm toward you; 2 straight up above the head, the hand open, palm toward you; 3 the forearm forward at waist height, the palm up and open, offering; 4 pointing out to the side toward your left.
- Bottom row, from your left: 5 straight up above the head, the hand open, palm toward you; 6 the forearm forward at waist height, the palm up and open; 7 the hand lightly at the chin, thinking, the elbow down; 8 the SIGNATURE ARM in the character's block.
- A limb that has no hand, palm or elbow makes the same gesture its own way: the same direction and height, the tip doing what the hand would.
- Each arm in the middle of its own quarter of its row, at least ${tol.margin_ask_px} pixels from the others and from the edges. No body, no head, no grid lines, nothing else.
File name: ${fileName(id, "arms")}`;
}

/** Amr's arms image: four arms in one row. */
export function imageArmsAmr(id, tol) {
  return `IMAGE 4: THE ARMS
His four whole arms in one row, each a separate drawing, copied from the approved master's arms: the same sleeve, buttoned cuff, skin, hand and five fingers, and the same size as the arms in your parts image; his watch on his left wrist and his band on his right wrist exactly as in the master.
- Each arm is one piece from the shoulder to the fingertips, drawn upright the way it would look on him standing in front of you: up is up. Every arm begins with exactly the same round shoulder end as the arm in your parts image, the same width, so the website can pin it at the shoulder.
- ${ARM_WORDS.human}
- From your left: 1 his right arm waving: the upper arm out to the side, the forearm up, the open palm toward you; 2 his right arm straight up above his head, the hand open, palm toward you; 3 his right arm with the forearm forward at waist height, the palm up and open, offering; 4 his left arm straight up above his head, the hand open, palm toward you, drawn for real, never a flipped copy.
- Each arm in the middle of its own quarter of the row, at least ${tol.margin_ask_px} pixels from the others and from the edges. No body, no head, no grid lines, nothing else.
File name: ${fileName(id, "arms")}`;
}

/** The person's five-line check of a returned master (nine for Amr). */
export function masterCheck({ card = true, arms = true } = {}) {
  return [
    "It is this character and drawn like the weekly panels.",
    arms
      ? "It is the rest pose the block describes, arms a little away from the body, hands open and empty."
      : "It is the rest pose the block describes, legs and tail fully visible, nothing held.",
    "Colours, clothes, counts and sides match the block.",
    card ? "There is no text or marks, and the ID card is blank." : "There is no text or marks.",
    "The background is transparent or flat, with nothing near the edges.",
  ];
}
export const MASTER_CHECK = masterCheck();
export const AMR_CHECK = [
  "He is clean-shaven and looks his age.",
  "His sleeves are full length and buttoned at the cuff.",
  "His watch is on his left wrist (your right) and his band on his right wrist (your left).",
  "His face matches the FRONT head on his model sheet and the two panels.",
];

/** Fix lines the person pastes, per image. */
export function fixLines(id, name, keyName, keyHex, { card = true, images = [] } = {}) {
  const who = `${id} ${name}`;
  const lines = {
    piece: `Fix for ${who}, image 2 (parts). Edit the attached ${fileName(id, "parts")}. Keep every piece exactly as it is, the same size and in the same place, except {piece}. Redraw only that piece: {problem}. Change nothing else. Give it back as ${fileName(id, "parts")}.`,
    again: `Make image {n} ({image}) for ${who} again. Start from the approved master attached (${fileName(id, "master")}), not from the last attempt, and follow its block from the beginning. The last attempt had these problems: {list}. Give it back as ${id}_{image}.png.`,
    pieces2: `Fix for ${who}, image 2B (more parts). Edit the attached ${fileName(id, "parts2")}. Keep every piece exactly as it is, the same size and in the same place, except {piece}. Redraw only that piece: {problem}. Change nothing else. Give it back as ${fileName(id, "parts2")}.`,
    arm: `Arm {k} looks wrong: {problem}. Redraw only that arm as described in IMAGE 4 for this character, starting with the same round shoulder end as the matching arm in the parts image (or the more-parts image). Keep the other arms exactly as they are. Give it back as ${fileName(id, "arms")}.`,
    face: `The face changed. Make image 3 again from the approved master attached, not from the edit, and keep the face exactly as in the master.`,
    background: `The background is not transparent. Make the same image again with one flat, solid ${keyName} background (${keyHex}) everywhere outside the drawing: no gradient, no shadow, no texture, no checkerboard.`,
    text: card
      ? `Text or marks appeared. Make the same image again with no letters, numbers, labels, lines or marks anywhere, and a blank ID card.`
      : `Text or marks appeared. Make the same image again with no letters, numbers, labels, lines or marks anywhere.`,
  };
  if (!images.includes("parts2")) delete lines.pieces2;
  if (!images.includes("arms")) delete lines.arm;
  return lines;
}

export function kickoff({ id, name, batch, version, refs, images, amr }) {
  const list = refs.map((r) => `${r.file} is ${r.as}`).join("; ");
  const order = images
    .slice(1)
    .map((img) => IMAGE_WORDS[img].replace(/^image (\w+), /, "image $1 "))
    .join(", ");
  const files = images.map((img) => fileName(id, img)).join(", ");
  const lines = [
    `CHAT FOR ${id}, ${name.toUpperCase()} (batch ${batch}, brief v${version})`,
    `Attached are CAST-${id}.md (the brief for this one character) and ${refs.length} pictures: ${list}. Use no other picture.`,
  ];
  if (amr)
    lines.push(
      "Never use a photograph of me or of anyone, and no saved reference, memory or picture of me from other chats. Amr's face comes only from the attached sheet and the two panels."
    );
  lines.push(
    "Read “For ChatGPT: how to answer”, the Master block, the image blocks and the character block. Make image 1, the master, show it to me with its file name, and stop.",
    `When I say “next”, make the next image in this order, one at a time, each from the approved master: ${order}. At the end give me one zip, ${id}.zip, holding exactly ${files}.`
  );
  return lines.join("\n");
}
