import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 44 px tall with 16 px text by default: the WCAG 2.2 touch target,
          // and iOS zooms the page when a focused field is under 16 px. Only
          // a mouse or trackpad at md+ gets the denser 36 px / 14 px, so a
          // landscape phone (wider than md, still touch) keeps the phone size.
          // A caller that changes the desktop size overrides it with the same
          // `pointer-fine:md:` prefix so tailwind-merge drops these; a bare
          // `md:` sorts earlier in the stylesheet and loses.
          // `pointer-coarse:min-h-11` keeps the 44 px floor on touch when a
          // dense caller sets its own `h-8` or `h-8 sm:h-7`: tailwind-merge
          // drops `h-11` for those, and min-height beats height.
          "flex h-11 pointer-coarse:min-h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pointer-fine:md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
