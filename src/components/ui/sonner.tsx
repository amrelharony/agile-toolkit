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

/**
 * Touch screens: sonner's action (Undo, View…) and cancel buttons are 24 px
 * tall with 12 px text — and Undo is the only way back from a delete. On a
 * coarse pointer they get a 44 px target and 14 px text; mouse and trackpad
 * keep the compact button. Sonner's own rule for them
 * (`[data-sonner-toast][data-styled=true] [data-button]`) is as specific as
 * a `group-[.toast]:` class and its style tag lands after the app's CSS, so
 * the padding and font size it sets need `!`. It sets no min-height or
 * min-width, so those win over its `height: 24px` without it.
 */
const TOUCH_BUTTON =
  "pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:!px-4 pointer-coarse:!text-sm";

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
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: `group-[.toast]:bg-primary group-[.toast]:text-primary-foreground ${TOUCH_BUTTON}`,
          cancelButton: `group-[.toast]:bg-muted group-[.toast]:text-muted-foreground ${TOUCH_BUTTON}`,
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
