import type { WmoInfo } from "./types";

/**
 * WMO 4677 interpretation codes used by Open-Meteo.
 *
 * https://open-meteo.com/en/docs   (see "Weather Variable Documentation")
 *
 * Each entry maps to a lucide icon, a hex accent color, and a mood that gets
 * forwarded to the Emotion Engine when the user hasn't opted in to webcam
 * mood detection.
 */
export const WMO_CODES: Record<number, WmoInfo> = {
  0: { label: "Clear sky", icon: "sun", color: "#fbbf24", mood: "Playful" },
  1: { label: "Mainly clear", icon: "cloud-sun", color: "#fcd34d", mood: "Playful" },
  2: { label: "Partly cloudy", icon: "cloud-sun", color: "#94a3b8", mood: "Calm" },
  3: { label: "Overcast", icon: "cloud", color: "#64748b", mood: "Calm" },
  45: { label: "Fog", icon: "cloud-fog", color: "#94a3b8", mood: "Melancholy" },
  48: { label: "Rime fog", icon: "cloud-fog", color: "#94a3b8", mood: "Melancholy" },
  51: { label: "Light drizzle", icon: "cloud-drizzle", color: "#60a5fa", mood: "Melancholy" },
  53: { label: "Drizzle", icon: "cloud-drizzle", color: "#3b82f6", mood: "Melancholy" },
  55: { label: "Heavy drizzle", icon: "cloud-drizzle", color: "#2563eb", mood: "Melancholy" },
  56: { label: "Freezing drizzle", icon: "cloud-drizzle", color: "#60a5fa", mood: "Melancholy" },
  57: { label: "Heavy freezing drizzle", icon: "cloud-drizzle", color: "#2563eb", mood: "Melancholy" },
  61: { label: "Light rain", icon: "cloud-rain", color: "#60a5fa", mood: "Melancholy" },
  63: { label: "Rain", icon: "cloud-rain", color: "#3b82f6", mood: "Melancholy" },
  65: { label: "Heavy rain", icon: "cloud-rain", color: "#1d4ed8", mood: "Melancholy" },
  66: { label: "Freezing rain", icon: "cloud-rain", color: "#60a5fa", mood: "Melancholy" },
  67: { label: "Heavy freezing rain", icon: "cloud-rain", color: "#2563eb", mood: "Melancholy" },
  71: { label: "Light snow", icon: "snowflake", color: "#cbd5e1", mood: "Calm" },
  73: { label: "Snow", icon: "snowflake", color: "#e2e8f0", mood: "Calm" },
  75: { label: "Heavy snow", icon: "cloud-snow", color: "#f1f5f9", mood: "Calm" },
  77: { label: "Snow grains", icon: "cloud-snow", color: "#cbd5e1", mood: "Calm" },
  80: { label: "Rain showers", icon: "cloud-rain", color: "#2563eb", mood: "Melancholy" },
  81: { label: "Heavy rain showers", icon: "cloud-rain", color: "#1d4ed8", mood: "Melancholy" },
  82: { label: "Violent rain showers", icon: "cloud-rain", color: "#1e3a8a", mood: "Energetic" },
  85: { label: "Snow showers", icon: "cloud-snow", color: "#e2e8f0", mood: "Calm" },
  86: { label: "Heavy snow showers", icon: "cloud-snow", color: "#f1f5f9", mood: "Calm" },
  95: { label: "Thunderstorm", icon: "cloud-lightning", color: "#7c3aed", mood: "Energetic" },
  96: { label: "Thunderstorm w/ hail", icon: "cloud-lightning", color: "#6d28d9", mood: "Energetic" },
  99: { label: "Heavy thunderstorm w/ hail", icon: "zap", color: "#5b21b6", mood: "Energetic" },
};

const FALLBACK: WmoInfo = {
  label: "Unknown",
  icon: "cloud",
  color: "#64748b",
  mood: "Neutral",
};

export function getWmoInfo(code: number): WmoInfo {
  return WMO_CODES[code] ?? FALLBACK;
}

/**
 * Temperature → accent color.  Overrides the WMO code color when temperature
 * extremes should dominate the UI (e.g., a 40°C clear-sky day in Cairo reads
 * more as "hot" than "sunny").
 */
export function temperatureColor(c: number): string {
  if (c < 5) return "#60a5fa";        // icy blue
  if (c < 15) return "#3b82f6";       // cool blue
  if (c < 25) return "#10b981";       // temperate green
  if (c < 35) return "#f59e0b";       // warm amber
  return "#ef4444";                   // hot red
}

/** Combine WMO color with temperature color by picking whichever is more extreme. */
export function resolveAccent(code: number, temperatureC: number): string {
  // Thunderstorms and heavy precipitation override temperature — that's the
  // dominant signal even on a hot afternoon.
  if (code >= 95 || code >= 65) return getWmoInfo(code).color;
  if (temperatureC < 5 || temperatureC > 35) return temperatureColor(temperatureC);
  return getWmoInfo(code).color;
}
