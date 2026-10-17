import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { AssetImage } from "./asset-image";

export type LightboxImage = { src: string; title: string; caption?: string };
type OpenLightbox = (images: LightboxImage[], index?: number) => void;

const LightboxContext = createContext<OpenLightbox>(() => {});

/** Open a full-size, keyboard-navigable preview of one image in a set. */
export function useLightbox() {
  return useContext(LightboxContext);
}

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [gallery, setGallery] = useState<{
    images: LightboxImage[];
    index: number;
  } | null>(null);
  const open = useCallback<OpenLightbox>((images, index = 0) => {
    if (!images.length) return;
    setGallery({
      images,
      index: Math.min(Math.max(index, 0), images.length - 1),
    });
  }, []);
  const step = useCallback(
    (delta: number) =>
      setGallery(
        (current) =>
          current && {
            ...current,
            index:
              (current.index + delta + current.images.length) %
              current.images.length,
          },
      ),
    [],
  );
  const multiple = (gallery?.images.length || 0) > 1;
  useEffect(() => {
    if (!multiple) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiple, step]);
  const current = gallery?.images[gallery.index];
  return (
    <LightboxContext.Provider value={open}>
      {children}
      <Dialog
        open={!!gallery}
        onOpenChange={(isOpen) => {
          if (!isOpen) setGallery(null);
        }}
      >
        {gallery && current && (
          <DialogContent className="image-lightbox">
            <figure className="image-lightbox-figure">
              <AssetImage src={current.src} width={1280} alt={current.title} />
              <figcaption>
                <div>
                  <DialogTitle>{current.title}</DialogTitle>
                  <DialogDescription>
                    {current.caption ||
                      (multiple
                        ? `Image ${gallery.index + 1} of ${gallery.images.length}`
                        : "Full-size preview")}
                  </DialogDescription>
                </div>
                <div className="image-lightbox-actions">
                  {multiple && (
                    <span aria-live="polite">
                      {gallery.index + 1} / {gallery.images.length}
                    </span>
                  )}
                  <Button variant="outline" size="sm" asChild>
                    <a href={current.src} download>
                      <Download size={14} /> Download
                    </a>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={current.src} target="_blank" rel="noreferrer">
                      Open original <ArrowUpRight size={14} />
                    </a>
                  </Button>
                </div>
              </figcaption>
            </figure>
            {multiple && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="image-lightbox-nav is-prev"
                  aria-label="Previous image"
                  onClick={() => step(-1)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="image-lightbox-nav is-next"
                  aria-label="Next image"
                  onClick={() => step(1)}
                >
                  <ChevronRight />
                </Button>
              </>
            )}
          </DialogContent>
        )}
      </Dialog>
    </LightboxContext.Provider>
  );
}
