import type { Mood } from "@/lib/emotion/types";

/** WMO weather interpretation codes used by Open-Meteo. */
export type WmoCode = number;

export interface WmoInfo {
  /** Short human label, e.g., "Thunderstorm". */
  label: string;
  /** Lucide icon name (matches the src/components/ui iconography). */
  icon: WeatherIcon;
  /** Accent hex color used by the widget and any opt-in aesthetic tint. */
  color: string;
  /** Mood this code should push to the emotion engine. */
  mood: Mood;
}

export type WeatherIcon =
  | "sun"
  | "cloud"
  | "cloud-sun"
  | "cloud-rain"
  | "cloud-drizzle"
  | "cloud-snow"
  | "cloud-fog"
  | "cloud-lightning"
  | "wind"
  | "snowflake"
  | "zap";

export interface WeatherSnapshot {
  /** Observation timestamp (ISO) reported by the API. */
  observedAt: string;
  /** Time the snapshot was retrieved (ms epoch). */
  fetchedAt: number;
  /** Current temperature in °C. */
  temperatureC: number;
  /** Feels-like / apparent temperature in °C. */
  apparentC: number;
  /** Relative humidity 0-100. */
  humidity: number;
  /** Wind speed in m/s. */
  windSpeed: number;
  /** Wind direction in degrees. */
  windDirection: number;
  /** Whether it's currently daytime at the location. */
  isDay: boolean;
  /** Parsed WMO weather code. */
  code: WmoCode;
  /** Resolved info: icon + color + label + mood. */
  info: WmoInfo;
}

export interface StatusBadge {
  /** Short all-caps status line. */
  text: string;
  /** Accent color for the badge dot. */
  color: string;
  /** Whether the badge should pulse (live mode). */
  live: boolean;
  /** Longer descriptor shown on hover. */
  description: string;
}
