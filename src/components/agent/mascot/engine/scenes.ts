/**
 * Amr's scenes: the short moments drawn on the context sheets S11–S64
 * (docs/mascot/context-sheets.json): the weather where the visitor is, their time
 * of day, Egyptian, Islamic, Coptic and international days, the seasons, the
 * toolkit's own moments, and play. Each scene is a clip of one sheet's frames.
 *
 * A scene plays only once its pack has been built from a returned sheet: until
 * then its frames aren't in the manifest (mascot-packs.ts), `sceneShipped` says
 * no, and nothing asks for it. So the sheets can come back a few at a time.
 *
 * Pure data, with type-only imports, like clips.ts.
 */

import type { SpritePose } from "./sprite-poses";
import { clip, s, times, type Clip, type FrameRef, type Step } from "./clips";

/** A frame of a context sheet, which the manifest has only once its pack ships. */
const f = (id: string, ms: number): Step => s(id as FrameRef, ms);

/** Two frames back and forth, `n` times. */
const swing = (a: string, b: string, ms: number, n: number): Step[] => times(n, f(a, ms), f(b, ms));

type Fallback = SpritePose;

function scene(name: string, fallback: Fallback, steps: Step[]): [string, Clip] {
  return [name, clip(`scene:${name}`, fallback, steps)];
}

const LIST: Array<[string, Clip]> = [
  // ── Weather ──────────────────────────────────────────────────────────────
  scene("sun", "review", [f("sun.shades-out", 700), f("sun.shades-on", 600), f("sun.cool", 1800)]),
  scene("sun.bask", "idle", [f("sun.bask", 2600)]),
  scene("sun.look", "waiting", [f("sun.visor", 1800), f("sun.thumbs", 900)]),
  scene("sun.peek", "review", [f("sun.peek", 1300), f("sun.thumbs", 700)]),

  scene("heat", "waiting", [...swing("heat.fan-a", "heat.fan-b", 180, 5), f("heat.wipe", 1200)]),
  scene("heat.drink", "waiting", [f("heat.drink", 1400), f("heat.ahh", 1100)]),
  scene("heat.wilt", "failed", [f("heat.collar", 1000), f("heat.wilt", 1800)]),

  scene("scorch", "review", [f("scorch.cone", 700), f("scorch.lick", 900), f("scorch.drip", 1100)]),
  scene("scorch.cool", "waiting", [f("scorch.glass", 1500), f("scorch.sip", 1200)]),
  scene("scorch.fan", "failed", [f("scorch.fan", 2000), f("scorch.melt", 1500)]),

  scene("cold", "waiting", [
    ...swing("cold.shiver-a", "cold.shiver-b", 120, 6),
    f("cold.rub", 900),
    f("cold.blow", 1200),
  ]),
  scene("cold.hunch", "waiting", [
    f("cold.hunch", 1200),
    ...times(3, f("cold.stamp", 300), f("cold.hunch", 300)),
  ]),
  scene("cold.sneeze", "jumping", [f("cold.sneeze", 900), f("cold.hunch", 700)]),

  scene("cosy", "review", [f("cosy.wrap", 900), f("cosy.tuck", 800), f("cosy.mug", 1400)]),
  scene("cosy.sip", "idle", [f("cosy.blow", 700), f("cosy.sip", 1000), f("cosy.sigh", 1400)]),
  scene("cosy.offer", "waving", [f("cosy.offer", 1500)]),

  scene("rain", "waiting", [
    f("rain.check", 1200),
    f("rain.open", 500),
    ...swing("rain.under-a", "rain.under-b", 500, 3),
  ]),
  scene("rain.under", "idle", [
    ...swing("rain.under-a", "rain.under-b", 600, 4),
    f("rain.shoulder", 1500),
  ]),
  scene("rain.feel", "waiting", [f("rain.feel", 1600), f("rain.close", 900)]),

  scene("downpour", "jumping", [
    f("downpour.brace", 1400),
    f("downpour.hop", 450),
    f("downpour.stomp", 600),
    f("downpour.dance", 1500),
  ]),
  scene("downpour.oops", "failed", [
    f("downpour.oops", 1400),
    f("downpour.shake", 900),
    f("downpour.wring", 1200),
  ]),

  scene("storm", "jumping", [f("storm.flinch", 900), f("storm.jump", 500), f("storm.hug", 1300)]),
  scene("storm.umbrella", "failed", [
    f("storm.flipped", 900),
    f("storm.tug", 900),
    f("storm.flipped", 600),
    f("storm.brave", 1400),
  ]),
  scene("storm.peek", "waiting", [f("storm.peek", 1200), f("storm.brave", 1200)]),

  scene("snow", "review", [f("snow.catch", 1200), f("snow.tongue", 1500)]),
  scene("snow.ball", "jumping", [
    f("snow.scoop", 700),
    f("snow.ball", 800),
    f("snow.throw", 500),
    f("snow.thrill", 1200),
  ]),
  scene("snow.star", "jumping", [f("snow.star", 1600)]),

  scene("wind", "waiting", [
    ...swing("wind.lean-a", "wind.lean-b", 220, 4),
    f("wind.grab", 1000),
    f("wind.phew", 1200),
  ]),
  scene("wind.brace", "waiting", [
    f("wind.brace", 1300),
    f("wind.squint", 1200),
    f("wind.collar", 1000),
  ]),

  scene("grey", "waiting", [
    f("grey.peer", 1200),
    ...swing("grey.clear-a", "grey.clear-b", 260, 3),
    f("grey.up", 1200),
  ]),
  scene("grey.shape", "review", [f("grey.shape", 1500), f("grey.shrug", 1100)]),
  scene("grey.dream", "idle", [f("grey.dream", 2000)]),

  scene("stars", "waiting", [f("stars.gaze", 1500), f("stars.point", 1300), f("stars.moon", 1300)]),
  scene("stars.scope", "waiting", [f("stars.scope", 1800), f("stars.amazed", 1200)]),
  scene("stars.wish", "idle", [f("stars.wish", 2000), f("stars.night", 1200)]),

  scene("dust", "failed", [f("dust.elbow", 1400), f("dust.squint", 1100), f("dust.brush", 1000)]),
  scene("dust.cough", "failed", [f("dust.cough", 800), f("dust.rub", 1000), f("dust.shake", 1000)]),
  scene("dust.mask", "waiting", [f("dust.mask", 1800)]),

  // ── The visitor's time of day ───────────────────────────────────────────
  scene("coffee", "waiting", [
    f("coffee.hold", 1200),
    f("coffee.blow", 700),
    f("coffee.sip", 1000),
    f("coffee.awake", 900),
    f("coffee.cheers", 1200),
  ]),
  scene("coffee.yawn", "waiting", [f("coffee.yawn", 1300), f("coffee.go", 1000)]),

  scene("breakfast", "review", [
    f("breakfast.hold", 900),
    f("breakfast.bite", 600),
    f("breakfast.chew", 1300),
    f("breakfast.yum", 1000),
  ]),
  scene("breakfast.offer", "waving", [
    f("breakfast.offer", 1400),
    f("breakfast.crumbs", 1000),
    f("breakfast.done", 1200),
  ]),

  scene("koshary", "review", [
    f("koshary.sniff", 1100),
    f("koshary.eat", 700),
    f("koshary.chew", 1100),
    f("koshary.spicy", 1300),
  ]),
  scene("koshary.more", "review", [
    f("koshary.more", 800),
    f("koshary.eat", 600),
    f("koshary.full", 1300),
  ]),
  scene("koshary.drowsy", "waiting", [f("koshary.drowsy", 2000)]),

  scene("evening", "review", [
    f("evening.type", 1000),
    f("evening.close", 700),
    f("evening.watch", 1000),
    f("evening.stretch", 1300),
    f("evening.sigh", 1200),
  ]),
  scene("evening.wave", "waving", [f("evening.wave", 1300), f("evening.home", 900)]),

  scene("late", "waiting", [f("late.rub", 900), f("late.watch", 1400), f("late.sleep-sign", 1600)]),
  scene("late.pillow", "waiting", [
    f("late.pillow", 1300),
    f("late.cheek", 1500),
    f("late.nod", 1200),
    f("late.jolt", 700),
  ]),

  scene("weekend", "jumping", [
    f("weekend.shake", 900),
    f("weekend.roll", 400),
    f("weekend.win", 1200),
  ]),
  scene("weekend.read", "review", [f("weekend.read", 1600), f("weekend.peek", 1200)]),
  scene("weekend.lazy", "idle", [f("weekend.lazy", 2200), f("weekend.wave", 1000)]),

  // ── Ramadan and the Eids ─────────────────────────────────────────────────
  scene("fanous", "waving", [
    f("fanous.hold", 1000),
    ...swing("fanous.swing-a", "fanous.swing-b", 450, 3),
    f("fanous.greet", 1500),
  ]),
  scene("fanous.offer", "waving", [f("fanous.offer", 1500), f("fanous.hug", 1300)]),
  scene("fanous.raise", "jumping", [f("fanous.raise", 1600)]),

  scene("iftar", "waiting", [
    f("iftar.watch", 1300),
    f("iftar.wait", 1300),
    f("iftar.cannon", 600),
    f("iftar.date", 1200),
    f("iftar.drink", 1300),
    f("iftar.full", 1200),
  ]),
  scene("iftar.offer", "waving", [f("iftar.offer", 1600)]),

  scene("suhoor", "jumping", [
    ...swing("suhoor.drum-a", "suhoor.drum-b", 240, 5),
    f("suhoor.call", 1200),
  ]),
  scene("suhoor.knock", "waiting", [f("suhoor.knock", 1000), f("suhoor.yawn", 1300)]),
  scene("suhoor.eat", "review", [f("suhoor.eat", 1500), f("suhoor.done", 1200)]),

  scene("sweets", "review", [f("sweets.tray", 1200), f("sweets.offer", 1400)]),
  scene("sweets.qatayef", "review", [
    f("sweets.qatayef", 1000),
    f("sweets.bite", 900),
    f("sweets.lick", 1100),
  ]),
  scene("sweets.more", "review", [f("sweets.sneak", 1100), f("sweets.full", 1300)]),

  scene("kahk", "review", [
    f("kahk.plate", 1000),
    f("kahk.bite", 700),
    f("kahk.sugar", 1000),
    f("kahk.dust", 1100),
    f("kahk.greet", 1500),
  ]),
  scene("kahk.offer", "waving", [f("kahk.offer", 1400), f("kahk.two", 1200)]),

  scene("eid", "jumping", [
    f("eid.balloons", 1000),
    f("eid.tiptoe", 800),
    f("eid.cheer", 1200),
    f("eid.wave", 1200),
  ]),
  scene("eid.give", "waving", [f("eid.give", 1500), f("eid.wink", 1000)]),
  scene("eid.hug", "waving", [f("eid.hug", 1600)]),

  scene("adha", "review", [
    f("adha.sheep", 1000),
    f("adha.show", 1200),
    f("adha.hug", 1300),
    f("adha.greet", 1500),
  ]),
  scene("adha.fatta", "review", [
    f("adha.fatta", 1100),
    f("adha.eat", 1000),
    f("adha.share", 1400),
  ]),

  // ── Islamic days ─────────────────────────────────────────────────────────
  scene("blessed", "waiting", [
    f("blessed.crescent", 1300),
    f("blessed.sky", 1500),
    f("blessed.greet", 1500),
  ]),
  scene("blessed.hang", "jumping", [f("blessed.hang", 1300), f("blessed.crescent", 900)]),
  scene("blessed.calm", "idle", [f("blessed.beads", 1800), f("blessed.heart", 1500)]),
  scene("blessed.ashura", "review", [f("blessed.ashura", 1600)]),

  scene("mawlid", "review", [
    f("mawlid.doll", 1200),
    f("mawlid.admire", 1300),
    f("mawlid.greet", 1300),
  ]),
  scene("mawlid.box", "review", [
    f("mawlid.box", 1000),
    f("mawlid.pick", 700),
    f("mawlid.crunch", 1100),
    f("mawlid.offer", 1400),
  ]),

  // ── Coptic days and spring ───────────────────────────────────────────────
  scene("xmas", "jumping", [
    f("xmas.gift", 900),
    f("xmas.shake", 1000),
    f("xmas.give", 1400),
    f("xmas.wave", 1200),
  ]),
  scene("xmas.open", "jumping", [f("xmas.open", 1600)]),
  scene("xmas.star", "jumping", [f("xmas.star", 1100), f("xmas.hang", 1300)]),

  scene("eggs", "review", [f("eggs.paint", 1500), f("eggs.show", 1300)]),
  scene("eggs.basket", "waving", [f("eggs.basket", 1100), f("eggs.offer", 1400)]),
  scene("eggs.game", "jumping", [f("eggs.tap", 900), f("eggs.cracked", 1300), f("eggs.toss", 900)]),

  scene("picnic", "jumping", [
    f("picnic.kite", 900),
    f("picnic.fly", 1800),
    f("picnic.breeze", 1400),
  ]),
  scene("picnic.fish", "jumping", [
    f("picnic.onion", 1100),
    f("picnic.fish", 1200),
    f("picnic.brave", 1100),
  ]),
  scene("picnic.daisy", "idle", [f("picnic.daisy", 1600)]),

  scene("nayrouz", "review", [
    f("nayrouz.dates", 1100),
    f("nayrouz.bite", 900),
    f("nayrouz.wave", 1300),
  ]),
  scene("nayrouz.guava", "review", [
    f("nayrouz.smell", 1100),
    f("nayrouz.guava", 1000),
    f("nayrouz.toss", 800),
    f("nayrouz.offer", 1200),
  ]),

  // ── Egyptian national days ───────────────────────────────────────────────
  scene("flag", "jumping", [...swing("flag.wave-a", "flag.wave-b", 300, 4), f("flag.heart", 1400)]),
  scene("flag.salute", "review", [f("flag.salute", 1500), f("flag.cheer", 1100)]),
  scene("flag.show", "waving", [
    f("flag.show", 1500),
    ...times(2, f("flag.march", 350), f("flag.heart", 350)),
    f("flag.cheer", 1000),
  ]),

  scene("fireworks", "jumping", [
    f("fireworks.awe", 1400),
    f("fireworks.point", 1100),
    f("fireworks.ears", 900),
    f("fireworks.clap", 1200),
    f("fireworks.wow", 1200),
  ]),
  scene("fireworks.sparkler", "jumping", [
    ...swing("fireworks.spark-a", "fireworks.spark-b", 300, 4),
    f("fireworks.wow", 1000),
  ]),

  // ── International days ───────────────────────────────────────────────────
  scene("newyear", "jumping", [
    f("newyear.hat", 900),
    f("newyear.three", 700),
    f("newyear.two", 700),
    f("newyear.one", 700),
    f("newyear.pop", 700),
    f("newyear.cheer", 1200),
  ]),
  scene("newyear.horn", "jumping", [f("newyear.horn", 1300), f("newyear.cheer", 900)]),

  scene("flowers", "waving", [
    f("flowers.hide", 1100),
    f("flowers.give", 1600),
    f("flowers.blush", 1100),
  ]),
  scene("flowers.smell", "idle", [f("flowers.smell", 1300), f("flowers.rose", 1300)]),
  scene("flowers.heart", "review", [f("flowers.card", 1200), f("flowers.heart", 1400)]),

  scene("green", "review", [f("green.water", 1500), f("green.pot", 1200), f("green.thumbs", 1000)]),
  scene("green.globe", "review", [
    f("green.globe", 1200),
    f("green.spin", 1200),
    f("green.show", 1300),
  ]),
  scene("green.plant", "idle", [f("green.plant", 1600), f("green.thumbs", 900)]),

  scene("spooky", "jumping", [
    f("spooky.pumpkin", 1100),
    f("spooky.boo", 900),
    f("spooky.laugh", 1100),
  ]),
  scene("spooky.ghost", "jumping", [
    f("spooky.ghost", 1600),
    f("spooky.reveal", 1200),
    f("spooky.laugh", 900),
  ]),
  scene("spooky.treat", "waving", [f("spooky.hide", 1100), f("spooky.treat", 1400)]),

  scene("prank", "jumping", [
    f("prank.disguise", 1600),
    f("prank.wink", 1100),
    f("prank.gotcha", 1200),
  ]),
  scene("prank.sly", "review", [f("prank.sly", 1500), f("prank.laugh", 1200)]),
  scene("prank.pie", "review", [f("prank.pie", 1200), f("prank.slice", 1300)]),

  scene("work", "review", [f("work.hat", 900), f("work.wrench", 1200), f("work.flex", 1300)]),
  scene("work.teach", "review", [
    f("work.books", 1100),
    f("work.chalk", 1500),
    f("work.thanks", 1300),
    f("work.clap", 1100),
  ]),

  // ── Seasons ──────────────────────────────────────────────────────────────
  scene("summer", "jumping", [
    f("summer.ball", 900),
    f("summer.toss", 600),
    f("summer.ball", 700),
    f("summer.thumbs", 1100),
  ]),
  scene("summer.melon", "review", [
    f("summer.melon", 900),
    f("summer.bite", 1100),
    f("summer.wipe", 1100),
  ]),
  scene("summer.cream", "idle", [f("summer.cream", 1600)]),

  scene("school", "waving", [
    f("school.pack", 900),
    f("school.ready", 1300),
    f("school.wave", 1100),
  ]),
  scene("school.notes", "review", [
    f("school.read", 1100),
    f("school.write", 1300),
    f("school.idea", 1100),
  ]),
  scene("school.goofy", "review", [f("school.goofy", 1600)]),

  scene("winter", "idle", [
    f("winter.sahlab", 1300),
    f("winter.sip", 1000),
    f("winter.foam", 1300),
  ]),
  scene("winter.batata", "review", [
    f("winter.hot", 1200),
    f("winter.blow", 900),
    f("winter.bite", 1000),
    f("winter.offer", 1300),
  ]),

  // ── Toolkit moments ──────────────────────────────────────────────────────
  scene("sticky", "review", [
    f("sticky.write", 1100),
    f("sticky.stick", 1100),
    f("sticky.idea", 1000),
  ]),
  scene("sticky.goofy", "jumping", [f("sticky.forehead", 1400), f("sticky.peel", 1000)]),
  scene("sticky.think", "running", [f("sticky.think", 1500), f("sticky.hand", 1200)]),

  scene("poker", "running", [
    f("poker.fan", 1000),
    f("poker.think", 1200),
    f("poker.pick", 600),
    f("poker.secret", 1200),
  ]),
  scene("poker.reveal", "jumping", [
    f("poker.reveal", 1100),
    f("poker.surprise", 1200),
    f("poker.agree", 1000),
  ]),
  scene("poker.agree", "review", [f("poker.agree", 1300)]),

  scene("timer", "waiting", [f("timer.start", 900), f("timer.check", 1100)]),
  scene("timer.done", "jumping", [
    f("timer.alarm", 1000),
    f("timer.stop", 1100),
    f("timer.tap", 1100),
  ]),
  scene("timer.standup", "jumping", [f("timer.catch", 800), f("timer.pass", 700)]),

  scene("ship", "jumping", [f("ship.trophy", 1300), f("ship.hug", 1200), f("ship.bow", 1300)]),
  scene("ship.rocket", "jumping", [
    f("ship.rocket", 900),
    f("ship.launch", 500),
    f("ship.watch", 1300),
    f("ship.dance", 1100),
  ]),

  scene("focus", "running", [
    ...swing("focus.type-a", "focus.type-b", 160, 6),
    f("focus.eureka", 1100),
  ]),
  scene("focus.music", "idle", [f("focus.phones", 900), f("focus.groove", 2000)]),
  scene("focus.stretch", "waiting", [f("focus.neck", 1400), f("focus.notes", 1300)]),

  scene("kudos", "waving", [f("kudos.star", 1100), f("kudos.give", 1400), f("kudos.you", 1100)]),
  scene("kudos.got", "review", [
    f("kudos.card", 1400),
    f("kudos.thanks", 1200),
    f("kudos.pin", 1200),
  ]),
  scene("kudos.clap", "review", [f("kudos.clap", 1300)]),

  // ── Play and the device ──────────────────────────────────────────────────
  scene("ball", "jumping", [
    f("ball.hold", 800),
    ...times(3, f("ball.knee", 350), f("ball.head", 350)),
    f("ball.goal", 1300),
  ]),
  scene("ball.kick", "jumping", [f("ball.kick", 500), f("ball.goal", 1200), f("ball.knees", 1200)]),
  scene("ball.spin", "review", [f("ball.spin", 1600)]),

  scene("reading", "review", [
    f("reading.open", 1300),
    f("reading.turn", 600),
    f("reading.open", 1000),
    f("reading.laugh", 1300),
  ]),
  scene("reading.show", "waving", [f("reading.show", 1500), f("reading.cover", 1300)]),
  scene("reading.hug", "review", [f("reading.hug", 1500)]),
  scene("reading.doze", "waiting", [f("reading.doze", 2400)]),

  scene("music", "jumping", [
    ...swing("music.oud-a", "music.oud-b", 320, 5),
    f("music.sing", 1300),
    f("music.bow", 1100),
  ]),
  scene("music.drum", "jumping", [
    ...swing("music.drum-a", "music.drum-b", 200, 6),
    f("music.dance", 1000),
  ]),

  scene("phone", "review", [f("phone.selfie", 1100), f("phone.peace", 1200)]),
  scene("phone.scroll", "waiting", [f("phone.scroll", 1500), f("phone.wow", 1000)]),
  scene("phone.low", "failed", [f("phone.low", 1500), f("phone.plug", 1300)]),
  scene("phone.charged", "review", [f("phone.charged", 1300)]),

  scene("lights.dark", "jumping", [
    f("lights.dark", 900),
    f("lights.torch", 1000),
    f("lights.sweep", 1100),
    f("lights.ok", 900),
  ]),
  scene("lights.spooky", "jumping", [f("lights.spooky", 1500)]),
  scene("lights.light", "jumping", [f("lights.dazzled", 1000), f("lights.shades", 1300)]),
];

/** Every scene, by name (`sun`, `rain.under`, `poker.reveal`, …). */
export const SCENES: Readonly<Record<string, Clip>> = Object.fromEntries(LIST);

export type SceneName = string;

/** The reaction that plays a scene. */
export const sceneReaction = (name: SceneName) => `scene:${name}` as const;
