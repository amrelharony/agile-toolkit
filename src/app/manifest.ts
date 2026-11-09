import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/theme/boot-script";
import { defaultToolCount } from "@/lib/tools/catalog";

/**
 * Web app manifest: lets people install the toolkit on a phone or desktop
 * and open it in its own window. Served at /manifest.webmanifest (exempt
 * from middleware); the icons are top-level files for the same reason.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agile Toolkit",
    short_name: "Agile Toolkit",
    description: `${defaultToolCount()} free tools for agile teams: retros, planning poker, estimation, metrics and more. Your work is saved in your browser.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
