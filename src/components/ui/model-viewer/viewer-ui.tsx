"use client";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./primitives/button";
import { Tooltip, TooltipTrigger } from "./primitives/tooltip";
import { TooltipContent } from "./viewer-popups";

export type ViewerControlButtonProps = ComponentProps<typeof Button> & {
  /** Override the accessible-label tooltip, or use false to disable it. */
  tooltip?: ReactNode | false;
};

export function ViewerControlButton({
  title,
  tooltip,
  type = "button",
  ...props
}: ViewerControlButtonProps) {
  const label = tooltip === undefined ? (title ?? props["aria-label"]) : tooltip;
  const button = <Button type={type} {...props} />;
  return label ? (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
}
