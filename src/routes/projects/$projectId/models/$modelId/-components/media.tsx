import { lazy, Suspense } from "react";
import { Boxes, ImageOff, ArrowUpRight } from "lucide-react";
import { AssetImage } from "@/components/asset-image";
import { ViewerSkeleton } from "@/components/loading";
import { fileUrl } from "@/lib/client";
import type { Artifacts } from "../-lib/model";
const Viewer = lazy(() =>
  import("@/components/model-viewer").then((module) => ({
    default: module.ModelViewer,
  })),
);

export function ModelMedia({
  view,
  artifacts,
  target,
  name,
}: {
  view: string;
  artifacts?: Artifacts;
  target?: string;
  name: string;
}) {
  if (view === "3d" && artifacts?.glb)
    return (
      <Suspense fallback={<ViewerSkeleton />}>
        <Viewer
          key={artifacts.glb}
          src={fileUrl(artifacts.glb)}
          alt={name}
          className="model-detail-viewer"
        />
      </Suspense>
    );
  if (view === "target" && target)
    return (
      <a
        className="model-detail-target"
        href={fileUrl(target)}
        target="_blank"
        rel="noreferrer"
      >
        <AssetImage src={fileUrl(target)} alt={name + " visual target"} />
        <span>
          Visual target · design reference <ArrowUpRight size={14} />
        </span>
      </a>
    );
  const images =
    view === "renders"
      ? artifacts?.renders?.map((key, index) => ({
          key,
          name: `Render ${index + 1}`,
          kind: "Product render",
        }))
      : view === "textures"
        ? artifacts?.textures
        : undefined;
  if (images?.length)
    return (
      <div
        className={
          "model-detail-gallery " + (view === "textures" ? "is-textures" : "")
        }
      >
        {images.map((image) => (
          <a
            key={image.key}
            href={fileUrl(image.key)}
            target="_blank"
            rel="noreferrer"
          >
            <AssetImage src={fileUrl(image.key)} alt={image.name} />
            <div>
              <span>
                <strong>{image.name}</strong>
                <small>{image.kind}</small>
              </span>
              <ArrowUpRight size={17} />
            </div>
          </a>
        ))}
      </div>
    );
  const title =
    view === "3d"
      ? "No exported model yet"
      : view === "target"
        ? "No visual target recorded"
        : view === "textures"
          ? "No texture images archived"
          : "No renders archived";
  return (
    <div className="model-detail-empty model-media-empty">
      {view === "3d" ? (
        <Boxes size={38} strokeWidth={1} />
      ) : (
        <ImageOff size={38} strokeWidth={1} />
      )}
      <h3>{title}</h3>
      <p>
        {view === "textures"
          ? "Geometry previews and older versions may not include separate texture files."
          : "The files for this version will appear here when they are available."}
      </p>
    </div>
  );
}
