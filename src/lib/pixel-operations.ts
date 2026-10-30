import { z } from "zod";

const coordinate = z.number().int().min(0).max(127);
const point = z.object({ x: coordinate, y: coordinate });
const ink = { key: z.string().length(1), target: z.string().max(40).optional() };
export const pixelOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rectangle"), ...ink, x: coordinate, y: coordinate, width: z.number().int().min(1).max(128), height: z.number().int().min(1).max(128) }),
  z.object({ kind: z.literal("ellipse"), ...ink, x: coordinate, y: coordinate, width: z.number().int().min(1).max(128), height: z.number().int().min(1).max(128) }),
  z.object({ kind: z.literal("line"), ...ink, from: point, to: point }),
  z.object({ kind: z.literal("polygon"), ...ink, points: z.array(point).min(3).max(32) }),
]);

/** Integer cells touched by a bounded drawing operation; no smoothing or palette interpolation. */
export function operationCells(operation: z.infer<typeof pixelOperationSchema>): [number, number][] {
  const cells: [number, number][] = [];
  const line = (from: z.infer<typeof point>, to: z.infer<typeof point>) => {
    let { x, y } = from;
    const dx = Math.abs(to.x - x), dy = -Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      cells.push([x, y]);
      if (x === to.x && y === to.y) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x += sx; }
      if (twice <= dx) { error += dx; y += sy; }
    }
  };
  switch (operation.kind) {
    case "line": line(operation.from, operation.to); break;
    case "rectangle":
    case "ellipse":
      for (let y = 0; y < operation.height; y++) for (let x = 0; x < operation.width; x++) {
        if (operation.kind === "rectangle" || ((2 * x + 1 - operation.width) / operation.width) ** 2 + ((2 * y + 1 - operation.height) / operation.height) ** 2 <= 1)
          cells.push([operation.x + x, operation.y + y]);
      }
      break;
    case "polygon": {
      const points = operation.points;
      const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i], b = points[j];
          if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        if (inside) cells.push([x, y]);
      }
      points.forEach((p, i) => line(p, points[(i + 1) % points.length]));
      break;
    }
  }
  return cells;
}
