import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { AppToaster } from "@/components/layout/app-toaster";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { ParticleBackground } from "@/components/shared/particle-background";
import { THEME_BOOT_SCRIPT, THEME_COLORS } from "@/lib/theme/boot-script";

// Variable fonts (no `weight` list): the UI uses font-medium (500) and
// font-bold (700) hundreds of times, and with only 300/400/600/800 loaded
// the browser snapped them to 400 and 800.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Only a couple of decorative spots use the serif, so don't make every page
// preload it.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
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
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://agile.amrelharony.com",
    siteName: "Agile Toolkit",
    title: "Agile Toolkit | Amr El Harony",
    description: "Curated collection of agile delivery tools, frameworks, and templates.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agile Toolkit | Amr El Harony",
    description: "Curated collection of agile delivery tools, frameworks, and templates.",
  },
  icons: {
    icon: [{ url: "/AT.svg", type: "image/svg+xml" }],
    // iOS ignores SVG touch icons; a 180 px PNG on the toolkit's dark ground.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Agile Toolkit", statusBarStyle: "black" },
};

// Next.js 13.2+ moved viewport out of `metadata`. Without an explicit
// export, iOS Safari defaults to a 980px-wide viewport and the responsive
// CSS sweep across all 110 tools doesn't actually apply on mobile.
// One theme-color for the default (dark) theme; the theme boot script and
// lib/theme switch it to match the applied theme. Per-media values claimed
// "light" on light-OS devices even though the page rendered dark.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLORS.dark,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("dark", inter.variable, jetbrainsMono.variable, sourceSerif.variable)}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Blocking script: apply the saved (or system) theme before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased touch-manipulation">
        {/* Atmosphere background — 2 mesh blobs, particle field, noise overlay (reduced from main site) */}
        <div className="atmosphere" aria-hidden="true">
          <div className="mesh-blob mesh-blob-1" />
          <div className="mesh-blob mesh-blob-2" />
          <ParticleBackground />
        </div>
        <div className="noise-overlay" aria-hidden="true" />

        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <AppToaster />
        </TooltipProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
