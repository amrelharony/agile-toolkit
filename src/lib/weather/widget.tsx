"use client";

import { useMemo } from "react";
import {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  CloudDrizzle,
  CloudSnow,
  CloudFog,
  CloudLightning,
  Snowflake,
  Zap,
  Wind,
} from "lucide-react";
import type { WeatherIcon } from "./types";
import { useWeather } from "./provider";
import { resolveAccent } from "./wmo";
import { cn } from "@/lib/utils";

type LucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const ICON_MAP: Record<WeatherIcon, LucideIcon> = {
  sun: Sun as LucideIcon,
  cloud: Cloud as LucideIcon,
  "cloud-sun": CloudSun as LucideIcon,
  "cloud-rain": CloudRain as LucideIcon,
  "cloud-drizzle": CloudDrizzle as LucideIcon,
  "cloud-snow": CloudSnow as LucideIcon,
  "cloud-fog": CloudFog as LucideIcon,
  "cloud-lightning": CloudLightning as LucideIcon,
  snowflake: Snowflake as LucideIcon,
  zap: Zap as LucideIcon,
  wind: Wind as LucideIcon,
};

export interface WeatherWidgetProps {
  compact?: boolean;
  className?: string;
}

/**
 * Inline header widget — shows the current Cairo temperature + conditions
 * with a weather-coloured accent.  Hides itself entirely when the fetch
 * fails (per the spec's graceful-fallback requirement).
 */
export function WeatherWidget({ compact = false, className }: WeatherWidgetProps) {
  const { weather, failed } = useWeather();

  const accent = useMemo(() => {
    if (!weather) return null;
    return resolveAccent(weather.code, weather.temperatureC);
  }, [weather]);

  if (failed || !weather || !accent) return null;

  const Icon = ICON_MAP[weather.info.icon] ?? Cloud;
  const temp = Math.round(weather.temperatureC);

  return (
    <div
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 backdrop-blur-sm",
        "px-2.5 py-1 text-[11px] font-data text-sub transition-colors hover:text-text hover:border-accent/30",
        className
      )}
      role="status"
      aria-label={`Cairo weather: ${weather.info.label}, ${temp} degrees Celsius`}
      title={`Cairo · ${weather.info.label} · feels like ${Math.round(weather.apparentC)}°C · wind ${weather.windSpeed.toFixed(1)} m/s`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} aria-hidden="true" />
      <span className="tabular-nums" style={{ color: accent }}>
        {temp}°C
      </span>
      {!compact ? (
        <span className="hidden md:inline text-sub/80 border-l border-border pl-1.5 ml-0.5">
          Cairo
        </span>
      ) : null}
    </div>
  );
}

/** Header status badge — coloured dot + text driven by Cairo time + weather. */
export function StatusBadge({ className }: { className?: string }) {
  const { badge } = useWeather();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 backdrop-blur-sm",
        "px-2.5 py-1 text-[10px] font-data uppercase tracking-wider text-sub",
        className
      )}
      role="status"
      title={badge.description}
      aria-label={badge.description}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", badge.live && "animate-pulse")}
        style={{
          backgroundColor: badge.color,
          boxShadow: badge.live ? `0 0 8px ${badge.color}` : undefined,
        }}
        aria-hidden="true"
      />
      <span className="hidden sm:inline" style={{ color: badge.color }}>
        {badge.text}
      </span>
    </div>
  );
}
