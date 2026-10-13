import { useState, type ComponentProps } from "react";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

/** Reserve the image area while it loads; reset state when the artifact changes. */
export function AssetImage(props: ComponentProps<"img">) {
  return <ImageContent key={props.src} {...props} />;
}

function ImageContent({
  className,
  alt = "",
  ...props
}: ComponentProps<"img">) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  return (
    <span
      className={cn("asset-image", className)}
      aria-busy={state === "loading"}
    >
      {state === "loading" && (
        <Skeleton
          className="absolute inset-0 rounded-[inherit]"
          aria-hidden="true"
        />
      )}
      {state === "failed" ? (
        <span className="image-fallback" role="img" aria-label={alt}>
          {alt || "Image"} · Preview unavailable
        </span>
      ) : (
        <img
          {...props}
          alt={alt}
          ref={(img) => {
            if (img?.complete) setState(img.naturalWidth ? "ready" : "failed");
          }}
          className={state === "loading" ? "opacity-0" : "opacity-100"}
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
        />
      )}
    </span>
  );
}
