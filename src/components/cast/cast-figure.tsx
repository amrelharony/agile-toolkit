/**
 * One cast puppet, drawn from its rig (lib/cast/rig-types.ts) at rest.
 *
 * The rig is a prop: a server page picks it (lib/cast/rigs.ts) and passes it
 * down, so this file imports no rig data. No hooks, no "use client" and
 * nothing random or clock-based, so it renders the same on the server and
 * under any client host, and paints from first paint with no script.
 *
 * - **Nesting is the skeleton.** Each part is a span inside its parent's,
 *   with its box in percent and its transform-origin at its pivot, so turning
 *   a part carries everything on it. z-index orders a part among its
 *   siblings; the parent's own art is 0.
 * - **Swaps are all in the markup.** Every eye, mouth, arm and fan choice is
 *   rendered; the one with `data-on` is visible and the rest are hidden
 *   (cast-figure.module.css). Scenes and life flip `data-on`, nothing else.
 *   The pupils sit inside the eye choices that show empty whites.
 * - **One atlas per character,** set on the root as --cast-x1/--cast-x2 and
 *   read by the module's background-image (image-set for 2x where it works),
 *   so a figure paints whole or not at all. With `defer` the art waits for
 *   `data-near`, which <CastLife> sets as the figure comes close.
 *
 * Decorative: aria-hidden, no role and no tab stop. A host keeps `height`
 * at or under CAST_MAX_CSS_PX, and the figure clamps it there too.
 */

import type { CSSProperties, ReactElement, ReactNode } from "react";
import type {
  Box,
  RigManifest,
  RigPart,
  SocketId,
  Sprite,
  SwapChoice,
  SwapKey,
  SwapSlot,
  SwapSlotId,
} from "@/lib/cast/rig-types";
import styles from "./cast-figure.module.css";

/** The tallest a figure is drawn, in CSS px: its 1x atlas is drawn for this height. */
export const CAST_MAX_CSS_PX = 240;

/** What an intro scene may hang a class on. */
export type CastClassKey = SocketId | SwapSlotId | SwapKey | "pupils" | "ground";

export interface CastFigureProps {
  /** From the server page, never imported by a client file. */
  rig: RigManifest;
  /** A CSS length; kept at or under CAST_MAX_CSS_PX. */
  height: string;
  /** Intro scene classes, by socket, slot, "slot.choice", "pupils" or "ground". */
  classes?: Partial<Record<CastClassKey, string>>;
  /** A flat shadow at the figure's feet (data-look: high contrast hides it). */
  ground?: boolean;
  /** The art waits until the figure is near the screen (grids, below the fold). */
  defer?: boolean;
  /** Answers a tap with its signature move (the host renders <CastLife>). */
  tap?: boolean;
  className?: string;
}

type Pivot = readonly [x: number, y: number];

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

function place(box: Box, pivot?: Pivot, z?: number): CSSProperties {
  const style: CSSProperties = {
    left: pct(box[0]),
    top: pct(box[1]),
    width: pct(box[2]),
    height: pct(box[3]),
  };
  if (pivot) style.transformOrigin = `${pct(pivot[0])} ${pct(pivot[1])}`;
  if (z !== undefined) style.zIndex = z;
  return style;
}

function paint(sprite: Sprite | null): CSSProperties {
  if (!sprite) return {};
  const [sx, sy, px, py] = sprite.bg;
  return { backgroundSize: `${pct(sx)} ${pct(sy)}`, backgroundPosition: `${pct(px)} ${pct(py)}` };
}

const flag = (on: boolean | undefined) => (on ? "" : undefined);

/** A box inside `outer`, both in the same parent: re-measured inside `outer`. */
function within(box: Box, outer: Box): Box {
  const [ox, oy, ow, oh] = outer;
  return [
    ((box[0] - ox) / ow) * 100,
    ((box[1] - oy) / oh) * 100,
    (box[2] / ow) * 100,
    (box[3] / oh) * 100,
  ];
}

/** A choice's box in its slot, measured in the part the slot rides on. */
function onHost(choice: Box, slot: Box): Box {
  return [
    slot[0] + (choice[0] * slot[2]) / 100,
    slot[1] + (choice[1] * slot[3]) / 100,
    (choice[2] * slot[2]) / 100,
    (choice[3] * slot[3]) / 100,
  ];
}

/**
 * A slot's choices, grouped by their order among the host's children: most
 * slots are one group, and a choice drawn over a sibling (a hand at the chin)
 * gets a wrapper of its own with the same box and pivot.
 */
function groups(slot: SwapSlot): { z: number; choices: SwapChoice[] }[] {
  const out: { z: number; choices: SwapChoice[] }[] = [];
  for (const choice of slot.choices) {
    const z = choice.z ?? slot.z ?? 0;
    let group = out.find((g) => g.z === z);
    if (!group) out.push((group = { z, choices: [] }));
    group.choices.push(choice);
  }
  return out;
}

type Child =
  | { z: number; part: RigPart }
  | { z: number; slot: SwapSlot; choices: SwapChoice[]; key: string };

export function CastFigure({
  rig,
  height,
  classes,
  ground,
  defer,
  tap,
  className,
}: CastFigureProps): ReactElement | null {
  const root = rig.parts.find((p) => p.parent === null);
  if (!root) return null;

  const pupils = rig.pupils;
  const pupilParts = pupils
    ? pupils.ids.map((id) => rig.parts.find((p) => p.id === id) ?? null)
    : [];
  const kids = new Map<string, Child[]>();
  const add = (on: string, child: Child) => {
    const list = kids.get(on);
    if (list) list.push(child);
    else kids.set(on, [child]);
  };
  for (const part of rig.parts) {
    if (part.parent !== null && !pupils?.ids.includes(part.id))
      add(part.parent, { z: part.z, part });
  }
  for (const slot of rig.swaps) {
    for (const g of groups(slot)) add(slot.on, { ...g, slot, key: `${slot.id}@${g.z}` });
  }

  const choiceNode = (slot: SwapSlot, choice: SwapChoice): ReactNode => {
    let inner: ReactNode = null;
    if (slot.id === "eyes" && pupils?.shownWith.includes(choice.id as "open" | "wide")) {
      const box = onHost(choice.box, slot.box);
      inner = pupilParts.map((part, i) =>
        part ? (
          <i
            key={part.id}
            data-pupil={i === 0 ? "r" : "l"}
            data-sprite=""
            className={classes?.pupils}
            style={{ ...place(within(part.box, box)), ...paint(part.sprite) }}
          />
        ) : null
      );
    }
    const key = `${slot.id}.${choice.id}` as SwapKey;
    return (
      <i
        key={choice.id}
        data-swap={slot.id}
        data-choice={choice.id}
        data-on={flag(choice.id === slot.rest)}
        data-rest={flag(choice.id === slot.rest)}
        data-sprite={flag(choice.sprite !== null)}
        className={classes?.[key]}
        style={{ ...place(choice.box), ...paint(choice.sprite) }}
      >
        {inner}
      </i>
    );
  };

  const childNode = (child: Child): ReactNode => {
    if ("part" in child) return partNode(child.part);
    const { slot } = child;
    const moves = slot.id === "eyes" || slot.id === "mouth" ? undefined : slot.id;
    return (
      <span
        key={child.key}
        data-slot={slot.id}
        data-socket={moves}
        className={classes?.[slot.id]}
        style={place(slot.box, slot.pivot, child.z)}
      >
        {child.choices.map((c) => choiceNode(slot, c))}
      </span>
    );
  };

  const partNode = (part: RigPart): ReactNode => {
    const children = [...(kids.get(part.id) ?? [])].sort((a, b) => a.z - b.z);
    return (
      <span
        key={part.id}
        data-part={part.id}
        data-socket={part.socket}
        data-look={flag(part.decor)}
        className={part.socket ? classes?.[part.socket] : undefined}
        style={place(part.box, part.pivot, part.z)}
      >
        {part.sprite ? <i data-sprite="" style={paint(part.sprite)} /> : null}
        {children.map(childNode)}
      </span>
    );
  };

  const style = {
    "--cast-x1": `url(${rig.atlas.x1})`,
    "--cast-x2": `url(${rig.atlas.x2})`,
    aspectRatio: String(rig.ratio),
    height: `min(${height}, ${CAST_MAX_CSS_PX}px)`,
    opacity: rig.translucent,
  } as CSSProperties;

  return (
    <span
      className={className ? `${styles.figure} ${className}` : styles.figure}
      data-cast={rig.id}
      data-sig={rig.signature.join(" ") || undefined}
      data-travel={pupils ? `${pupils.travel[0]} ${pupils.travel[1]}` : undefined}
      data-defer={flag(defer)}
      data-tap={flag(tap)}
      aria-hidden="true"
      style={style}
    >
      {partNode(root)}
      {ground ? (
        <i
          data-look=""
          data-ground=""
          className={classes?.ground}
          style={{ top: pct(rig.floor) }}
        />
      ) : null}
    </span>
  );
}
