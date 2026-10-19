// Checks a built artboard against the browser: OpenPencil lays it out, and any
// auto-layout frame whose children do not land on their measured boxes falls
// back to placing them at those boxes. The result looks like the page by
// construction, and keeps auto layout wherever it reproduces the page.
import { initCanvasKit, SkiaRenderer } from '@open-pencil/core'
import {
  installTextMeasurer,
  layoutAuthoredNodes,
} from '@open-pencil/core/layout'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { near } from './build'
import type { Box } from './snapshot'

// Text measured with the design fonts can run a pixel or two wider than in Chrome.
const TOLERANCE = 3

export interface LayoutReport {
  layers: number
  autoLayout: number
  fallbacks: string[]
}

function placed(graph: SceneGraph, id: string, rootId: string): Box | null {
  const node = graph.getNode(id)
  if (!node) return null
  const at = graph.getAbsolutePosition(id)
  const root = graph.getAbsolutePosition(rootId)
  return {
    x: at.x - root.x,
    y: at.y - root.y,
    width: node.width,
    height: node.height,
  }
}

/** Whether a layer sizes itself to its content along an axis, so the fonts decide that size. */
function hugs(node: SceneNode, axis: 'x' | 'y') {
  if (node.type === 'TEXT')
    return (
      node.textAutoResize === 'WIDTH_AND_HEIGHT' ||
      (axis === 'y' && node.textAutoResize === 'HEIGHT')
    )
  if (node.layoutMode === 'NONE' || node.layoutMode === 'GRID') return false
  const primary = (node.layoutMode === 'HORIZONTAL') === (axis === 'x')
  return (primary ? node.primaryAxisSizing : node.counterAxisSizing) === 'HUG'
}

// A content-sized layer may come out a few percent off Chrome; larger gaps are layout errors.
const SIZE_DRIFT = 0.06

/**
 * The first child an auto-layout frame does not put on its measured box. Content-sized
 * children may differ in size by the font drift, and later siblings may shift by as much.
 */
function misplacedChild(
  graph: SceneGraph,
  node: SceneNode,
  children: SceneNode[],
  rootId: string,
  measured: Map<string, Box>,
) {
  const axis = node.layoutMode === 'VERTICAL' ? 'y' : 'x'
  const stacks = node.layoutMode !== 'GRID' && node.layoutWrap !== 'WRAP'
  // Each frame answers for its own children: positions count from where it actually sits.
  const frameBox = measured.get(node.id)
  const frameAt = placed(graph, node.id, rootId)
  if (!frameBox || !frameAt) return undefined
  let slack = 0
  // Borders are inside strokes that take no room, so children sit up to a border closer to it.
  const border =
    Math.max(
      node.borderTopWeight,
      node.borderLeftWeight,
      node.strokes[0]?.weight ?? 0,
    ) * 2
  // A growing child takes up what its content-sized siblings' font drift frees or claims.
  let siblingDrift = 0
  for (const child of children) {
    const box = measured.get(child.id)
    if (box && stacks && hugs(child, axis))
      siblingDrift += Math.min(
        Math.abs((axis === 'x' ? child.width - box.width : child.height - box.height)),
        TOLERANCE + (axis === 'x' ? box.width : box.height) * SIZE_DRIFT,
      )
  }
  for (const child of children) {
    const box = measured.get(child.id)
    const at = box && placed(graph, child.id, rootId)
    if (!box || !at) continue
    const got = { ...at, x: at.x - frameAt.x, y: at.y - frameAt.y }
    const want = { ...box, x: box.x - frameBox.x, y: box.y - frameBox.y }
    const grown = (a: 'x' | 'y') => (stacks && a === axis && child.layoutGrow > 0 ? siblingDrift : 0)
    const drift = (a: 'x' | 'y') => {
      const difference = Math.abs(
        a === 'x' ? got.width - want.width : got.height - want.height,
      )
      return hugs(child, a) &&
        difference <=
          TOLERANCE + (a === 'x' ? want.width : want.height) * SIZE_DRIFT
        ? difference
        : 0
    }
    const tolerance = (a: 'x' | 'y') =>
      TOLERANCE + border + drift(a) + (stacks && a === axis ? slack : 0)
    if (
      !near(got.x, want.x, tolerance('x')) ||
      !near(got.y, want.y, tolerance('y')) ||
      !near(got.width, want.width, TOLERANCE + border + drift('x') + grown('x')) ||
      !near(got.height, want.height, TOLERANCE + border + drift('y') + grown('y'))
    )
      return child
    if (stacks && child.layoutPositioning !== 'ABSOLUTE') slack += drift(axis)
  }
  return undefined
}

/** Frees a frame from auto layout, keeping each child at its measured box. */
function fallBack(
  graph: SceneGraph,
  frameId: string,
  measured: Map<string, Box>,
) {
  const frame = graph.getNode(frameId)
  const frameBox = measured.get(frameId)
  if (!frame || !frameBox) return
  for (const child of graph.getChildren(frameId)) {
    if (child.name === 'spacer' && !measured.has(child.id)) {
      graph.deleteNode(child.id)
      continue
    }
    const box = measured.get(child.id)
    if (!box) continue
    graph.updateNode(child.id, {
      layoutPositioning: 'AUTO',
      layoutGrow: 0,
      layoutAlignSelf: 'AUTO',
      x: box.x - frameBox.x,
      y: box.y - frameBox.y,
      width: box.width,
      height: box.height,
    })
  }
  graph.updateNode(frameId, {
    layoutMode: 'NONE',
    width: frameBox.width,
    height: frameBox.height,
  })
}

let skia: SkiaRenderer | null = null

/**
 * The editor measures text with CanvasKit; the headless fallback measurer ignores letter
 * spacing. Measuring the same way keeps the check honest about what the editor shows.
 */
async function textRenderer(graph: SceneGraph, rootId: string) {
  if (!skia) {
    const ck = await initCanvasKit()
    const surface = ck.MakeSurface(1, 1)
    if (!surface) throw new Error('CanvasKit could not make a surface')
    skia = new SkiaRenderer(ck, surface)
    await skia.loadFonts()
  }
  const pageId = graph.pageOf(rootId)
  if (!pageId) throw new Error('the artboard is not on a page')
  // Loads the artboard's fonts into the renderer.
  await skia.prepareForExport(graph, pageId, [rootId])
  return skia
}

export async function checkLayout(
  graph: SceneGraph,
  rootId: string,
  measured: Map<string, Box>,
  options: { fallBack?: boolean } = {},
): Promise<LayoutReport> {
  const renderer = await textRenderer(graph, rootId)
  const uninstall = installTextMeasurer((node, maxWidth) =>
    renderer.measureTextNode(node, maxWidth),
  )
  try {
    return layoutAgainst(graph, rootId, measured, options.fallBack ?? true)
  } finally {
    uninstall()
  }
}

function layoutAgainst(
  graph: SceneGraph,
  rootId: string,
  measured: Map<string, Box>,
  fix: boolean,
): LayoutReport {
  const fallbacks: string[] = []
  for (let pass = 0; pass < 8; pass++) {
    layoutAuthoredNodes(graph, [rootId])
    // Top-down: a frame is blamed only when it sits right but its children do not.
    const blamed: string[] = []
    const walk = (id: string) => {
      const node = graph.getNode(id)
      if (!node) return
      const children = graph.getChildren(id)
      if (node.layoutMode !== 'NONE') {
        const off = misplacedChild(graph, node, children, rootId, measured)
        if (off && process.env.DEBUG_LAYOUT) {
          const box = measured.get(off.id)
          const at = placed(graph, off.id, rootId)
          const f = (b: Box | null | undefined) =>
            b &&
            [b.x, b.y, b.width, b.height]
              .map((v) => Math.round(v * 10) / 10)
              .join(',')
          const kids = graph
            .getChildren(off.id)
            .map(
              (kid) =>
                `${kid.type}:${kid.name}:${kid.layoutPositioning}:${Math.round(kid.width)}x${Math.round(kid.height)}`,
            )
          console.log(
            `${node.name} [${node.layoutMode}] child ${off.type} "${off.name}" want ${f(box)} got ${f(at)}`,
            JSON.stringify({
              mode: off.layoutMode,
              ps: off.primaryAxisSizing,
              cs: off.counterAxisSizing,
              grow: off.layoutGrow,
              self: off.layoutAlignSelf,
              pad: [
                off.paddingTop,
                off.paddingRight,
                off.paddingBottom,
                off.paddingLeft,
              ],
              gap: off.itemSpacing,
              kids,
            }),
          )
        }
        if (off) {
          blamed.push(id)
          return
        }
      }
      for (const child of children)
        if (child.type === 'FRAME' || child.type === 'INSTANCE') walk(child.id)
    }
    walk(rootId)
    if (!fix)
      fallbacks.push(...blamed.map((id) => graph.getNode(id)?.name ?? id))
    if (!blamed.length || !fix) break
    for (const id of blamed) {
      fallBack(graph, id, measured)
      fallbacks.push(graph.getNode(id)?.name ?? id)
    }
  }
  let layers = 0
  let autoLayout = 0
  const count = (id: string) => {
    for (const child of graph.getChildren(id)) {
      layers++
      if (child.layoutMode !== 'NONE') autoLayout++
      count(child.id)
    }
  }
  count(rootId)
  return { layers, autoLayout, fallbacks }
}
