import { Download } from "lucide-react";
import { z } from "zod";
import { AssetImage } from "@/components/asset-image";
import { SpritePlayer } from "@/components/sprite-player";
import { Button } from "@/components/ui/button";
import { fileUrl } from "@/lib/client";

const files = z.record(z.string(), z.string());
const labels: Record<string, string> = {
  sheet: "Sprite sheet",
  sheetLayout: "Sheet layout",
  unity: "Unity import",
  godot: "Godot frames",
  animation: "Animated GIF",
  layers: "Layer index",
};
const label = (id: string, key: string) =>
  labels[id] ?? (id.startsWith("layer") ? `Layer ${key.split("/").pop()?.replace(/^layer-\d+-|\.png$/g, "")}` : id);

/** Engine files of one pixel version: the animation playing from its sheet, the review sheet the judge saw, and the
 * downloads (baseline-aligned sheet, its layout, Unity and Godot import descriptions, GIF and layers). Versions saved
 * before these files existed show nothing. */
export function PixelExports({ exports, review }: { exports: unknown; review?: string }) {
  const parsed = files.safeParse(exports);
  if (!parsed.success && !review) return null;
  // Stored JSON does not keep key order, so files are listed in a fixed order.
  const rank = (id: string) => { const at = Object.keys(labels).indexOf(id); return at < 0 ? Object.keys(labels).length : at; };
  const entries = parsed.success ? Object.entries(parsed.data).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true })) : [];
  const sheet = parsed.success ? parsed.data.sheet : undefined;
  const layout = parsed.success ? parsed.data.sheetLayout : undefined;
  return (
    <section className="mt-6 space-y-4" aria-label="Pixel exports">
      {parsed.success && parsed.data.animation && sheet && layout && (
        <div>
          <h2>Animation</h2>
          <div className="mt-3"><SpritePlayer image={sheet} layout={layout} /></div>
        </div>
      )}
      {review && (
        <div>
          <h2>Review sheet</h2>
          <p className="muted text-sm">What the reviewer saw: the zoomed grid, 1x on dark and light, 2x and 3x, silhouette, values and palette.</p>
          <a href={fileUrl(review)} target="_blank" rel="noreferrer" className="mt-3 block">
            <AssetImage src={fileUrl(review)} width={1280} alt="Review sheet of this version"
              className="w-full rounded-lg border" />
          </a>
        </div>
      )}
      {entries.length > 0 && (
        <div>
          <h2>Engine files</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {entries.map(([id, key]) => (
              <li key={id}>
                <Button variant="outline" size="sm" asChild>
                  <a href={fileUrl(key)} download aria-label={`Download ${label(id, key)}`}>
                    <Download size={14} /> {label(id, key)}
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
