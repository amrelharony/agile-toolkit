import { Suspense } from "react";
import type { Metadata } from "next";
import { defaultToolCount } from "@/lib/tools/catalog";
import { TOUCH_LINK } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import { SignInCard } from "./sign-in-card";

// The root layout's title template appends " | Agile Toolkit".
export const metadata: Metadata = {
  title: "Owner sign in",
  description: "Owner sign in for the Agile Toolkit workspace. Visitors don't need an account.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-10">
      {/* Brand: logo + title above the card. text-text gets the theme's
          primary foreground; the AT.svg is dark-mode optimised but still
          legible against the light/HC themes thanks to its rounded white-
          background variant. */}
      <header className="flex flex-col items-center gap-4">
        {/* Plain <img> rather than next/image: the optimizer 400s on SVG
            unless you opt into dangerouslyAllowSVG globally. Logos are
            tiny static assets — no optimization upside, and bypassing
            the optimizer keeps the deploy footprint smaller. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/AT.svg"
          alt="Agile Toolkit"
          width={72}
          height={72}
          className="rounded-2xl shadow-sm"
        />
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-text">Agile Toolkit</h1>
          <p className="text-sm text-sub">
            {defaultToolCount()} tools for agile delivery, in one workspace.
          </p>
        </div>
      </header>

      <Suspense fallback={null}>
        <SignInCard />
      </Suspense>

      {/* A footer link stands alone, so it gets the 44px touch height. */}
      <footer className="text-xs text-sub">
        built by{" "}
        <a
          href="https://amrelharony.com"
          target="_blank"
          rel="noreferrer noopener"
          className={cn(
            "underline underline-offset-4 hover:text-accent transition-colors",
            TOUCH_LINK
          )}
        >
          Amr Elharony
        </a>
      </footer>
    </main>
  );
}
