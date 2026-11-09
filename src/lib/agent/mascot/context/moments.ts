/**
 * What's going on for the visitor right now, as Amr's scenes see it: Cairo's
 * occasion of the day (occasions.ts), the weather where they are (weather.ts),
 * their own time of day and week, the season, and the page. Each moment lists
 * its scenes (engine/scenes.ts), the greeting first. Pure: the clock, the
 * weather and the page are passed in.
 *
 * During Ramadan, daytime food is left out: Amr fasts, and breaks his fast at
 * sunset with the iftar scenes.
 */

import { occasionsOn, OCCASION_PRIORITY, type OccasionId } from "./occasions";
import { CAIRO, sunTimes } from "./sun";
import { toolForPath } from "./tool-scenes";
import { weatherMoment, type WeatherMoment, type WeatherNow } from "./weather";

export interface Moment {
  id: string;
  kind: "occasion" | "weather" | "time" | "season" | "page";
  /** Higher greets first. */
  priority: number;
  /** Scene names, the greeting first. */
  scenes: readonly string[];
}

/** Each occasion's scenes, the greeting first. */
export const OCCASION_SCENES: Record<OccasionId, readonly string[]> = {
  ramadan: ["fanous", "fanous.offer", "fanous.raise"],
  "eid-fitr": ["kahk", "eid", "eid.give", "eid.hug", "kahk.offer"],
  "eid-adha": ["adha", "eid", "adha.fatta", "eid.give", "eid.hug"],
  arafah: ["blessed", "blessed.calm"],
  "hijri-new-year": ["blessed", "blessed.hang", "blessed.calm"],
  ashura: ["blessed.ashura", "blessed.calm"],
  "isra-miraj": ["blessed", "blessed.calm"],
  "mid-shaban": ["blessed", "blessed.calm", "blessed.hang"],
  mawlid: ["mawlid", "mawlid.box"],
  "jan-25": ["flag", "flag.salute", "flag.show"],
  "sinai-liberation": ["flag", "flag.salute", "flag.show"],
  "jun-30": ["flag", "flag.salute", "flag.show"],
  "jul-23": ["flag", "flag.salute", "flag.show"],
  "suez-canal": ["flag", "flag.salute", "flag.show"],
  "oct-6": ["flag", "flag.salute", "flag.show"],
  "coptic-christmas": ["xmas", "xmas.open", "kahk.offer", "xmas.star"],
  "coptic-easter": ["eggs", "eggs.basket", "eggs.game"],
  "sham-el-nessim": ["picnic", "eggs.game", "picnic.fish", "picnic.daisy"],
  nayrouz: ["nayrouz", "nayrouz.guava"],
  "new-year": ["newyear", "newyear.horn"],
  nye: ["newyear", "newyear.horn"],
  christmas: ["xmas", "xmas.star", "xmas.open"],
  valentine: ["flowers", "flowers.heart", "flowers.smell"],
  "womens-day": ["flowers", "flowers.smell"],
  "mothers-day": ["flowers", "flowers.smell", "flowers.heart"],
  "earth-day": ["green", "green.globe", "green.plant"],
  "environment-day": ["green", "green.plant", "green.globe"],
  "peace-day": ["green.globe", "green"],
  "labour-day": ["work"],
  "teachers-day": ["work.teach"],
  "pi-day": ["prank.pie"],
  "april-fools": ["prank", "prank.sly"],
  halloween: ["spooky", "spooky.ghost", "spooky.treat"],
};

export const WEATHER_SCENES: Record<WeatherMoment, readonly string[]> = {
  sun: ["sun", "sun.bask", "sun.look", "sun.peek"],
  heat: ["heat", "heat.drink", "heat.wilt"],
  scorch: ["scorch", "scorch.cool", "scorch.fan", "heat.drink"],
  cold: ["cold", "cosy", "cosy.sip", "cold.hunch", "cold.sneeze", "cosy.offer"],
  rain: ["rain", "rain.under", "rain.feel"],
  downpour: ["downpour", "downpour.oops", "rain.under"],
  storm: ["storm", "storm.umbrella", "storm.peek"],
  snow: ["snow", "snow.ball", "snow.star", "cold"],
  wind: ["wind", "wind.brace"],
  grey: ["grey", "grey.shape", "grey.dream"],
  stars: ["stars", "stars.scope", "stars.wish"],
  dust: ["dust", "dust.cough", "dust.mask"],
};

/** Striking weather greets before the visitor's time of day; a nice day after it. */
const WEATHER_PRIORITY: Record<WeatherMoment, number> = {
  storm: 36,
  snow: 36,
  downpour: 35,
  dust: 35,
  scorch: 34,
  wind: 30,
  rain: 30,
  cold: 28,
  heat: 28,
  grey: 18,
  sun: 18,
  stars: 18,
};

/** A tool page's greeting outranks the weather (up to 36) and the hour, not the day's occasion. */
export const TOOL_PRIORITY = 38;

/** The page's own scenes (tools' pages come from tool-scenes.ts). */
const PAGE_SCENES: Array<{ id: string; match: (path: string) => boolean; scenes: string[] }> = [
  {
    id: "comics",
    match: (p) => p === "/comics" || p.startsWith("/comics/"),
    scenes: ["reading", "reading.show", "reading.hug"],
  },
];

/** Scenes he plays to pass the time when the visitor is idle, whatever the day. */
export const PLAY_SCENES: readonly string[] = [
  "ball",
  "ball.kick",
  "ball.spin",
  "music",
  "music.drum",
  "phone",
  "phone.scroll",
  "reading.doze",
];

export interface MomentInput {
  now: Date;
  /** The visitor's weather, or null when it isn't known. */
  weather: WeatherNow | null;
  /** The page's path. */
  path: string;
  /** The visitor's weekend days (0 = Sunday). */
  weekend: readonly number[];
}

const hoursOf = (d: Date) => d.getHours() + d.getMinutes() / 60;

/** Sunset today for the visitor, or Cairo's when their weather isn't known. */
function sunsetFor(input: MomentInput): Date | null {
  if (input.weather?.sunset) return new Date(input.weather.sunset);
  if (input.weather && input.weather.sunset === null) return null;
  return sunTimes(input.now, CAIRO.lat, CAIRO.lon).set;
}

/** Everything that's on now, the most important first. */
export function momentsNow(input: MomentInput): Moment[] {
  const { now } = input;
  const out: Moment[] = [];
  const occasions = occasionsOn(now);
  const ramadan = occasions.includes("ramadan");
  const hour = hoursOf(now);
  const evening = hour >= 19;

  for (const id of occasions) {
    out.push({
      id,
      kind: "occasion",
      priority: OCCASION_PRIORITY[id],
      scenes: OCCASION_SCENES[id],
    });
  }

  // Ramadan's hours: iftar at sunset, sweets after it, the drum before dawn.
  if (ramadan) {
    const sunset = sunsetFor(input);
    if (sunset) {
      const fromSunset = (now.getTime() - sunset.getTime()) / 60_000;
      if (fromSunset >= -20 && fromSunset < 60) {
        out.push({ id: "iftar", kind: "occasion", priority: 99, scenes: ["iftar", "iftar.offer"] });
      } else if (fromSunset >= 60) {
        out.push({
          id: "ramadan-night",
          kind: "occasion",
          priority: 41,
          scenes: ["sweets", "sweets.qatayef", "sweets.more"],
        });
      }
    }
    if (hour >= 1 && hour < 4.5) {
      out.push({
        id: "suhoor",
        kind: "occasion",
        priority: 97,
        scenes: ["suhoor", "suhoor.knock", "suhoor.eat"],
      });
    }
  }

  // Fireworks on a festive evening.
  const festive = occasions.some((o) =>
    [
      "eid-fitr",
      "eid-adha",
      "nye",
      "jan-25",
      "sinai-liberation",
      "jun-30",
      "jul-23",
      "suez-canal",
      "oct-6",
    ].includes(o)
  );
  if (festive && evening) {
    out.push({
      id: "fireworks",
      kind: "occasion",
      priority: 83,
      scenes: ["fireworks", "fireworks.sparkler"],
    });
  }

  const w = input.weather ? weatherMoment(input.weather) : null;
  if (w)
    out.push({
      id: `weather:${w}`,
      kind: "weather",
      priority: WEATHER_PRIORITY[w],
      scenes: WEATHER_SCENES[w],
    });

  for (const page of PAGE_SCENES) {
    if (page.match(input.path))
      out.push({ id: page.id, kind: "page", priority: 32, scenes: page.scenes });
  }
  // A tool's page: he greets you with its props, ahead of the weather and the hour.
  const tool = toolForPath(input.path);
  if (tool && tool.open.length)
    out.push({
      id: `tool:${tool.toolId}`,
      kind: "page",
      priority: TOOL_PRIORITY,
      scenes: tool.open,
    });

  // The visitor's own clock.
  const weekend = input.weekend.includes(now.getDay());
  const time = (id: string, priority: number, scenes: string[]) =>
    out.push({ id, kind: "time", priority, scenes });
  if (hour < 4) time("late", 24, ["late", "late.pillow"]);
  if (!ramadan) {
    if (hour >= 5 && hour < 10) time("coffee", 22, ["coffee", "coffee.yawn"]);
    if (hour >= 7 && hour < 11) time("breakfast", 21, ["breakfast", "breakfast.offer"]);
    if (hour >= 12.5 && hour < 15) time("lunch", 21, ["koshary", "koshary.more", "koshary.drowsy"]);
  }
  if (!weekend && hour >= 17 && hour < 20) time("evening", 20, ["evening", "evening.wave"]);
  if (weekend && hour >= 10 && hour < 22)
    time("weekend", 19, ["weekend", "weekend.read", "weekend.lazy"]);

  // The season, the other way round south of the equator.
  const south = input.weather?.south === true;
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const season = (id: string, scenes: string[]) =>
    out.push({ id, kind: "season", priority: 10, scenes });
  const winter = south ? month >= 6 && month <= 8 : month === 12 || month <= 2;
  const summer = south ? month === 1 || month === 2 : month === 7 || month === 8;
  if (winter) season("winter", ["winter", "winter.batata"]);
  if (summer) season("summer", ["summer", "summer.melon", "summer.cream"]);
  if (!south && ((month === 9 && day >= 15) || (month === 10 && day <= 10))) {
    season("school", ["school", "school.notes", "school.goofy"]);
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/**
 * The visitor's weekend days. Egypt rests on Friday and Saturday; elsewhere the
 * browser's locale says, when it can, and Saturday and Sunday otherwise.
 */
export function visitorWeekend(): number[] {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Africa/Cairo") return [5, 6];
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { weekend: number[] };
      weekInfo?: { weekend: number[] };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    // Intl numbers the days 1 (Monday) to 7 (Sunday).
    if (info?.weekend?.length && locale.region) return info.weekend.map((d) => d % 7);
  } catch {
    /* fall through */
  }
  return [6, 0];
}
