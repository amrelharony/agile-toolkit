"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      // Add a vertical pad on touch devices so the whole horizontal lane —
      // not just the 16-px thumb — registers drags. `py-3` gives a 24-px
      // band around the track, which keeps casual taps from falling on the
      // page below the slider. The track itself stays 6-px tall.
      "relative flex w-full touch-none select-none items-center [@media(pointer:coarse)]:py-3",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    {/*
     * Thumb: 16 × 16 on desktop, 24 × 24 on coarse pointers. A 24-px circle
     * inside a 24-px lane is the iOS-native slider size and pairs cleanly
     * with our touch-density floor. The ::after layer extends the hit area
     * to a 44 × 44 invisible square so even fat-finger drags catch.
     */}
    <SliderPrimitive.Thumb
      className={cn(
        "relative block h-4 w-4 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6",
        "rounded-full border border-primary/50 bg-background shadow transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-50",
        // Invisible expand-hitbox layer for thick fingers.
        "after:absolute after:inset-[-14px] after:content-[''] after:rounded-full"
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
