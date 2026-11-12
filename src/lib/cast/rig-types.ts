/**
 * The shape of one cast puppet's rig, as scripts/build-cast-rigs.py writes it
 * into rigs.generated.ts (docs/cast/CAST-BUILD.md). Import-free, so Node's type
 * stripping can load it beside clips.ts.
 *
 * Geometry is in percent, so a figure scales with its CSS height:
 * - a part's `box` is inside its parent's box, a slot's inside the part it rides
 *   on, a choice's inside its slot;
 * - a pivot is inside the element's own box, and becomes its transform-origin;
 * - a sprite's background size and position are in the element's own box.
 *
 * Sides (`-r`, `-l`) are the character's own. Code only turns joints a little
 * (`range`); every big gesture is a drawn whole-arm choice in a swap slot.
 */

export type Family =
  | "human"
  | "biped"
  | "shelled"
  | "bird"
  | "quadruped"
  | "object"
  | "floating"
  | "octopus"
  | "spider"
  | "insect";

/** Percent of the box it is measured in, at most 2 decimals. */
export type Pct = number;

/**
 * What a clip moves. The root part is "body"; "cord" is the ID card's cord.
 * Tentacles and spider legs are numbered limbs.
 */
export type SocketId =
  | "body"
  | "head"
  | "arm-r"
  | "arm-l"
  | "leg-r"
  | "leg-l"
  | "tail"
  | "ear-r"
  | "ear-l"
  | "tie"
  | "cord"
  | "fan"
  | "flap"
  | "quills"
  | "load"
  | "collar"
  | "neck"
  | `limb-${number}`;

export type EyeState = "open" | "closed" | "happy" | "wide" | "curious" | "glance-l" | "glance-r";
export type MouthState = "rest" | "smile" | "open" | "o" | "talk";
export type ArmPose = "rest" | "wave" | "up" | "open" | "point" | "chin" | "sig";
export type SwapSlotId = "eyes" | "mouth" | "arm-r" | "arm-l" | "fan";
/** A slot and one of its choices: "eyes.closed", "arm-r.wave". */
export type SwapKey = `${SwapSlotId}.${string}`;

export type Box = readonly [x: Pct, y: Pct, w: Pct, h: Pct];

/** background-size and background-position, in % of the element's own box. */
export interface Sprite {
  readonly bg: readonly [sizeX: Pct, sizeY: Pct, posX: Pct, posY: Pct];
}

export interface RigPart {
  /** "torso", "head", "tail", "tentacle-3", "pupil-r". */
  readonly id: string;
  /** Exactly one part has none: the root, whose socket is "body". */
  readonly parent: string | null;
  /** The rest box inside the parent's box (the root's: inside the figure). */
  readonly box: Box;
  /** transform-origin, in the part's own box. */
  readonly pivot: readonly [x: Pct, y: Pct];
  /** Order among the parent's children; the parent's own art is 0. */
  readonly z: number;
  /** null: a bone that only carries children. */
  readonly sprite: Sprite | null;
  /** The most it turns, in degrees either way (head 10, tail 15, cord 6...). */
  readonly range: number;
  readonly socket?: SocketId;
  /** A drawn extra: rendered with data-look, so high contrast hides it. */
  readonly decor?: true;
}

export interface SwapChoice {
  /** "closed", "smile", "wave"... */
  readonly id: string;
  /** Inside the slot's box; arm poses share the slot's shoulder pivot. */
  readonly box: Box;
  /** null: the part's own art shows through (eyes.open, mouth.rest). */
  readonly sprite: Sprite | null;
  /**
   * Order among the host part's children while this choice shows, when it
   * differs from the slot's: a hand at the chin draws over the head.
   */
  readonly z?: number;
}

/**
 * A place where one of several drawings shows at a time. Arms and the fan
 * are slots, not parts: the rest choice carries the drawing, and no part
 * repeats it.
 */
export interface SwapSlot {
  readonly id: SwapSlotId;
  /** The part it rides on: eyes and mouth on the head, arms and the fan on the torso. */
  readonly on: string;
  readonly box: Box;
  /** The shoulder, for an arm (it turns there, up to 15 degrees). */
  readonly pivot: readonly [x: Pct, y: Pct];
  /** Order among the host part's children (default 0). */
  readonly z?: number;
  /** The choice shown at rest. */
  readonly rest: string;
  readonly choices: readonly SwapChoice[];
}

/**
 * The pupils are parts of the part the eyes slot rides on, drawn only inside
 * the eye choices that show them (empty whites), so they never float over a
 * closed or happy eye.
 */
export interface Pupils {
  /** Part ids, the character's own right first. */
  readonly ids: readonly [right: string, left: string];
  /** How far each may travel either way, in % of its own box, staying in its white. */
  readonly travel: readonly [x: Pct, y: Pct];
  readonly shownWith: readonly ("open" | "wide")[];
}

export interface RigManifest {
  readonly v: 1;
  /** "AAW-04". */
  readonly id: `AAW-${string}`;
  /** The name in the cast list (src/lib/vip/cast.generated.ts). */
  readonly name: string;
  readonly family: Family;
  /** Rest width over height. */
  readonly ratio: number;
  /** Height beside Amr's, for figures shown together. */
  readonly heightVsAmr: number;
  /** Where the soles stand, in % of the figure's height. */
  readonly floor: Pct;
  /** Root-absolute, content-hashed URLs under /cast, and their sizes in bytes. */
  readonly atlas: {
    readonly x1: string;
    readonly x2: string;
    readonly bytes1: number;
    readonly bytes2: number;
  };
  /** Parents before their children. */
  readonly parts: readonly RigPart[];
  readonly swaps: readonly SwapSlot[];
  readonly pupils: Pupils | null;
  /**
   * One or two `sig.*` clip ids (src/lib/cast/clips.ts), played on a tap. None
   * for Amr (AAW-01), whose tap move plays only in the intros; CastFigure then
   * leaves out data-sig and a tap does nothing.
   */
  readonly signature: readonly string[];
  /** Shown at this opacity (a ghost). */
  readonly translucent?: number;
  /**
   * nodes: every element CastFigure renders for this rig, ground shadow
   * included (at most budgets.rig_nodes_max in docs/cast/cast-rig.json, or
   * rig_nodes_max_complex for a rig in budgets.complex). animated: the most
   * elements life moves at once (at most 10): the look's (the head, body and
   * pupil elements) or one clip's, its first and armless layers included.
   * The look waits while a clip plays, so the two never add.
   */
  readonly counts: { readonly nodes: number; readonly animated: number };
}
