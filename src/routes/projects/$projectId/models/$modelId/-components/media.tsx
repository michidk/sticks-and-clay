import { lazy, Suspense } from "react";
import { Boxes, ImageOff, Maximize2 } from "lucide-react";
import { AssetImage } from "@/components/asset-image";
import { ViewerSkeleton } from "@/components/loading";
import { useLightbox, type LightboxImage } from "@/components/image-lightbox";
import { fileUrl } from "@/lib/client";
import type { Artifacts } from "../-lib/model";
const Viewer = lazy(() =>
  import("@/components/model-viewer").then((module) => ({
    default: module.ModelViewer,
  })),
);

/** Lightbox entries for a version's product renders, in render order. */
export function renderGallery(renders: string[] = []): LightboxImage[] {
  return renders.map((key, index) => ({
    src: fileUrl(key),
    title: `Render ${index + 1}`,
    caption: "Product render",
  }));
}

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
  const openLightbox = useLightbox();
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
  if (view === "target" && target) {
    const image: LightboxImage = {
      src: fileUrl(target),
      title: "Visual target",
      caption: "Design reference · not a generated 3D model",
    };
    return (
      <button
        type="button"
        className="model-detail-target"
        onClick={() => openLightbox([image])}
      >
        <AssetImage src={image.src} alt={name + " visual target"} />
        <span>
          Visual target · design reference <Maximize2 size={14} />
        </span>
      </button>
    );
  }
  const images =
    view === "renders"
      ? renderGallery(artifacts?.renders).map((image, index) => ({
          ...image,
          key: artifacts!.renders[index],
        }))
      : view === "textures"
        ? artifacts?.textures?.map((texture) => ({
            key: texture.key,
            src: fileUrl(texture.key),
            title: texture.name,
            caption: texture.kind,
          }))
        : undefined;
  if (images?.length)
    return (
      <div
        className={
          "model-detail-gallery " + (view === "textures" ? "is-textures" : "")
        }
      >
        {images.map((image, index) => (
          <button
            type="button"
            key={image.key}
            onClick={() => openLightbox(images, index)}
            aria-label={`View ${image.title} full size`}
          >
            <AssetImage src={image.src} alt="" />
            <div>
              <span>
                <strong>{image.title}</strong>
                <small>{image.caption}</small>
              </span>
              <Maximize2 size={16} />
            </div>
          </button>
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
