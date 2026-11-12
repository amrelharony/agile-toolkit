/**
 * The cast brief generator, run on synthetic private sources made in a temp
 * folder: the real canon stays out of the repo. Checks that ChatGPT reads the same
 * numbers the builder checks, that each chat asks for its own images, and that the
 * never-list holds.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import * as gen from "../../scripts/build-cast-brief.mjs";
import { ARM_WORDS } from "../../scripts/cast/brief-blocks.mjs";

const spec = gen.loadSpec();
const tmp = mkdtempSync(path.join(os.tmpdir(), "cast-brief-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function makeSources(dir: string, mutate?: (p: Record<string, unknown>) => void) {
  mkdirSync(path.join(dir, "blocks"), { recursive: true });
  const characters: Record<string, unknown> = {};
  for (const c of spec.characters) {
    const block = `CHARACTER: SYNTHETIC ${c.id}\nA test block.\nBACKGROUND COLOUR if transparency fails: {KEY_NAME} {KEY_HEX}.`;
    writeFileSync(path.join(dir, "blocks", `${c.id}.txt`), block);
    characters[c.id] = {
      block: `blocks/${c.id}.txt`,
      refs: [
        { role: "sheet", file: `refs/${c.id}/${c.id}_ref-sheet.jpg`, src: "synthetic" },
        { role: "story-1", file: `refs/${c.id}/${c.id}_ref-story-1.jpg`, src: "synthetic" },
      ],
      height_vs_amr: 1,
    };
  }
  const priv = { characters };
  mutate?.(priv);
  writeFileSync(path.join(dir, "cast-private.json"), JSON.stringify(priv));
  return gen.loadPrivate(dir);
}

const sources = path.join(tmp, "sources");
const priv = makeSources(sources);
const byId = (id: string) => spec.characters.find((c: { id: string }) => c.id === id);
const file = (id: string) => gen.characterFile(spec, byId(id), priv.characters[id]) as string;

describe("the per-character brief", () => {
  it("states the tolerances the builder checks, with the spec's numbers", () => {
    const t = spec.tolerances;
    const text = file("AAW-04");
    expect(text).toContain(`${t.canvas_w} x ${t.canvas_h} pixels`);
    expect(text).toContain(`up to ${t.tilt_deg} degrees`);
    expect(text).toContain(`smaller than ${t.speck_px} pixels`);
    expect(text).toContain(
      `${Math.round(t.scale_min * 100)}% and ${Math.round(t.scale_max * 100)}%`
    );
    expect(text).toContain(`at least ${t.margin_ask_px} pixels`);
    expect(text).toContain(`at least ${t.gap_ask_px} pixels`);
    expect(text).toContain(`at least ${t.pupil_min_px} pixels across`);
    expect(text).toContain(`about ${t.master_height_px} pixels tall`);
  });

  it("fills the background key and leaves no placeholder", () => {
    for (const c of spec.characters) {
      const text = file(c.id);
      expect(text).not.toMatch(/\{KEY_/);
      expect(text).toContain(spec.keys[c.key ?? "magenta"]);
    }
  });

  it("asks each chat for its own images only", () => {
    expect(file("AAW-05")).not.toContain("IMAGE 4: THE ARMS");
    expect(file("AAW-05")).toContain("IMAGE 2B: MORE PARTS");
    expect(file("AAW-04")).not.toContain("IMAGE 2B");
    expect(file("AAW-04")).not.toContain("IMAGE 3B");
    expect(file("AAW-01")).toContain("IMAGE 3B: MORE FACES");
    expect(file("AAW-01")).toContain("His four whole arms in one row");
  });

  it("words each arm for its body", () => {
    expect(file("AAW-18")).toContain("A real tentacle used as an arm");
    expect(file("AAW-19")).toContain("A real wing-arm");
    expect(file("AAW-25")).toContain("A real tube arm");
    expect(file("AAW-24")).toContain("A real spider leg used as an arm");
    expect(file("AAW-04")).toContain("one upper arm, one forearm and one hand");
  });

  it("lets a character's own arms override its family's", () => {
    // A suited bird with hands, a gloved bird and a ghost with fingers.
    expect(file("AAW-22")).toContain("one upper arm, one forearm and one hand");
    expect(file("AAW-22")).not.toContain("A real wing-arm");
    expect(file("AAW-09")).toContain("ends in a white cartoon glove");
    expect(file("AAW-12")).toContain("ends in its own hand");
    expect(file("AAW-12")).not.toContain("A real mitten arm");
  });

  it("never asks a character without a card for one, or a camel for an arm", () => {
    for (const id of ["AAW-02", "AAW-25"]) {
      expect(file(id)).not.toMatch(/blank ID card\.\n/);
      expect(file(id)).toContain("4. There is no text or marks.\n");
    }
    expect(file("AAW-04")).toContain("4. There is no text or marks, and the ID card is blank.");
    const camel = file("AAW-05");
    expect(camel).not.toContain("Arm {k} looks wrong");
    expect(camel).toContain("Fix for AAW-05 Capacity Camel, image 2B (more parts)");
    expect(camel).toContain("legs and tail fully visible, nothing held");
  });

  it("orders the references sheet first", () => {
    const refs = gen.pageData(spec, priv).characters[0].refs.map((r: { role: string }) => r.role);
    expect(refs[0]).toBe("sheet");
  });

  it("draws big gestures as whole arms, never bent limbs", () => {
    const text = file("AAW-04");
    expect(text).toContain(
      "Every bigger movement (waving, pointing, arms up) is its own complete drawing of the whole arm"
    );
    expect(text).toContain("never a flipped copy");
  });

  it("keeps the kickoff to one character and forbids photos for Amr", () => {
    const amr = gen.kickoffText(spec, byId("AAW-01"), priv.characters["AAW-01"]);
    expect(amr).toContain("Never use a photograph of me or of anyone");
    expect(amr).toContain("AAW-01_face2.png");
    const beaver = gen.kickoffText(spec, byId("AAW-04"), priv.characters["AAW-04"]);
    expect(beaver).not.toContain("photograph");
    expect(beaver).toContain(
      "AAW-04_master.png, AAW-04_parts.png, AAW-04_face.png, AAW-04_arms.png"
    );
  });

  it("gives Amr nine master-check lines and everyone else five", () => {
    const data = gen.pageData(spec, priv);
    for (const c of data.characters) expect(c.check).toHaveLength(c.id === "AAW-01" ? 9 : 5);
  });
});

describe("the Opus appendix", () => {
  const appendix = gen.partsAppendix(spec, priv) as string;
  /** One character's entry, from its heading to the next one. */
  const entry = (id: string) => {
    const start = appendix.indexOf(`\n## ${id} `);
    expect(start, id).toBeGreaterThan(-1);
    return appendix.slice(start, appendix.indexOf("\n## ", start + 1));
  };

  it("names a character's own arms over its family's, the ones its brief words", () => {
    expect(entry("AAW-09")).toMatch(/; arms glove\b/);
    expect(entry("AAW-10")).toMatch(/; arms human\b/);
    expect(entry("AAW-12")).toMatch(/; arms soft\b/);
    expect(entry("AAW-22")).toMatch(/; arms human\b/);
    expect(entry("AAW-05")).toMatch(/; arms none\b/);
    for (const c of spec.characters) {
      if (!c.images.includes("arms")) continue;
      const arms = /; arms (\w+)\b/.exec(entry(c.id))?.[1] as keyof typeof ARM_WORDS;
      expect(ARM_WORDS[arms], c.id).toBeDefined();
      expect(file(c.id), c.id).toContain(ARM_WORDS[arms]);
    }
  });

  it("prints only what the spec holds, never an empty field", () => {
    expect(appendix).not.toMatch(/\b(undefined|null|NaN)\b/);
    for (const c of spec.characters)
      expect(entry(c.id), c.id).toMatch(/\n- Batch [A-Z]; family \w+; arms \w+\.\n/);
  });
});

describe("the generator", () => {
  it("refuses a reference on the never-list", () => {
    const dir = path.join(tmp, "never");
    expect(() =>
      makeSources(dir, (p) => {
        const chars = p.characters as Record<
          string,
          { refs: { role: string; file: string; src: string }[] }
        >;
        chars["AAW-04"].refs.push({
          role: "story-2",
          file: "x.jpg",
          src: "Web_Book_Panels/Episode_01/E01.png",
        });
      })
    ).toThrow(/never-list/);
  });

  it("refuses sources missing a character", () => {
    const dir = path.join(tmp, "missing");
    makeSources(dir, (p) => {
      delete (p.characters as Record<string, unknown>)["AAW-30"];
    });
    expect(() => gen.build({ sources: dir, out: path.join(tmp, "missing-out") })).toThrow(/AAW-30/);
  });

  it("reports nothing stale right after a build, and a stale file after a change", () => {
    const out = path.join(tmp, "out");
    gen.build({ sources, out });
    expect(gen.build({ sources, out, check: true }).stale).toEqual([]);
    writeFileSync(
      path.join(sources, "blocks", "AAW-04.txt"),
      "CHARACTER: CHANGED {KEY_NAME} {KEY_HEX}"
    );
    const stale = gen.build({ sources, out, check: true }).stale as string[];
    expect(stale.some((f) => f.endsWith("CAST-AAW-04.md"))).toBe(true);
    expect(readFileSync(path.join(out, "CAST-AAW-04.md"), "utf8")).toContain("SYNTHETIC AAW-04");
  });
});
