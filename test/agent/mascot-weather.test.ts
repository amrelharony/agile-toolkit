// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { weatherMoment, type WeatherNow } from "@/lib/agent/mascot/context/weather";
import {
  localToUtcIso,
  placeFrom,
  readWeather,
  round1,
} from "@/lib/agent/mascot/context/weather-server";

vi.mock("server-only", () => ({}));

const base: WeatherNow = {
  code: 0,
  temp: 24,
  feels: 24,
  wind: 8,
  gusts: 15,
  isDay: true,
  dust: 20,
  sunrise: null,
  sunset: null,
  south: false,
};

describe("what the weather means to Amr", () => {
  it.each<[Partial<WeatherNow>, string | null]>([
    [{}, "sun"],
    [{ isDay: false }, "stars"],
    [{ code: 2 }, null],
    [{ code: 3 }, "grey"],
    [{ code: 45 }, "grey"],
    [{ code: 61 }, "rain"],
    [{ code: 80 }, "rain"],
    [{ code: 65 }, "downpour"],
    [{ code: 82 }, "downpour"],
    [{ code: 95 }, "storm"],
    [{ code: 73 }, "snow"],
    [{ feels: 33 }, "heat"],
    [{ feels: 41 }, "scorch"],
    [{ feels: 9 }, "cold"],
    [{ wind: 40 }, "wind"],
    [{ gusts: 60 }, "wind"],
    [{ dust: 400 }, "dust"],
    [{ dust: null }, "sun"],
  ])("%j → %s", (w, moment) => {
    expect(weatherMoment({ ...base, ...w })).toBe(moment);
  });

  it("lets rain beat the heat, and dust beat the wind", () => {
    expect(weatherMoment({ ...base, code: 61, feels: 35 })).toBe("rain");
    expect(weatherMoment({ ...base, dust: 300, wind: 50 })).toBe("dust");
  });
});

describe("where the visitor roughly is", () => {
  const headers = (h: Record<string, string>) => new Headers(h);
  const none = new URLSearchParams();

  it("reads Vercel's geolocation, rounded to a tenth of a degree", () => {
    const at = placeFrom(
      headers({ "x-vercel-ip-latitude": "30.04443", "x-vercel-ip-longitude": "31.23571" }),
      none,
      false
    );
    expect(at).toEqual({ lat: 30, lon: 31.2 });
    expect(round1(-33.8688)).toBe(-33.9);
  });

  it("knows nothing without the headers, or with nonsense in them", () => {
    expect(placeFrom(headers({}), none, false)).toBeNull();
    expect(
      placeFrom(
        headers({ "x-vercel-ip-latitude": "abc", "x-vercel-ip-longitude": "1" }),
        none,
        false
      )
    ).toBeNull();
    expect(
      placeFrom(
        headers({ "x-vercel-ip-latitude": "95", "x-vercel-ip-longitude": "1" }),
        none,
        false
      )
    ).toBeNull();
  });

  it("takes ?at= only off production", () => {
    const q = new URLSearchParams("at=51.5074,-0.1278");
    expect(placeFrom(headers({}), q, true)).toEqual({ lat: 51.5, lon: -0.1 });
    expect(placeFrom(headers({}), q, false)).toBeNull();
  });
});

describe("Open-Meteo", () => {
  const forecast = {
    utc_offset_seconds: 7200,
    current: {
      temperature_2m: 29.4,
      apparent_temperature: 31.1,
      weather_code: 1,
      is_day: 1,
      wind_speed_10m: 12,
      wind_gusts_10m: 30,
    },
    daily: { sunrise: ["2026-11-04T06:11"], sunset: ["2026-11-04T17:05"] },
  };
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("turns a local time and offset into UTC", () => {
    expect(localToUtcIso("2026-11-04T17:05", 7200)).toBe("2026-11-04T15:05:00.000Z");
    expect(localToUtcIso(undefined, 0)).toBeNull();
    expect(localToUtcIso("", 0)).toBeNull();
  });

  it("asks for the rounded place only, and reads the forecast and the dust", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return url.includes("air-quality") ? ok({ current: { dust: 210.5 } }) : ok(forecast);
    });
    const w = await readWeather({ lat: 30, lon: 31.2 }, fetcher);
    expect(w).toEqual({
      code: 1,
      temp: 29.4,
      feels: 31.1,
      wind: 12,
      gusts: 30,
      isDay: true,
      dust: 210.5,
      sunrise: "2026-11-04T04:11:00.000Z",
      sunset: "2026-11-04T15:05:00.000Z",
      south: false,
    });
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(u).toContain("latitude=30&longitude=31.2");
  });

  it("does without the dust when the air quality API fails", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("air-quality") ? new Response("no", { status: 500 }) : ok(forecast)
    );
    expect((await readWeather({ lat: -33.9, lon: 151.2 }, fetcher))?.dust).toBeNull();
    expect((await readWeather({ lat: -33.9, lon: 151.2 }, fetcher))?.south).toBe(true);
  });

  it("says nothing when the forecast fails or makes no sense", async () => {
    expect(
      await readWeather({ lat: 1, lon: 1 }, async () => new Response("x", { status: 503 }))
    ).toBeNull();
    expect(await readWeather({ lat: 1, lon: 1 }, async () => ok({ current: {} }))).toBeNull();
    expect(
      await readWeather({ lat: 1, lon: 1 }, async () => {
        throw new Error("offline");
      })
    ).toBeNull();
  });
});

describe("GET /api/mascot/weather", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  async function get(url: string, h: Record<string, string> = {}) {
    const { GET } = await import("@/app/api/mascot/weather/route");
    return GET(new NextRequest(url, { headers: h }));
  }

  it("answers 204 without a place, and never fetches", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await get("https://agile.test/api/mascot/weather?at=1,1");
    expect(res.status).toBe(204);
    expect(spy).not.toHaveBeenCalled();
  });

  it("answers the weather, never the place, cached privately", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("air-quality")
        ? new Response(JSON.stringify({ current: { dust: 5 } }))
        : new Response(
            JSON.stringify({
              utc_offset_seconds: 0,
              current: { temperature_2m: 10, weather_code: 63, is_day: 0 },
              daily: {},
            })
          )
    ) as unknown as typeof fetch;
    const res = await get("https://agile.test/api/mascot/weather", {
      "x-vercel-ip-latitude": "51.5074",
      "x-vercel-ip-longitude": "-0.1278",
      "x-vercel-ip-city": "London",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=900");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe(63);
    expect(JSON.stringify(body)).not.toMatch(/London|51\.5|lat|lon/);
  });
});
