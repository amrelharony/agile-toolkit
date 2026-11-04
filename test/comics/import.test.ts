// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOK_DIALOGUE } from "@/lib/comics/book-dialogue";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { BOOK_CREDIT_CORNERS, bookSourceId, planBookImport } from "@/lib/comics/import-book";
import {
  isStoryFinished,
  planConflicts,
  runImport,
  type ImportDeps,
} from "@/lib/comics/import-runner";
import {
  PANEL_KEYS,
  STORY_KEYS,
  WEEKLY_SCRIPT_FILE,
  cleanDescription,
  findWeeklyScriptFile,
  pickStory,
  planWeeklyImport,
  type ImportStory,
} from "@/lib/comics/import-weekly";
import {
  CREDIT_CORNERS,
  DEFAULT_CREDIT_CORNER,
  type OwnerStory,
  type StoredPanel,
} from "@/lib/comics/story-input";

/**
 * A script in the real file's shape, with its private fields named as they are
 * there. The zip isn't in CI. Checked once by hand against all 100 real scripts.
 */
const SECRET = "PRIVATE-NOTE";
const realShapedScript = (n: number) => ({
  pilot_id: `P${n}`,
  working_title: `Story ${n}`,
  status: SECRET,
  lesson: "A lesson.",
  squad_question: "A question?",
  cast_names: ["Amr", "Dinosaur"],
  cast_ids: [SECRET],
  theme_ids: ["T11", "T08"],
  production_number: n,
  episode_id: `AAW-N${String(n).padStart(3, "0")}`,
  art_files: [1, 2, 3, 4].map((p) => `art/N${String(n).padStart(3, "0")}_P0${p}.png`),
  research_refs: [SECRET],
  originality_review: { note: SECRET },
  art_review: SECRET,
  production_notes: [SECRET],
  provenance: SECRET,
  similarity_note: SECRET,
  panels: [1, 2, 3, 4].map((panel) => ({
    panel,
    visual: `Panel ${panel} shows a printer.`,
    dialogue: [{ speaker: "Amr", line: `Line ${panel}` }],
    embedded_text: ["WELCOME"],
    continuity: [SECRET],
    framing: SECRET,
    scene_id: SECRET,
    visual_action: SECRET,
    dialogue_word_count: 3,
    visible_cast_ids: [SECRET],
  })),
});

function folder(names: string[]) {
  return names.map((path) => ({ path }));
}

function weeklyFolder(count = 100) {
  const art: string[] = [];
  for (let n = 1; n <= count; n += 1) {
    for (let p = 1; p <= 4; p += 1) {
      art.push(`Batch/art/N${String(n).padStart(3, "0")}_P0${p}.png`);
    }
  }
  return folder([...art, `Batch/editorial/${WEEKLY_SCRIPT_FILE}`, "Batch/editorial/Pilots.json"]);
}

const scripts = (count = 100) => ({
  title: "x",
  episodes: Array.from({ length: count }, (_, i) => realShapedScript(i + 1)),
});

describe("the field whitelist", () => {
  it("names exactly the agreed fields", () => {
    expect([...STORY_KEYS]).toEqual([
      "working_title",
      "lesson",
      "squad_question",
      "cast_names",
      "theme_ids",
      "production_number",
      "episode_id",
      "art_files",
      "panels",
    ]);
    expect([...PANEL_KEYS]).toEqual(["panel", "visual", "dialogue", "embedded_text"]);
  });

  it("keeps nothing private out of the planned stories", () => {
    const plan = planWeeklyImport(scripts(), weeklyFolder());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const { stories } = plan;
    const sent = JSON.stringify(
      stories.map(({ panels, ...rest }) => ({ ...rest, panels: panels.map((p) => p.text) }))
    );
    expect(sent).not.toContain(SECRET);
    expect(sent).not.toContain("research");
    expect(sent).not.toContain("continuity");
  });

  it("copies what it should", () => {
    expect(pickStory(realShapedScript(7))).toEqual({
      title: "Story 7",
      lesson: "A lesson.",
      squadQuestion: "A question?",
      castNames: ["Amr", "Dinosaur"],
      themes: ["T11", "T08"],
      productionNumber: 7,
      episodeId: "AAW-N007",
      artFiles: ["art/N007_P01.png", "art/N007_P02.png", "art/N007_P03.png", "art/N007_P04.png"],
      panels: [1, 2, 3, 4].map((panel) => ({
        panel,
        visual: `Panel ${panel} shows a printer.`,
        dialogue: [{ speaker: "Amr", line: `Line ${panel}` }],
        embeddedText: ["WELCOME"],
      })),
    });
  });

  it.each([null, "x", {}, { working_title: "A", episode_id: "B", production_number: "1" }])(
    "gives up on %j",
    (raw) => {
      expect(pickStory(raw)).toBeNull();
    }
  );
});

describe("the cleaning rule", () => {
  it("drops the sentence naming balloons (AAW-N058)", () => {
    expect(
      cleanDescription(
        "HiPPO RIGHT without glasses reads OLD DECISION NOTE. Wolf asks Then what changed? upperLEFT; HiPPO answers upperRIGHT. Three own-portrait/current-name IDs."
      )
    ).toBe("HiPPO without glasses reads OLD DECISION NOTE. Three own-portrait/current-name IDs.");
  });

  it("drops the camel staging rules (AAW-N062)", () => {
    const out = cleanDescription(
      "Turtle LEFT at low desk reads a laptop showing ACCESS, TRANSPORT, DIETARY and NINE THREADS. Three confirmation folders already lie on desk. Camel CENTRE stands back from desk naturally as a quadruped, does not touch any prop and has no hands. Monkey RIGHT sees the one-line official plan BOOK VENUE. Natural table occlusion of Camel's lower legs is fine; never put Camel on the tabletop."
    );
    expect(out).toBe(
      "Turtle at low desk reads a laptop showing ACCESS, TRANSPORT, DIETARY and NINE THREADS. Three confirmation folders already lie on desk. Monkey sees the one-line official plan BOOK VENUE."
    );
    expect(out).not.toMatch(/quadruped|never|LEFT|RIGHT|CENTRE/);
  });

  it("drops a sentence about what must be readable (AAW-N011)", () => {
    const out = cleanDescription(
      "At an office laptop, Peacock LEFT sends a beautifully decorated email. The large readable subject is YOU WON'T BELIEVE OPTION B. The body says DETAILS ATTACHED and has a small attachment icon."
    );
    expect(out).toBe(
      "At an office laptop, Peacock sends a beautifully decorated email. The body says DETAILS ATTACHED and has a small attachment icon."
    );
  });

  it("strips a joined position word whole (AAW-N055)", () => {
    expect(cleanDescription("Peacock LEFT-CENTRE holds a large loose sheet.")).toBe(
      "Peacock holds a large loose sheet."
    );
  });

  it("leaves ordinary lowercase words alone", () => {
    expect(cleanDescription("Monkey left starts smiling at the right moment.")).toBe(
      "Monkey left starts smiling at the right moment."
    );
    expect(cleanDescription("Mustard stains cover the COPYRIGHT notice.")).toBe(
      "Mustard stains cover the COPYRIGHT notice."
    );
  });

  it.each(["balloon", "must", "exactly", "never", "do not", "readable", "in frame", "quadruped"])(
    "drops a sentence containing %s",
    (word) => {
      expect(cleanDescription(`Amr waits by the door. Keep ${word} here. Duck waves.`)).toBe(
        "Amr waits by the door. Duck waves."
      );
    }
  );

  it("stops at about 220 characters, at a sentence boundary", () => {
    const sentence = "A long sentence about an ordinary office with desks and chairs in it.";
    const out = cleanDescription(Array(8).fill(sentence).join(" "));
    expect(out.length).toBeLessThanOrEqual(220);
    expect(out.endsWith(".")).toBe(true);
  });

  it("keeps one long first sentence, within a limit", () => {
    const out = cleanDescription(`${"word ".repeat(100)}end.`);
    expect(out.length).toBeLessThanOrEqual(320);
    expect(out.length).toBeGreaterThan(220);
  });

  it("is never empty when every sentence is direction", () => {
    const out = cleanDescription("Keep the balloon upperLEFT. Never crop LEFT.");
    expect(out).toBe("Keep the balloon upperLEFT.");
  });
});

describe("planning the weekly batch", () => {
  it("numbers stories 27-126 by production number, and files them as drafts with text", () => {
    const plan = planWeeklyImport(scripts(), weeklyFolder());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.stories.map((s) => s.ep)).toEqual(Array.from({ length: 100 }, (_, i) => 27 + i));
    const first = plan.stories[0];
    expect(first.sourceId).toBe("AAW-N001");
    expect(first.bookPage).toBeNull();
    expect(first.panels).toHaveLength(4);
    expect(first.panels[0].text.needsReview).toBe(true);
    expect(first.panels[0].text.pathFull).toBe("");
    expect(first.panels[3].file.path).toBe("Batch/art/N001_P04.png");
  });

  it("finds art through art_files: a pilot's file doesn't match its episode name", () => {
    const pilot = {
      ...realShapedScript(1),
      episode_id: "AAW-N900",
      art_files: [1, 2, 3, 4].map((p) => `art/P01_P0${p}.png`),
    };
    const files = weeklyFolder();
    files.push(...folder([1, 2, 3, 4].map((p) => `Batch/art/P01_P0${p}.png`)));
    const plan = planWeeklyImport({ episodes: [pilot, ...scripts().episodes.slice(1)] }, files);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.stories[0].panels[0].file.path).toBe("Batch/art/P01_P01.png");
  });

  it("refuses anything but 100 stories", () => {
    const plan = planWeeklyImport(scripts(99), weeklyFolder());
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.problems.join(" ")).toContain("99");
  });

  it("refuses a missing art file, naming it", () => {
    const files = weeklyFolder().filter((f) => !f.path.endsWith("N042_P03.png"));
    const plan = planWeeklyImport(scripts(), files);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.problems.join(" ")).toContain("art/N042_P03.png");
  });

  it("refuses a repeated production number", () => {
    const repeated = scripts();
    repeated.episodes[1].production_number = 1;
    expect(planWeeklyImport(repeated, weeklyFolder()).ok).toBe(false);
  });

  it("refuses a file with no episodes", () => {
    expect(planWeeklyImport({}, weeklyFolder()).ok).toBe(false);
  });

  it("finds only the exact script file, ignoring its look-alikes", () => {
    const files = folder([
      "Batch/editorial/Volume_01_Story_Scripts.json",
      "Batch/editorial/Agile_At_Work_First_10_Story_Scripts.json",
      "Batch/editorial/Agile_At_Work_Batch_1_100_Development_Briefs.json",
      `Batch/old/${WEEKLY_SCRIPT_FILE}`,
    ]);
    expect(findWeeklyScriptFile(files)).toBeNull();
    const real = { path: `Batch/editorial/${WEEKLY_SCRIPT_FILE}` };
    expect(findWeeklyScriptFile([...files, real])).toBe(real);
  });
});

describe("planning the book batch", () => {
  const bookFiles = () => {
    const names = ["Art/README.txt", "Art/Finished_Posters/Poster_01.pdf"];
    for (let e = 1; e <= 26; e += 1) {
      const nn = String(e).padStart(2, "0");
      for (let p = 1; p <= 4; p += 1) names.push(`Art/Panels/Episode_${nn}/E${nn}_Panel_0${p}.jpg`);
    }
    return folder(names);
  };

  it("takes the canon index and the poster words, with descriptions as drafts to review", () => {
    const plan = planBookImport(bookFiles());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.stories).toHaveLength(26);
    const seven = plan.stories[6];
    const canon = BOOK_EPISODES[6];
    expect(seven).toMatchObject({
      ep: 7,
      sourceId: "AAW-E07",
      title: canon.title,
      lesson: canon.lesson,
      squadQuestion: canon.question,
      bookPage: canon.bookPage,
    });
    for (const panel of seven.panels) {
      // A draft to approve: never public until reviewed, and no story text is made up here.
      expect(panel.text.alt.length).toBeGreaterThan(0);
      expect(panel.text.alt.length).toBeLessThanOrEqual(220);
      expect(panel.text.needsReview).toBe(true);
    }
    expect(seven.panels[1].file.path).toBe("Art/Panels/Episode_07/E07_Panel_02.jpg");
    expect(seven.panels[1].text.dialogue).toEqual(BOOK_DIALOGUE[7].panels[1].dialogue);
  });

  it("moves the credit off the balloons where the default corner would sit on one", () => {
    const plan = planBookImport(bookFiles());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const corners = new Map<string, string>();
    for (const story of plan.stories) {
      story.panels.forEach((panel, i) =>
        corners.set(`${story.ep}:${i + 1}`, panel.text.creditCorner)
      );
    }
    expect(Object.keys(BOOK_CREDIT_CORNERS).length).toBeGreaterThan(0);
    for (const [key, corner] of Object.entries(BOOK_CREDIT_CORNERS)) {
      // A key that names no panel would quietly move nothing.
      expect(corners.has(key), key).toBe(true);
      expect(corner, key).not.toBe(DEFAULT_CREDIT_CORNER);
      expect(CREDIT_CORNERS, key).toContain(corner);
      expect(corners.get(key), key).toBe(corner);
    }
    expect(corners.get("26:3")).toBe("top-left");
    expect(corners.get("1:1")).toBe(DEFAULT_CREDIT_CORNER);
    const moved = Array.from(corners.values()).filter((c) => c !== DEFAULT_CREDIT_CORNER);
    expect(moved).toHaveLength(Object.keys(BOOK_CREDIT_CORNERS).length);
  });

  it("refuses anything but 104 panels", () => {
    const plan = planBookImport(bookFiles().slice(0, -1));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.problems[0]).toContain("103");
  });

  it("pads the source id", () => {
    expect(bookSourceId(1)).toBe("AAW-E01");
    expect(bookSourceId(26)).toBe("AAW-E26");
  });
});

describe("the book dialogue", () => {
  it("has four panels for each of the 26 episodes", () => {
    for (const { ep } of BOOK_EPISODES) expect(BOOK_DIALOGUE[ep].panels).toHaveLength(4);
  });

  it("is word for word as printed, in reading order", () => {
    expect(BOOK_DIALOGUE[1].panels[0].dialogue).toEqual([
      { speaker: "Amr", line: "I tidied the board." },
      { speaker: "Dinosaur", line: "I called everything first." },
    ]);
    expect(BOOK_DIALOGUE[25].panels[1].dialogue.map((d) => d.line)).toEqual([
      "Nearly done! They’re all ninety per cent.",
      "How many can someone sit on?",
    ]);
  });

  it("leaves a silent panel silent", () => {
    expect(BOOK_DIALOGUE[3].panels[1].dialogue).toEqual([]);
    expect(BOOK_DIALOGUE[13].panels[1].signs).toEqual(["BZZT"]);
  });

  it("only ever names a speaker the canon lists for that episode", () => {
    for (const { ep } of BOOK_EPISODES) {
      const { cast, panels } = BOOK_DIALOGUE[ep];
      for (const panel of panels) {
        for (const line of panel.dialogue) expect(cast).toContain(line.speaker);
      }
    }
  });
});

function panel(over: Partial<StoredPanel> = {}): StoredPanel {
  return {
    pathFull: "",
    pathSmall: "",
    width: 0,
    height: 0,
    alt: "Shown.",
    dialogue: [],
    signs: [],
    needsReview: true,
    creditCorner: "bottom-right",
    ...over,
  };
}

const withArt = (over: Partial<StoredPanel> = {}) =>
  panel({ pathFull: "f.webp", pathSmall: "s.webp", width: 10, height: 10, ...over });

function serverStory(ep: number, sourceId: string, over: Partial<OwnerStory> = {}): OwnerStory {
  return {
    ep,
    collection: ep <= 26 ? "book" : "weekly",
    sourceId,
    title: "T",
    lesson: "",
    squadQuestion: "",
    castNames: [],
    themes: [],
    panels: [],
    sharePath: null,
    bookPage: null,
    releaseAt: null,
    firstReleasedAt: null,
    updatedAt: "x",
    ...over,
  };
}

function planned(ep: number, sourceId: string, alt = "Shown."): ImportStory<string> {
  return {
    ep,
    sourceId,
    title: `Story ${ep}`,
    lesson: "",
    squadQuestion: "",
    castNames: [],
    themes: [],
    bookPage: null,
    panels: [1, 2].map((n) => ({ file: `${sourceId}-${n}`, text: panel({ alt }) })),
  };
}

function fakeDeps(start: OwnerStory[] = []) {
  const stories = new Map(start.map((s) => [s.ep, s]));
  const deps: ImportDeps<string> = {
    createStory: vi.fn(async (story: ImportStory<string>) => {
      const created = serverStory(story.ep, story.sourceId, {
        panels: story.panels.map((p) => p.text),
      });
      stories.set(story.ep, created);
      return created;
    }),
    savePanels: vi.fn(async (ep: number, panels: StoredPanel[], sharePath: string | null) => {
      const saved = { ...stories.get(ep)!, panels, sharePath };
      stories.set(ep, saved);
      return saved;
    }),
    release: vi.fn(async (ep: number) => {
      const saved = { ...stories.get(ep)!, releaseAt: "now" };
      stories.set(ep, saved);
      return saved;
    }),
    convertAndUpload: vi.fn(async (file: string) => ({
      pathFull: `${file}.full`,
      pathSmall: `${file}.small`,
      sharePath: `${file}.share`,
      width: 10,
      height: 10,
    })),
  };
  return { deps, stories };
}

describe("running an import", () => {
  let convert: ReturnType<typeof fakeDeps>;

  beforeEach(() => {
    convert = fakeDeps();
  });

  it("creates each story, uploads panel by panel and saves after each", async () => {
    const { deps, stories } = convert;
    const result = await runImport({ plan: [planned(27, "AAW-N001")], existing: [], deps });
    expect(result.storiesDone).toBe(1);
    expect(result.panelsDone).toBe(2);
    expect(deps.savePanels).toHaveBeenCalledTimes(2);
    const saved = stories.get(27)!;
    expect(saved.panels.map((p) => p.pathFull)).toEqual(["AAW-N001-1.full", "AAW-N001-2.full"]);
    expect(saved.sharePath).toBe("AAW-N001-1.share");
    expect(isStoryFinished(saved)).toBe(true);
  });

  it("asks for a share image on the first panel only", async () => {
    const { deps } = convert;
    await runImport({ plan: [planned(27, "AAW-N001")], existing: [], deps });
    expect(vi.mocked(deps.convertAndUpload).mock.calls.map((c) => c[2])).toEqual([true, false]);
  });

  it("skips a finished story, found by source id", async () => {
    const finished = serverStory(27, "AAW-N001", {
      panels: [withArt(), withArt()],
      sharePath: "share.jpg",
    });
    const { deps } = fakeDeps([finished]);
    const result = await runImport({
      plan: [planned(27, "AAW-N001")],
      existing: [finished],
      deps,
    });
    expect(result.skipped).toBe(1);
    expect(result.storiesDone).toBe(1);
    expect(deps.createStory).not.toHaveBeenCalled();
    expect(deps.convertAndUpload).not.toHaveBeenCalled();
    expect(deps.savePanels).not.toHaveBeenCalled();
  });

  it("finds a story that moved to another number since the last run", async () => {
    const moved = serverStory(40, "AAW-N001", {
      panels: [withArt(), panel()],
      sharePath: "share.jpg",
    });
    const { deps, stories } = fakeDeps([moved]);
    await runImport({ plan: [planned(27, "AAW-N001")], existing: [moved], deps });
    expect(deps.createStory).not.toHaveBeenCalled();
    expect(stories.get(40)!.panels[1].pathFull).toBe("AAW-N001-2.full");
  });

  it("resumes partway through a story without redoing its panels or text", async () => {
    const partial = serverStory(27, "AAW-N001", {
      panels: [withArt({ alt: "Edited by the owner" }), panel({ alt: "Also edited" })],
      sharePath: "share.jpg",
    });
    const { deps, stories } = fakeDeps([partial]);
    await runImport({ plan: [planned(27, "AAW-N001")], existing: [partial], deps });
    expect(deps.convertAndUpload).toHaveBeenCalledTimes(1);
    expect(deps.convertAndUpload).toHaveBeenCalledWith("AAW-N001-2", expect.anything(), false);
    const saved = stories.get(27)!;
    expect(saved.panels[0].alt).toBe("Edited by the owner");
    expect(saved.panels[1].alt).toBe("Also edited");
    expect(saved.sharePath).toBe("share.jpg");
  });

  it("redoes a first panel missing its share image", async () => {
    const partial = serverStory(27, "AAW-N001", {
      panels: [withArt(), withArt()],
      sharePath: null,
    });
    const { deps, stories } = fakeDeps([partial]);
    await runImport({ plan: [planned(27, "AAW-N001")], existing: [partial], deps });
    expect(deps.convertAndUpload).toHaveBeenCalledTimes(1);
    expect(stories.get(27)!.sharePath).toBe("AAW-N001-1.share");
  });

  it("carries on after a failure, and a second run finishes the job", async () => {
    const { deps, stories } = convert;
    vi.mocked(deps.convertAndUpload).mockRejectedValueOnce(new Error("offline"));
    const plan = [planned(27, "AAW-N001"), planned(28, "AAW-N002")];
    const first = await runImport({ plan, existing: [], deps });
    expect(first.failures).toEqual([{ ep: 27, title: "Story 27", message: "offline" }]);
    expect(first.storiesDone).toBe(1);

    const second = await runImport({ plan, existing: Array.from(stories.values()), deps });
    expect(second.failures).toEqual([]);
    expect(second.skipped).toBe(1);
    expect(isStoryFinished(stories.get(27)!)).toBe(true);
  });

  it("stops between panels when asked, leaving what's done saved", async () => {
    const { deps } = convert;
    let calls = 0;
    const result = await runImport({
      plan: [planned(27, "AAW-N001"), planned(28, "AAW-N002")],
      existing: [],
      deps,
      shouldStop: () => {
        calls += 1;
        return calls > 2; // Story check, first panel, then stop before the second.
      },
    });
    expect(result.panelsDone).toBe(1);
    expect(deps.createStory).toHaveBeenCalledTimes(1);
  });

  it("never gives a weekly story a date", async () => {
    const { deps } = convert;
    await runImport({ plan: [planned(27, "AAW-N001")], existing: [], deps });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("releases a book episode only if every panel has a checked description", async () => {
    const { deps } = convert;
    const checked = planned(2, "AAW-E02", "Shown.");
    for (const p of checked.panels) p.text.needsReview = false;
    await runImport({
      plan: [
        planned(1, "AAW-E01", ""),
        checked,
        planned(3, "AAW-E03", "Shown, but nobody has read it."),
      ],
      existing: [],
      deps,
    });
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.release).toHaveBeenCalledWith(2);
  });

  it("leaves an already complete book episode to the confirmed publish", async () => {
    const reviewed = serverStory(1, "AAW-E01", {
      panels: [withArt(), withArt()],
      sharePath: "share.jpg",
    });
    const { deps } = fakeDeps([reviewed]);
    const result = await runImport({
      plan: [planned(1, "AAW-E01", "")],
      existing: [reviewed],
      deps,
    });
    expect(result.skipped).toBe(1);
    expect(deps.convertAndUpload).not.toHaveBeenCalled();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("never brings back an episode the owner unpublished", async () => {
    const takenDown = serverStory(5, "AAW-E05", {
      panels: [withArt(), withArt()],
      sharePath: "share.jpg",
      firstReleasedAt: "2026-01-01T00:00:00.000Z",
    });
    const { deps } = fakeDeps([takenDown]);
    await runImport({ plan: [planned(5, "AAW-E05")], existing: [takenDown], deps });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("doesn't bring it back while finishing its art either", async () => {
    const takenDown = serverStory(5, "AAW-E05", {
      panels: [withArt(), panel()],
      sharePath: "share.jpg",
      firstReleasedAt: "2026-01-01T00:00:00.000Z",
    });
    const { deps } = fakeDeps([takenDown]);
    await runImport({ plan: [planned(5, "AAW-E05")], existing: [takenDown], deps });
    expect(deps.convertAndUpload).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("releases a book episode whose art this run finished, with its text already written", async () => {
    const partial = serverStory(1, "AAW-E01", {
      panels: [withArt({ needsReview: false }), panel({ needsReview: false })],
      sharePath: "share.jpg",
    });
    const { deps } = fakeDeps([partial]);
    await runImport({ plan: [planned(1, "AAW-E01", "")], existing: [partial], deps });
    expect(deps.release).toHaveBeenCalledWith(1);
  });

  it("holds back a book episode with panels still marked for review", async () => {
    const partial = serverStory(1, "AAW-E01", {
      panels: [withArt({ needsReview: true }), panel({ needsReview: false })],
      sharePath: "share.jpg",
    });
    const { deps } = fakeDeps([partial]);
    await runImport({ plan: [planned(1, "AAW-E01", "")], existing: [partial], deps });
    expect(deps.convertAndUpload).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("spots a number already held by another story, but not its own", () => {
    const existing = [serverStory(27, "OTHER"), serverStory(28, "AAW-N002")];
    expect(
      planConflicts(
        [planned(27, "AAW-N001"), planned(28, "AAW-N002"), planned(29, "AAW-N003")],
        existing
      )
    ).toEqual([27]);
  });
});
