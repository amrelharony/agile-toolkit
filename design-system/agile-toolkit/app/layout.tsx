import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { EcosystemNav } from "@/components/shared/EcosystemNav";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "600", "800"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
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
    "Curated collection of agile delivery tools, frameworks, and templates by Amr El Harony.",
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
  themeColor: "#06080f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} ${sourceSerif.variable}`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="font-sans antialiased">
        {/* Atmosphere background — 2 mesh blobs, noise overlay (reduced from main site) */}
        <div className="atmosphere" aria-hidden="true">
          <div className="mesh-blob mesh-blob-1" />
          <div className="mesh-blob mesh-blob-2" />
        </div>
        <div className="noise-overlay" aria-hidden="true" />

        {/* Cross-app ecosystem nav bar */}
        <EcosystemNav currentApp="agile" />

        {/* Header */}
        <Header />

        {/* Sidebar + Main content */}
        <div className="flex min-h-screen pt-[var(--header-h)]">
          <Sidebar />
          <main
            className="
              flex-1
              ml-[var(--sidebar-w)]
              p-6 md:p-8
              max-w-[1200px]
              transition-[margin] duration-slow ease-spring
            "
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
