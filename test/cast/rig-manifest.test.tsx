/**
 * What every rig in rigs.generated.ts must be for CastFigure and life to draw
 * and move it: one root, parents first, arms as slots (never also a part),
 * pupils inside the eyes' host, turns within the clip limits, signature moves
 * that exist, and the node and animated budgets. Proved on the synthetic
 * fixtures, then run over every shipped rig (none yet).
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CastFigure } from "@/components/cast/cast-figure";
import { LIMITS, clipFor, turnLimit } from "@/lib/cast/clips";
import type { RigManifest } from "@/lib/cast/rig-types";
import { RIGS } from "@/lib/cast/rigs.generated";
import { CAST } from "@/lib/vip/cast.generated";
import spec from "../../docs/cast/cast-rig.json";
import { ARMLESS_PUPPET, TEST_PUPPET } from "./fixtures/rig-fixture";

/** Amr, whose rig carries no tap move of its own. */
const AMR = "AAW-01";

function problems(rig: RigManifest): string[] {
  const out: string[] = [];
  const ids = rig.parts.map((p) => p.id);
  if (rig.v !== 1) out.push("version");
  if (!/^AAW-\d\d$/.test(rig.id)) out.push("id");
  const roots = rig.parts.filter((p) => p.parent === null);
  if (roots.length !== 1 || roots[0].socket !== "body") out.push("one root, socket body");
  if (new Set(ids).size !== ids.length) out.push("part ids repeat");
  rig.parts.forEach((p, i) => {
    if (p.parent !== null && !ids.slice(0, i).includes(p.parent)) out.push(`${p.id}: parent first`);
    if (p.socket && p.range > turnLimit(p.socket)) out.push(`${p.id}: range`);
  });
  for (const slot of rig.swaps) {
    if (!ids.includes(slot.on)) out.push(`${slot.id}: rides on no part`);
    const choices = slot.choices.map((c) => c.id);
    if (!choices.includes(slot.rest)) out.push(`${slot.id}: no rest choice`);
    if (new Set(choices).size !== choices.length) out.push(`${slot.id}: choices repeat`);
    if (rig.parts.some((p) => p.id === slot.id || p.socket === slot.id)) {
      out.push(`${slot.id}: drawn as a part and a slot`);
    }
  }
  if (rig.pupils) {
    const eyes = rig.swaps.find((s) => s.id === "eyes");
    if (!eyes) out.push("pupils without eyes");
    for (const id of rig.pupils.ids) {
      const part = rig.parts.find((p) => p.id === id);
      if (!part || part.parent !== eyes?.on) out.push(`${id}: not on the eyes' host`);
    }
    for (const c of rig.pupils.shownWith) {
      if (!eyes?.choices.some((x) => x.id === c)) out.push(`pupils shown with missing ${c}`);
    }
  }
  // Amr's tap move plays only in the intros, so his rig may have none.
  const fewest = rig.id === AMR ? 0 : 1;
  if (rig.signature.length < fewest || rig.signature.length > 2) {
    out.push("one or two signature moves");
  }
  for (const id of rig.signature) {
    const clip = clipFor(id);
    if (!clip || !id.startsWith("sig.") || clip.ms > LIMITS.maxMs) out.push(`signature ${id}`);
  }
  if (rig.counts.nodes > 48) out.push("nodes");
  if (rig.counts.animated > 10) out.push("animated");
  if (!(rig.ratio > 0) || !(rig.heightVsAmr > 0)) out.push("proportions");
  if (rig.translucent !== undefined && !(rig.translucent > 0 && rig.translucent < 1)) {
    out.push("translucent");
  }
  return out;
}

function rendered(rig: RigManifest): number {
  const { container } = render(<CastFigure rig={rig} height="160px" ground />);
  return container.querySelectorAll("[data-cast], [data-cast] *").length;
}

/**
 * The most elements life moves at once on the drawn rig, as life finds them:
 * the look's (head, body, pupils) or one clip's (signature or guess, its
 * first and armless layers included). The look waits while a clip plays.
 */
function movedAtOnce(rig: RigManifest): number {
  const { container } = render(<CastFigure rig={rig} height="160px" />);
  const fig = container.querySelector("[data-cast]")!;
  const count = (sockets: string[]) => {
    const els = new Set<Element>();
    for (const socket of sockets) {
      const selector = socket === "pupils" ? "[data-pupil]" : `[data-socket="${socket}"]`;
      for (const el of Array.from(fig.querySelectorAll(selector))) els.add(el);
    }
    return els.size;
  };
  const clips = [...rig.signature, "guess.matched", "guess.differed", "guess.skipped"]
    .map(clipFor)
    .map((clip) =>
      clip
        ? count(
            [clip, clip.first, clip.armless].flatMap((layer) =>
              layer ? layer.tracks.map((t) => t.socket) : []
            )
          )
        : 0
    );
  return Math.max(count(["head", "body", "pupils"]), ...clips);
}

describe("the rig checks", () => {
  it("pass the synthetic fixtures", () => {
    expect(problems(TEST_PUPPET)).toEqual([]);
    expect(problems(ARMLESS_PUPPET)).toEqual([]);
    for (const rig of [TEST_PUPPET, ARMLESS_PUPPET]) {
      expect(movedAtOnce(rig), rig.id).toBeLessThanOrEqual(rig.counts.animated);
    }
  });

  it("count every element the look or one clip moves: all four pupils, eight limbs", () => {
    // The look: the head, the body and a pupil in each of two eye choices.
    expect(movedAtOnce({ ...TEST_PUPPET, signature: [] })).toBe(6);
    // sig.ripple moves eight limbs, more than the look.
    const limbs = Array.from({ length: 8 }, (_, i) => ({
      ...TEST_PUPPET.parts[4],
      id: `tentacle-${i + 1}`,
      socket: `limb-${i + 1}` as const,
      range: 12,
    }));
    const octopus = {
      ...ARMLESS_PUPPET,
      parts: [...ARMLESS_PUPPET.parts, ...limbs],
      signature: ["sig.ripple"],
    };
    expect(movedAtOnce(octopus)).toBe(8);
    // Its counts still say 6, which the shipped-rig check would catch.
    expect(movedAtOnce(octopus)).toBeGreaterThan(octopus.counts.animated);
  });

  it("ask every rig but Amr's for one or two signature moves", () => {
    expect(problems({ ...TEST_PUPPET, id: AMR, signature: [] })).toEqual([]);
    expect(problems({ ...TEST_PUPPET, signature: [] })).toEqual(["one or two signature moves"]);
    const three = ["sig.tail", "sig.wave", "sig.nod"];
    expect(problems({ ...TEST_PUPPET, id: AMR, signature: three })).toEqual([
      "one or two signature moves",
    ]);
  });

  it("catch a broken rig", () => {
    const broken: RigManifest = {
      ...TEST_PUPPET,
      parts: [
        ...TEST_PUPPET.parts.slice(1, 2),
        TEST_PUPPET.parts[0],
        { ...TEST_PUPPET.parts[4], range: 40 },
        { ...TEST_PUPPET.parts[5], id: "arm-r", socket: "arm-r" },
      ],
      signature: ["sig.nope"],
    };
    expect(problems(broken)).toEqual(
      expect.arrayContaining([
        "head: parent first",
        "tail: range",
        "arm-r: drawn as a part and a slot",
        "pupil-r: not on the eyes' host",
        "signature sig.nope",
      ])
    );
  });
});

const shipped = Object.entries(RIGS);

describe.skipIf(shipped.length === 0)("every shipped rig", () => {
  const characters = new Map(spec.characters.map((c) => [c.id, c] as const));
  const names = new Set(CAST.map((c) => c.name));

  it.each(shipped)("%s is sound", (key, rig) => {
    expect(rig.id).toBe(key);
    expect(problems(rig)).toEqual([]);
    expect(movedAtOnce(rig)).toBeLessThanOrEqual(rig.counts.animated);
    expect(names.has(rig.name), rig.name).toBe(true);
    expect(rig.family).toBe(characters.get(rig.id)?.family);
  });

  it.each(shipped)("%s renders the nodes it counts", (_key, rig) => {
    expect(rendered(rig)).toBe(rig.counts.nodes);
  });
});
