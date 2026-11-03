import type { Metadata } from "next";
import { SHARE_SIZE, SITE_SHARE_URL } from "@/lib/book/art";

/**
 * The root layout's metadata, what every page starts from. Here rather than in
 * layout.tsx so a test can resolve it without loading the fonts and the shell.
 */
export const SITE_METADATA: Metadata = {
  title: {
    default: "Agile Toolkit | Amr El Harony",
    template: "%s | Agile Toolkit",
  },
  description:
    "Free toolkit for Scrum masters and agile teams — sprint planning, daily scrum, retrospectives, estimation, delivery metrics and team health. Runs in your browser; no sign-up.",
  keywords: [
    "agile",
    "scrum",
    "sprint planning",
    "planning poker",
    "retrospective",
    "burndown chart",
    "velocity tracker",
  ],
  metadataBase: new URL("https://agile.amrelharony.com"),
  // "./" is the page's own path, without its query, so every page that doesn't
  // set its own gets the right canonical and og:url. With no title or
  // description here, a link preview takes the page's own (Next fills them in),
  // not the home page's.
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "./",
    siteName: "Agile Toolkit",
    images: [{ url: SITE_SHARE_URL, ...SHARE_SIZE, alt: "Agile Toolkit, with Amr waving" }],
  },
  // Takes its title, description and image from openGraph.
  twitter: { card: "summary_large_image" },
  icons: {
    icon: [{ url: "/AT.svg", type: "image/svg+xml" }],
    // iOS ignores SVG touch icons; a 180 px PNG.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Agile Toolkit", statusBarStyle: "default" },
};
