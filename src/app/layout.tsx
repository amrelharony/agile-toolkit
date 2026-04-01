import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "600", "800"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Agile Toolkit | Amr El Harony",
    template: "%s | Agile Toolkit",
  },
  description:
    "Free, open suite of 25+ interactive Agile tools — Planning Poker, Sprint Capacity Planner, Retro Board, Burndown Charts, and more.",
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
    description:
      "Curated collection of agile delivery tools, frameworks, and templates.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agile Toolkit | Amr El Harony",
    description:
      "Curated collection of agile delivery tools, frameworks, and templates.",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
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
        "dark",
        inter.variable,
        jetbrainsMono.variable,
        sourceSerif.variable
      )}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#06080f" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* Blocking script: swap to light if saved, before paint; also update theme-color */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("ae-theme");if(t==="light"){document.documentElement.classList.remove("dark");document.documentElement.classList.add("light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f4f6fb")}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        {/* Atmosphere background — 2 mesh blobs, noise overlay (reduced from main site) */}
        <div className="atmosphere" aria-hidden="true">
          <div className="mesh-blob mesh-blob-1" />
          <div className="mesh-blob mesh-blob-2" />
        </div>
        <div className="noise-overlay" aria-hidden="true" />

        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
