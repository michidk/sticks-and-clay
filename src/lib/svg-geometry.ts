import type { Element } from "@xmldom/xmldom";
import svgpath from "svgpath";

type Point = [number, number];
type Stroke = { element: string; width: string; cap: string; join: string };
type Endpoint = { element: string; subpath: number; at: Point };
type Finding =
  | { kind: "near-endpoints"; first: Endpoint; second: Endpoint; distance: number }
  | { kind: "duplicate-segment"; first: string; second: string; from: Point; to: Point };

const limit = 512;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const pointKey = (p: Point) => p.map(round).join(",");

/** Advisory geometry evidence, never a reason to change or reject artwork by itself. */
export function svgGeometry(root: Element) {
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const threshold = Math.min(box[2], box[3]) / 48;
  const strokes: Stroke[] = [];
  const endpoints: Endpoint[] = [];
  const findings: Finding[] = [];
  const segments = new Map<string, string>();
  let processed = 0, skipped = 0, truncated = false, ordinal = 0;
  const add = (finding: Finding) => {
    if (findings.length < 64) findings.push(finding);
    else truncated = true;
  };
  const walk = (node: Element, inherited: Record<string, string>, transforms: string, depth = 0) => {
    if (depth > 64) { skipped++; return; }
    if (processed >= limit) { truncated = true; return; }
    const element = `${node.tagName}[${++ordinal}]${node.getAttribute("id") ? `#${node.getAttribute("id")}` : ""}`;
    if (["defs", "clipPath", "linearGradient", "radialGradient", "title", "desc"].includes(node.tagName)) return;
    // Nested viewports need a separate coordinate mapping; don't report misleading distances.
    if (node !== root && node.tagName === "svg") { skipped++; return; }
    if (node.getAttribute("opacity") === "0") return;
    const style = { ...inherited };
    for (const key of ["stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity"])
      if (node.hasAttribute(key) && node.getAttribute(key) !== "inherit") style[key] = node.getAttribute(key) ?? "";
    const transform = `${transforms} ${node.getAttribute("transform") ?? ""}`.trim();
    if (["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"].includes(node.tagName)
      && style.stroke !== "none" && style["stroke-opacity"] !== "0" && Number.parseFloat(style["stroke-width"]) !== 0) {
      if (strokes.length < 128) strokes.push({ element, width: style["stroke-width"], cap: style["stroke-linecap"], join: style["stroke-linejoin"] });
      else truncated = true;
      let source = node.getAttribute("d") ?? "";
      if (node.tagName === "line") source = `M${node.getAttribute("x1") || 0} ${node.getAttribute("y1") || 0}L${node.getAttribute("x2") || 0} ${node.getAttribute("y2") || 0}`;
      if (["polyline", "polygon"].includes(node.tagName)) source = `M${node.getAttribute("points") ?? ""}${node.tagName === "polygon" ? "Z" : ""}`;
      if (source) {
        const path = svgpath(source).abs().unshort().unarc().transform(transform);
        if (!path.toString()) skipped++;
        let start: Point = [0, 0], end: Point = [0, 0], subpath = 0, drawn = false, closed = false;
        const finish = () => {
          if (drawn && !closed) {
            if (endpoints.length + 2 <= limit) endpoints.push({ element, subpath, at: start }, { element, subpath, at: end });
            else truncated = true;
          }
        };
        path.iterate((segment, _index, x, y) => {
          if (++processed > limit) { truncated = true; return; }
          const from: Point = [x, y];
          let to: Point;
          let controls: Point[] = [];
          if (closed && !["M", "Z", "z"].includes(segment[0])) {
            start = from; subpath++; drawn = false; closed = false;
          }
          switch (segment[0]) {
            case "M": finish(); start = [segment[1], segment[2]]; end = start; subpath++; drawn = false; closed = false; return;
            case "L": to = [segment[1], segment[2]]; break;
            case "H": to = [segment[1], y]; break;
            case "V": to = [x, segment[1]]; break;
            case "C": controls = [[segment[1], segment[2]], [segment[3], segment[4]]]; to = [segment[5], segment[6]]; break;
            case "Q": controls = [[segment[1], segment[2]]]; to = [segment[3], segment[4]]; break;
            case "Z": case "z": to = start; closed = true; break;
            default: skipped++; return;
          }
          end = to;
          drawn = true;
          if (![...from, ...to, ...controls.flat()].every(Number.isFinite)) { skipped++; return; }
          if (pointKey(from) === pointKey(to) && controls.length === 0) return;
          const points = [from, ...controls, to];
          const key = [points.map(pointKey).join(";"), [...points].reverse().map(pointKey).join(";")].sort()[0];
          const first = segments.get(key);
          if (first) add({ kind: "duplicate-segment", first, second: element, from, to });
          else segments.set(key, element);
        });
        if (processed <= limit) finish();
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling)
      if (child.nodeType === 1 && "tagName" in child) walk(child as Element, style, transform, depth + 1);
  };
  walk(root, { stroke: "none", "stroke-width": "1", "stroke-linecap": "butt", "stroke-linejoin": "miter", "stroke-opacity": "1" }, "");
  for (let i = 0; i < endpoints.length; i++) {
    const first = endpoints[i];
    for (const second of endpoints.slice(i + 1)) {
      const distance = Math.hypot(first.at[0] - second.at[0], first.at[1] - second.at[1]);
      if (distance <= threshold) add({ kind: "near-endpoints", first, second, distance: round(distance) });
    }
  }
  return { coordinateSpace: "root viewBox; stroke widths are local user units", endpointThreshold: threshold,
    strokes, mixedStrokeSettings: {
      width: new Set(strokes.map(s => s.width)).size > 1,
      cap: new Set(strokes.map(s => s.cap)).size > 1,
      join: new Set(strokes.map(s => s.join)).size > 1,
    }, openSubpaths: endpoints.length / 2, findings, skipped, truncated };
}
