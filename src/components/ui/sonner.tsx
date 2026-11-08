"use client";

// R10: previously imported `useTheme` from `next-themes`, but no
// `ThemeProvider` from next-themes is mounted in `layout.tsx` —
// `useTheme()` returned `{ theme: undefined }` and Sonner defaulted
// to `"system"`, so a user in HC mode saw OS-light toasts and an app
// theme switch never updated toasts. The app's source-of-truth lives
// on `document.documentElement` class list (`.dark` / `.light` / `.hc`,
// set by the inline boot script in layout.tsx). Read it directly.

import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function detectTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "light";
  const el = document.documentElement;
  // R10: Sonner only understands "light"|"dark"|"system". Map our
  // app's `.hc` (high-contrast) → dark since HC is dark-on-yellow.
  if (el.classList.contains("hc")) return "dark";
  if (el.classList.contains("dark")) return "dark";
  return "light";
}

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    setTheme(detectTheme());
    // Subscribe to class changes on <html> so toasts re-theme when the
    // user cycles via the header switcher.
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => setTheme(detectTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        // The close button is shown per toast (lib/notify/policy.ts); on touch
        // screens globals.css gives it a 44 px hit area.
        closeButtonAriaLabel: "Dismiss",
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
