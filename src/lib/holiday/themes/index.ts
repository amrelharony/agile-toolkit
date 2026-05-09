import type { HolidayId, HolidayTheme } from "../types";

/**
 * Dynamic import map — only the active theme's module is actually fetched
 * at runtime.  Keeping this map in one file lets the tree-shaker drop the
 * other 16 themes from the main bundle.
 */
export const themeLoaders: Record<HolidayId, () => Promise<{ default: HolidayTheme }>> = {
  "new-year": () => import("./new-year"),
  "coptic-christmas": () => import("./coptic-christmas"),
  "jan-25": () => import("./jan-25"),
  "mothers-day": () => import("./mothers-day"),
  "earth-day": () => import("./earth-day"),
  "sinai-liberation": () => import("./sinai-liberation"),
  "labour-day": () => import("./labour-day"),
  "jun-30": () => import("./jun-30"),
  "jul-23": () => import("./jul-23"),
  halloween: () => import("./halloween"),
  ramadan: () => import("./ramadan"),
  "eid-fitr": () => import("./eid-fitr"),
  "eid-adha": () => import("./eid-adha"),
  "hijri-new-year": () => import("./hijri-new-year"),
  mawlid: () => import("./mawlid"),
  "coptic-easter": () => import("./coptic-easter"),
  "sham-el-nessim": () => import("./sham-el-nessim"),
};

export async function loadTheme(id: HolidayId): Promise<HolidayTheme> {
  const mod = await themeLoaders[id]();
  return mod.default;
}

export const HOLIDAY_IDS: HolidayId[] = [
  "new-year",
  "coptic-christmas",
  "jan-25",
  "mothers-day",
  "earth-day",
  "sinai-liberation",
  "labour-day",
  "jun-30",
  "jul-23",
  "halloween",
  "ramadan",
  "eid-fitr",
  "eid-adha",
  "hijri-new-year",
  "mawlid",
  "coptic-easter",
  "sham-el-nessim",
];
