"use client";

import { LoaderCircle } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

/** Keeps the indeterminate loader's phase stable when one loading view replaces another. */
export function ViewerLoaderSpinner() {
  const spinner = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const animation = spinner.current?.getAnimations()[0];
    if (animation) animation.startTime = 0;
  }, []);

  return <LoaderCircle ref={spinner} className="viewer-loader-spinner" aria-hidden="true" />;
}
