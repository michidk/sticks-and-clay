import { useState, type ComponentProps } from "react";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

/** The server serves stored rasters as compressed WebP at these widths; "full" is the original. */
type Width = 320 | 640 | 1280 | "full";

const compressed = (src: string | undefined, width: Width) =>
  src?.startsWith("/api/files/") && !src.includes("?") && width !== "full" && !/\.svg$/i.test(src)
    ? `${src}?w=${width}`
    : src;

/** Reserve the image area while it loads; reset state when the artifact changes. */
export function AssetImage({ width = 640, pixelated, ...props }: ComponentProps<"img"> & { width?: Width; pixelated?: boolean }) {
  const src = compressed(props.src, width);
  // Pixel art scales up without smoothing, so every cell stays a sharp square.
  return <ImageContent key={src} {...props} className={cn(props.className, pixelated && "pixelated")} src={src} />;
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
          loading="lazy"
          decoding="async"
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
