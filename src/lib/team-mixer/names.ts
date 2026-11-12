/**
 * Fun names for groups, without AI: short themed word lists of our own, and
 * a pick from them for a theme someone typed ("planets", "trees"). A theme
 * the lists don't know gets a list at random. Names only: nothing here
 * reads who is in a group.
 *
 * Seeded through src/lib/utils/random.ts. Pure and server-safe.
 */

import { createRng, pick, shuffle, type Rng } from "@/lib/utils/random";
import { MIXER_LIMITS } from "./model";

export interface NameTheme {
  id: string;
  label: string;
  /** Words that point at this theme when typed. */
  match: readonly string[];
  names: readonly string[];
}

export const NAME_THEMES: readonly NameTheme[] = [
  {
    id: "planets",
    label: "Planets and moons",
    match: ["planet", "space", "moon", "solar", "star", "astro"],
    names: [
      "Mercury",
      "Venus",
      "Mars",
      "Jupiter",
      "Saturn",
      "Neptune",
      "Uranus",
      "Titan",
      "Europa",
      "Io",
      "Ganymede",
      "Callisto",
    ],
  },
  {
    id: "rivers",
    label: "Rivers",
    match: ["river", "water", "stream", "flow"],
    names: [
      "Nile",
      "Amazon",
      "Danube",
      "Mekong",
      "Volga",
      "Rhine",
      "Indus",
      "Zambezi",
      "Ganges",
      "Yukon",
      "Seine",
      "Tigris",
    ],
  },
  {
    id: "mountains",
    label: "Mountains",
    match: ["mountain", "peak", "summit", "hill", "climb"],
    names: [
      "Everest",
      "Kilimanjaro",
      "Denali",
      "Fuji",
      "Elbrus",
      "Matterhorn",
      "Aconcagua",
      "Etna",
      "Olympus",
      "Rainier",
      "Sinai",
      "Atlas",
    ],
  },
  {
    id: "trees",
    label: "Trees",
    match: ["tree", "forest", "wood", "leaf", "nature"],
    names: [
      "Oak",
      "Maple",
      "Cedar",
      "Birch",
      "Willow",
      "Pine",
      "Olive",
      "Palm",
      "Baobab",
      "Cypress",
      "Aspen",
      "Elm",
    ],
  },
  {
    id: "birds",
    label: "Birds",
    match: ["bird", "wing", "fly", "flight", "sky"],
    names: [
      "Falcon",
      "Heron",
      "Owl",
      "Robin",
      "Swift",
      "Kestrel",
      "Pelican",
      "Puffin",
      "Sparrow",
      "Wren",
      "Ibis",
      "Kingfisher",
    ],
  },
  {
    id: "colours",
    label: "Colours",
    match: ["colour", "color", "paint", "shade", "rainbow"],
    names: [
      "Amber",
      "Cobalt",
      "Coral",
      "Crimson",
      "Indigo",
      "Jade",
      "Lime",
      "Ochre",
      "Saffron",
      "Teal",
      "Violet",
      "Silver",
    ],
  },
  {
    id: "spices",
    label: "Spices",
    match: ["spice", "food", "cook", "kitchen", "flavour", "flavor"],
    names: [
      "Cardamom",
      "Cinnamon",
      "Cumin",
      "Ginger",
      "Nutmeg",
      "Paprika",
      "Sumac",
      "Turmeric",
      "Vanilla",
      "Clove",
      "Fennel",
      "Pepper",
    ],
  },
  {
    id: "weather",
    label: "Weather",
    match: ["weather", "storm", "wind", "cloud", "rain", "season"],
    names: [
      "Breeze",
      "Thunder",
      "Drizzle",
      "Sunbeam",
      "Monsoon",
      "Frost",
      "Rainbow",
      "Mist",
      "Hail",
      "Gale",
      "Dew",
      "Aurora",
    ],
  },
];

/**
 * The theme a typed word points at, or null. A start of a word counts
 * ("riv" is rivers) once it is 3 letters, so a single letter doesn't always
 * land on the first list.
 */
export function themeFor(text: string): NameTheme | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return (
    NAME_THEMES.find(
      (th) =>
        th.id === t ||
        th.label.toLowerCase() === t ||
        th.match.some((w) => t.includes(w) || (t.length >= 3 && w.startsWith(t)))
    ) ?? null
  );
}

/**
 * `count` different names for groups, from the theme `text` points at (or
 * one picked at random). Past a list's length the names repeat with a
 * number: "Oak 2".
 */
export function suggestGroupNames(
  text: string,
  count: number,
  rng: Rng = createRng()
): { theme: NameTheme; names: string[] } {
  const theme = themeFor(text) ?? pick(NAME_THEMES, { rng })!;
  const n = Math.max(0, Math.min(Math.floor(count), MIXER_LIMITS.groups));
  const order = shuffle(theme.names, rng);
  const names = Array.from({ length: n }, (_, i) => {
    const base = order[i % order.length];
    const lap = Math.floor(i / order.length);
    return (lap === 0 ? base : `${base} ${lap + 1}`).slice(0, MIXER_LIMITS.groupName);
  });
  return { theme, names };
}
