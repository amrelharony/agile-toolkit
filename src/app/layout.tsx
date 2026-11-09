import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Shantell_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { AppToaster } from "@/components/layout/app-toaster";
import { NotifyProvider } from "@/lib/notify/provider";
import { InkDefs } from "@/components/ink/ink-defs";
import { ThemeRestore } from "@/components/layout/theme-restore";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { INTRO_BOOT_SCRIPT } from "@/lib/comics/intro";
import { SITE_METADATA } from "@/lib/seo/site-metadata";
import { THEME_BOOT_SCRIPT, THEME_COLORS } from "@/lib/theme/boot-script";

// Variable fonts (no `weight` list): the UI uses font-medium (500) and
// font-bold (700) hundreds of times, and with only 300/400/600/800 loaded
// the browser snapped them to 400 and 800.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Headings. Shantell Sans is drawn from a marker hand in real upper and lower
// case, close to the comic's balloon lettering but steady enough to read at a
// small heading size. It's variable (300–800), so font-semibold and font-bold are
// real weights rather than the browser smearing a single one, as they would be
// on Patrick Hand or Architects Daughter. Tables, numbers and code never use it.
const shantell = Shantell_Sans({
  subsets: ["latin"],
  variable: "--font-hand",
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

export const metadata: Metadata = SITE_METADATA;

// Next.js 13.2+ moved viewport out of `metadata`. Without an explicit
// export, iOS Safari defaults to a 980px-wide viewport and the responsive
// CSS sweep across all 110 tools doesn't actually apply on mobile.
// One theme-color for the default (comic) theme; the theme boot script and
// lib/theme switch it to match the applied theme. Per-media values would claim
// "dark" on dark-OS devices even though the page renders on paper.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLORS.light,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "light",
        inter.variable,
        shantell.variable,
        jetbrainsMono.variable,
        sourceSerif.variable
      )}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking script: apply the saved (or system) theme before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Blocking too: a comic intro has to be decided before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased touch-manipulation">
        {/* The filters ink graphics share (line boil, watercolour bleed). */}
        <InkDefs />
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <AppToaster />
          <NotifyProvider />
        </TooltipProvider>
        <ServiceWorker />
        <ThemeRestore />
      </body>
    </html>
  );
}
