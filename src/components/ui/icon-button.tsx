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
 * Icon-only button with a required accessible name.
 *
 * At least 24×24 px everywhere (WCAG 2.5.8) and 44×44 px on touch screens
 * via the base Button's `icon` size.
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
        className={cn("min-h-6 min-w-6", className)}
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
