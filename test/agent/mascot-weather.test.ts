/**
 * WMO weather-code → mascot weather-type bucketing (source refreshWeather).
 */

import { describe, it, expect } from "vitest";
import { weatherCodeToType } from "@/components/agent/mascot/engine/particles/weather-particles";

describe("weatherCodeToType", () => {
  it("clear for code <= 1", () => {
    expect(weatherCodeToType(0)).toBe("clear");
    expect(weatherCodeToType(1)).toBe("clear");
  });

  it("overcast for 2..3", () => {
    expect(weatherCodeToType(2)).toBe("overcast");
    expect(weatherCodeToType(3)).toBe("overcast");
  });

  it("rain for 51..67", () => {
    expect(weatherCodeToType(51)).toBe("rain");
    expect(weatherCodeToType(63)).toBe("rain");
    expect(weatherCodeToType(67)).toBe("rain");
  });

  it("snow for 71..77", () => {
    expect(weatherCodeToType(71)).toBe("snow");
    expect(weatherCodeToType(77)).toBe("snow");
  });

  it("thunder for >= 95", () => {
    expect(weatherCodeToType(95)).toBe("thunder");
    expect(weatherCodeToType(99)).toBe("thunder");
  });

  it("falls back to overcast for in-between codes (e.g. 45 fog, 80 showers)", () => {
    expect(weatherCodeToType(45)).toBe("overcast");
    expect(weatherCodeToType(80)).toBe("overcast");
  });

  it("returns null for missing/NaN", () => {
    expect(weatherCodeToType(null)).toBeNull();
    expect(weatherCodeToType(undefined)).toBeNull();
    expect(weatherCodeToType(NaN)).toBeNull();
  });
});
