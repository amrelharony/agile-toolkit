import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
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
    default: "Books | Amr El Harony",
    template: "%s | Books — Amr El Harony",
  },
  description:
    "Reading list, book notes, and published works by Amr El Harony.",
  metadataBase: new URL("https://books.amrelharony.com"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://books.amrelharony.com",
    siteName: "Books — Amr El Harony",
    title: "Books | Amr El Harony",
    description: "Reading list, book notes, and published works.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Books | Amr El Harony",
    description: "Reading list, book notes, and published works.",
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
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased">
        {/* Atmosphere — single mesh blob, no noise (minimal for readability) */}
        <div className="atmosphere" aria-hidden="true">
          <div className="mesh-blob mesh-blob-1" />
        </div>

        {/* Ecosystem nav */}
        <EcosystemNav currentApp="books" />

        {/* Main content — centered, reading-width */}
        <main className="min-h-screen pt-12 pb-24 px-6">
          <div className="max-w-[900px] mx-auto">{children}</div>
        </main>
      </body>
    </html>
  );
}
