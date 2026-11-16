/**
 * Themed word lists for team and sprint names: planets, rivers, cities,
 * mountains and more. Our own short lists of place names, sky names, plain
 * nouns and famous inventors and scientists of the past. The one home of
 * the toolkit's themed lists: Picker draws from them, Team Mixer's "Suggest
 * names" draws group names from them (lib/team-mixer/names), and they are
 * what the `picker.theme_names` AI task falls back to when there is no
 * model (Team Mixer reuses that task too), so every button names from the
 * same lists.
 *
 * Pure: draws take an optional seeded `rng`.
 */

import { createRng, hashSeed, shuffle, type Rng } from "@/lib/utils/random";

export interface NameTheme {
  id: string;
  label: string;
  /** Words in a typed theme that point to this list ("space" → planets). */
  keywords: readonly string[];
  names: readonly string[];
}

export const NAME_THEMES: readonly NameTheme[] = [
  {
    id: "planets",
    label: "Planets and moons",
    keywords: ["planet", "moon", "space", "solar", "orbit", "astro", "cosmos"],
    names: [
      "Mercury",
      "Venus",
      "Earth",
      "Mars",
      "Jupiter",
      "Saturn",
      "Uranus",
      "Neptune",
      "Pluto",
      "Ceres",
      "Eris",
      "Haumea",
      "Makemake",
      "Titan",
      "Europa",
      "Ganymede",
      "Callisto",
      "Io",
      "Triton",
      "Phobos",
      "Deimos",
      "Enceladus",
      "Oberon",
      "Charon",
    ],
  },
  {
    id: "rivers",
    label: "Rivers",
    keywords: ["river", "water", "stream", "flow", "delta"],
    names: [
      "Nile",
      "Amazon",
      "Danube",
      "Thames",
      "Volga",
      "Ganges",
      "Mekong",
      "Rhine",
      "Seine",
      "Indus",
      "Tigris",
      "Euphrates",
      "Zambezi",
      "Yukon",
      "Niger",
      "Congo",
      "Orinoco",
      "Loire",
      "Douro",
      "Shannon",
      "Tagus",
      "Jordan",
      "Hudson",
      "Murray",
    ],
  },
  {
    id: "cities",
    label: "Cities",
    keywords: ["city", "cities", "town", "capital", "travel", "place"],
    names: [
      "Cairo",
      "Lisbon",
      "Kyoto",
      "Oslo",
      "Lima",
      "Nairobi",
      "Quito",
      "Hanoi",
      "Dakar",
      "Porto",
      "Seville",
      "Bergen",
      "Tbilisi",
      "Cusco",
      "Accra",
      "Valletta",
      "Riga",
      "Tallinn",
      "Muscat",
      "Busan",
      "Medellín",
      "Kraków",
      "Ghent",
      "Luxor",
    ],
  },
  {
    id: "mountains",
    label: "Mountains",
    keywords: ["mountain", "peak", "summit", "climb", "hill", "alp"],
    names: [
      "Everest",
      "Kilimanjaro",
      "Denali",
      "Elbrus",
      "Fuji",
      "Olympus",
      "Aconcagua",
      "Matterhorn",
      "Kenya",
      "Toubkal",
      "Etna",
      "Rainier",
      "Mont Blanc",
      "Sinai",
      "Ararat",
      "Kosciuszko",
      "Logan",
      "Eiger",
      "Aoraki",
      "Teide",
      "Vinson",
      "Whitney",
      "Shasta",
      "Snowdon",
    ],
  },
  {
    id: "inventors",
    label: "Inventors and scientists",
    keywords: ["invent", "scien", "engineer", "genius", "pioneer", "discover"],
    names: [
      "Tesla",
      "Curie",
      "Lovelace",
      "Turing",
      "Edison",
      "Hopper",
      "Bell",
      "Faraday",
      "Hypatia",
      "Ibn Sina",
      "Al-Jazari",
      "Babbage",
      "Franklin",
      "Galileo",
      "Kepler",
      "Newton",
      "Darwin",
      "Pasteur",
      "Noether",
      "Lamarr",
      "Volta",
      "Watt",
      "Diesel",
      "Al-Khwarizmi",
    ],
  },
  {
    id: "colours",
    label: "Colours",
    keywords: ["colour", "color", "paint", "shade", "hue", "rainbow"],
    names: [
      "Amber",
      "Cobalt",
      "Crimson",
      "Indigo",
      "Jade",
      "Saffron",
      "Teal",
      "Ochre",
      "Scarlet",
      "Cyan",
      "Magenta",
      "Olive",
      "Ivory",
      "Coral",
      "Sienna",
      "Violet",
      "Umber",
      "Cerulean",
      "Vermilion",
      "Mauve",
      "Lilac",
      "Slate",
      "Sage",
      "Russet",
    ],
  },
  {
    id: "birds",
    label: "Birds",
    keywords: ["bird", "wing", "fly", "flight", "feather"],
    names: [
      "Falcon",
      "Heron",
      "Kestrel",
      "Osprey",
      "Puffin",
      "Robin",
      "Swift",
      "Wren",
      "Kingfisher",
      "Owl",
      "Raven",
      "Ibis",
      "Egret",
      "Condor",
      "Pelican",
      "Finch",
      "Lark",
      "Magpie",
      "Starling",
      "Hoopoe",
      "Toucan",
      "Albatross",
      "Crane",
      "Plover",
    ],
  },
  {
    id: "trees",
    label: "Trees",
    keywords: ["tree", "forest", "wood", "leaf", "garden", "nature"],
    names: [
      "Oak",
      "Cedar",
      "Maple",
      "Willow",
      "Birch",
      "Aspen",
      "Cypress",
      "Juniper",
      "Olive Grove",
      "Palm",
      "Sequoia",
      "Baobab",
      "Acacia",
      "Rowan",
      "Alder",
      "Hazel",
      "Elm",
      "Linden",
      "Spruce",
      "Fir",
      "Larch",
      "Yew",
      "Magnolia",
      "Sycamore",
    ],
  },
  {
    id: "gems",
    label: "Gems and stones",
    keywords: ["gem", "stone", "jewel", "crystal", "mineral", "rock"],
    names: [
      "Ruby",
      "Sapphire",
      "Emerald",
      "Topaz",
      "Opal",
      "Garnet",
      "Onyx",
      "Pearl",
      "Quartz",
      "Jasper",
      "Agate",
      "Amethyst",
      "Beryl",
      "Zircon",
      "Peridot",
      "Turquoise",
      "Lapis",
      "Jet",
      "Spinel",
      "Citrine",
      "Tourmaline",
      "Obsidian",
      "Moonstone",
      "Flint",
    ],
  },
  {
    id: "stars",
    label: "Stars and constellations",
    keywords: ["star", "constellation", "galaxy", "sky", "night"],
    names: [
      "Orion",
      "Lyra",
      "Vega",
      "Sirius",
      "Polaris",
      "Rigel",
      "Altair",
      "Deneb",
      "Antares",
      "Cassiopeia",
      "Andromeda",
      "Pegasus",
      "Draco",
      "Cygnus",
      "Aquila",
      "Phoenix",
      "Hydra",
      "Carina",
      "Sagitta",
      "Corvus",
      "Spica",
      "Arcturus",
      "Capella",
      "Aldebaran",
    ],
  },
  {
    id: "weather",
    label: "Weather and winds",
    keywords: ["weather", "wind", "storm", "cloud", "rain", "climate", "season"],
    names: [
      "Breeze",
      "Monsoon",
      "Zephyr",
      "Mistral",
      "Sirocco",
      "Khamsin",
      "Chinook",
      "Gale",
      "Squall",
      "Thunder",
      "Drizzle",
      "Aurora",
      "Frost",
      "Haze",
      "Tempest",
      "Cyclone",
      "Nimbus",
      "Cirrus",
      "Cumulus",
      "Rainbow",
      "Lightning",
      "Hail",
      "Dew",
      "Mist",
    ],
  },
  {
    id: "islands",
    label: "Islands",
    keywords: ["island", "sea", "ocean", "beach", "coast", "isle"],
    names: [
      "Bali",
      "Crete",
      "Malta",
      "Zanzibar",
      "Iceland",
      "Sicily",
      "Corsica",
      "Madeira",
      "Tasmania",
      "Fiji",
      "Samoa",
      "Capri",
      "Rhodes",
      "Skye",
      "Jersey",
      "Ibiza",
      "Mauritius",
      "Socotra",
      "Hokkaido",
      "Borneo",
      "Java",
      "Cuba",
      "Gozo",
      "Lanzarote",
    ],
  },
  {
    id: "spices",
    label: "Spices",
    keywords: ["spice", "food", "cook", "kitchen", "flavour", "flavor", "herb"],
    names: [
      "Allspice",
      "Anise",
      "Caraway",
      "Cardamom",
      "Chilli",
      "Cinnamon",
      "Clove",
      "Coriander",
      "Cumin",
      "Fennel",
      "Fenugreek",
      "Galangal",
      "Ginger",
      "Juniper",
      "Mace",
      "Mustard",
      "Nutmeg",
      "Paprika",
      "Pepper",
      "Saffron",
      "Sumac",
      "Tamarind",
      "Turmeric",
      "Vanilla",
    ],
  },
];

/** Most names one draw gives. */
export const MAX_THEME_DRAW = 20;

/** The shortest typed start of a word that counts as that word ("riv" for rivers). */
const PREFIX_MIN = 3;

export const themeById = (id: string): NameTheme | undefined =>
  NAME_THEMES.find((t) => t.id === id);

/**
 * The built-in list a typed theme points to, or undefined: first a list
 * whose id or a keyword is in the text ("Space missions" → planets), else,
 * from 3 letters, one whose id or a keyword starts with it ("riv" →
 * rivers), so a single letter never lands on the first list. Picker, its
 * AI task's fallback and Team Mixer all read the lists through this.
 */
export function themeForText(text: string): NameTheme | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  return (
    NAME_THEMES.find(
      (theme) => t.includes(theme.id) || theme.keywords.some((k) => t.includes(k))
    ) ??
    (t.length >= PREFIX_MIN
      ? NAME_THEMES.find(
          (theme) => theme.id.startsWith(t) || theme.keywords.some((k) => k.startsWith(t))
        )
      : undefined)
  );
}

/** `count` names from a list, in random order, each once (fewer when the list is shorter). */
export function drawNames(names: readonly string[], count: number, rng?: Rng): string[] {
  const n = Math.max(0, Math.min(MAX_THEME_DRAW, Math.floor(count)));
  return shuffle(names, rng).slice(0, n);
}

/** `count` names from a built-in theme. */
export function drawThemeNames(themeId: string, count: number, rng?: Rng): string[] {
  const theme = themeById(themeId);
  return theme ? drawNames(theme.names, count, rng) : [];
}

/**
 * Names for any typed theme without AI: from the built-in list it points to,
 * else a mix of every list. The same theme, count and seed always give the
 * same names; a new seed gives a new draw.
 */
export function fallbackThemeNames(theme: string, count: number, seed?: number): string[] {
  const rng = createRng(hashSeed(`${theme.trim().toLowerCase()}|${count}|${seed ?? 0}`));
  const match = themeForText(theme);
  const pool = match ? match.names : NAME_THEMES.flatMap((t) => t.names);
  const unique = Array.from(new Set(pool));
  return drawNames(unique, Math.max(1, count), rng);
}
