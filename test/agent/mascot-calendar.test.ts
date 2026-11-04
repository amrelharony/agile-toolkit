import { describe, expect, it } from "vitest";
import { nayrouzDay, occasionsOn } from "@/lib/agent/mascot/context/occasions";
import { sunTimes, CAIRO } from "@/lib/agent/mascot/context/sun";

/** Noon in Cairo on a Gregorian day, well clear of the date line. */
const cairoNoon = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("Cairo's occasions", () => {
  it.each([
    ["2027-02-08", "ramadan"],
    ["2027-03-01", "ramadan"],
    ["2027-03-09", "eid-fitr"],
    ["2027-03-11", "eid-fitr"],
    ["2027-05-15", "arafah"],
    ["2027-05-16", "eid-adha"],
    ["2027-05-19", "eid-adha"],
    ["2027-06-06", "hijri-new-year"],
    ["2027-06-15", "ashura"],
    ["2027-08-14", "mawlid"],
    ["2027-01-05", "isra-miraj"],
    ["2027-01-23", "mid-shaban"],
  ])("finds the Hijri day on %s: %s", (iso, id) => {
    expect(occasionsOn(cairoNoon(iso))).toContain(id);
  });

  it("ends Eid al-Fitr after its third day", () => {
    expect(occasionsOn(cairoNoon("2027-03-12"))).not.toContain("eid-fitr");
  });

  // The table amrelharony.com's engine carries for 2026-2035.
  const COPTIC_EASTER: Record<number, string> = {
    2026: "04-12",
    2027: "05-02",
    2028: "04-16",
    2029: "04-08",
    2030: "04-28",
    2031: "04-13",
    2032: "05-02",
    2033: "04-24",
    2034: "04-09",
    2035: "04-29",
  };
  it.each(Object.entries(COPTIC_EASTER))(
    "puts Coptic Easter %s on the same day as amrelharony.com, and Sham el-Nessim the day after",
    (year, md) => {
      const easter = cairoNoon(`${year}-${md}`);
      expect(occasionsOn(easter)).toContain("coptic-easter");
      const monday = new Date(easter.getTime() + 86_400_000);
      expect(occasionsOn(monday)).toContain("sham-el-nessim");
      expect(occasionsOn(monday)).not.toContain("coptic-easter");
    }
  );

  it("keeps Nayrouz on 11 September, or the 12th before a Gregorian leap year", () => {
    expect(nayrouzDay(2026)).toBe(11);
    expect(nayrouzDay(2027)).toBe(12);
    expect(occasionsOn(cairoNoon("2027-09-12"))).toContain("nayrouz");
    expect(occasionsOn(cairoNoon("2027-09-11"))).not.toContain("nayrouz");
    expect(occasionsOn(cairoNoon("2026-09-11"))).toContain("nayrouz");
  });

  it.each([
    ["2027-01-25", "jan-25"],
    ["2027-04-25", "sinai-liberation"],
    ["2027-06-30", "jun-30"],
    ["2027-07-23", "jul-23"],
    ["2027-07-26", "suez-canal"],
    ["2026-10-06", "oct-6"],
    ["2027-01-07", "coptic-christmas"],
    ["2026-12-24", "christmas"],
    ["2026-12-31", "nye"],
    ["2027-02-14", "valentine"],
    ["2027-03-21", "mothers-day"],
    ["2027-03-14", "pi-day"],
    ["2027-04-01", "april-fools"],
    ["2027-05-01", "labour-day"],
    ["2027-10-05", "teachers-day"],
    ["2027-10-25", "halloween"],
    ["2027-10-31", "halloween"],
  ])("marks %s as %s", (iso, id) => {
    expect(occasionsOn(cairoNoon(iso))).toContain(id);
  });

  it("puts a single day ahead of the month of Ramadan", () => {
    // 8 March 2027 is the last day of Ramadan 1448 and International Women's Day.
    expect(occasionsOn(cairoNoon("2027-03-08"))).toEqual(["womens-day", "ramadan"]);
  });

  it("goes by Cairo's clock, not the visitor's", () => {
    // 22:30 UTC on New Year's Eve is already 1 January in Cairo (UTC+2).
    expect(occasionsOn(new Date("2026-12-31T22:30:00Z"))).toContain("new-year");
    expect(occasionsOn(new Date("2026-12-31T21:30:00Z"))).toContain("nye");
  });

  it("marks nothing on an ordinary day", () => {
    expect(occasionsOn(cairoNoon("2026-11-04"))).toEqual([]);
  });
});

describe("sunrise and sunset", () => {
  const local = (d: Date | null, tz: string) =>
    d?.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const minutes = (hhmm: string | undefined) => {
    const [h, m] = (hhmm ?? "x").split(":").map(Number);
    return h * 60 + m;
  };

  it("finds London's midsummer day within a few minutes", () => {
    const t = sunTimes(new Date("2027-06-21T12:00:00Z"), 51.5074, -0.1278);
    expect(
      Math.abs(minutes(local(t.rise, "Europe/London")) - minutes("04:43"))
    ).toBeLessThanOrEqual(3);
    expect(Math.abs(minutes(local(t.set, "Europe/London")) - minutes("21:21"))).toBeLessThanOrEqual(
      3
    );
  });

  it("finds Cairo's midwinter sunset just before five", () => {
    const t = sunTimes(new Date("2026-12-21T12:00:00Z"), CAIRO.lat, CAIRO.lon);
    expect(Math.abs(minutes(local(t.set, "Africa/Cairo")) - minutes("16:59"))).toBeLessThanOrEqual(
      4
    );
  });

  it("answers for the day asked, not the next", () => {
    const t = sunTimes(new Date("2027-02-10T15:45:00Z"), CAIRO.lat, CAIRO.lon);
    expect(t.set?.toISOString().slice(0, 10)).toBe("2027-02-10");
    expect(t.rise?.toISOString().slice(0, 10)).toBe("2027-02-10");
  });

  it("has no sunrise or sunset in the polar day", () => {
    expect(sunTimes(new Date("2027-06-21T12:00:00Z"), 78, 15)).toEqual({ rise: null, set: null });
  });
});
