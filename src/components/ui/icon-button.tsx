"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  /**
   * What the button does ("Delete row", "Add card to Start"). Required: it
   * becomes the accessible name and the tooltip, so an icon-only button can
   * never ship unnamed again.
   */
  label: string;
  icon: React.ReactNode;
  /** Show `label` as a tooltip on hover/focus (default true). */
  tooltip?: boolean;
}

/**
 * The WCAG 2.5.8 floor (24×24 px), only where the base sizes shrink: md+ with
 * a mouse. A plain `min-h-6` would make tailwind-merge drop the `icon` size's
 * `min-h-[44px]`, leaving every icon button 24×24 on phones.
 */
const FLOOR = "md-fine:min-h-6 md-fine:min-w-6";

/**
 * Icon-only button with a required accessible name.
 *
 * 44×44 px on touch screens and below md (the base Button's `icon` size), and
 * at least 24×24 px with a mouse on md+ (WCAG 2.5.8), however small a call
 * site's `md:h-*` makes it.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, tooltip = true, variant = "ghost", size = "icon", className, ...props }, ref) => {
    const button = (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size={size}
        aria-label={label}
        className={cn(FLOOR, className)}
        {...props}
      >
        {icon}
      </Button>
    );
    if (!tooltip) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
);
IconButton.displayName = "IconButton";
