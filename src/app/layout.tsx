import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { AppToaster } from "@/components/layout/app-toaster";
import { ParticleBackground } from "@/components/shared/particle-background";

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
    "Free, open suite of 110+ interactive Agile tools — sprint planning, retros, estimation, metrics and more. Runs in your browser; no sign-up.",
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
    apple: "/AT.svg",
  },
};

// Next.js 13.2+ moved viewport out of `metadata`. Without an explicit
// export, iOS Safari defaults to a 980px-wide viewport and the responsive
// CSS sweep across all 110 tools doesn't actually apply on mobile.
// `themeColor` per color-scheme matches the inline theme script in <head>.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0e1a" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6fb" },
  ],
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
        {/* Blocking script: swap to light if saved, before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("ae-theme");if(t==="light"){document.documentElement.classList.remove("dark");document.documentElement.classList.add("light");document.documentElement.setAttribute("data-theme","light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f4f6fb")}else if(t==="hc"){document.documentElement.classList.remove("dark");document.documentElement.classList.add("hc");document.documentElement.setAttribute("data-theme","hc")}}catch(e){}})()`,
          }}
        />
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
      </body>
    </html>
  );
}
