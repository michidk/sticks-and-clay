// Turns a page snapshot into OpenPencil layers. Layout is inferred from the
// browser's measured boxes rather than re-derived from CSS, so auto layout
// reproduces the page: flex and block stacks become auto-layout frames, CSS
// grids become grid layouts, `ml-auto`-style gaps become grow spacers, and
// positioned elements become absolute children with matching constraints.
import {
  createSVGNodesFromImport,
  prepareSVGImport,
} from '@open-pencil/core/io/formats/svg'
import type {
  Color,
  Effect,
  Fill,
  GridTrack,
  LayoutAlign,
  LayoutCounterAlign,
  SceneGraph,
  SceneNode,
  Stroke,
  StyleRun,
} from '@open-pencil/scene-graph'
import { parseCSSShadows } from '@open-pencil/scene-graph/css'
import { linearGradientTransform } from '@open-pencil/scene-graph/gradient'
import { computeImageHash } from '@open-pencil/scene-graph/images'
import type {
  Background,
  Box,
  RGBA,
  SnapshotElement,
  SnapshotNode,
  SnapshotText,
} from './snapshot'
import type { ColorUse } from './tokens'

/** Within this many pixels two measurements are the same. */
const EPSILON = 1

type Mode = SceneNode['layoutMode']
type Axis = 'x' | 'y'

export const px = (value: string | undefined) => {
  const number = Number.parseFloat(value ?? '')
  return Number.isFinite(number) ? number : 0
}
export const near = (a: number, b: number, tolerance = EPSILON) =>
  Math.abs(a - b) <= tolerance
// Geometry snaps to whole pixels, as design files keep it; type keeps its fractions.
const round = Math.round
const fine = (value: number) => Math.round(value * 100) / 100
const end = (box: Box, axis: Axis) =>
  axis === 'x' ? box.x + box.width : box.y + box.height
const size = (box: Box, axis: Axis) => (axis === 'x' ? box.width : box.height)
const color = ({ r, g, b, a }: RGBA): Color => ({ r, g, b, a })
const sourceFile = (source: string | undefined) => source?.split(':')[0]

function parseColor(value: string | undefined): RGBA {
  const match = value?.match(
    /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/,
  )
  if (!match) return { r: 0, g: 0, b: 0, a: 0 }
  const [, r, g, b, a] = match
  return {
    r: Number(r) / 255,
    g: Number(g) / 255,
    b: Number(b) / 255,
    a: a === undefined ? 1 : Number(a),
  }
}

/** `top` composited over an opaque `bottom`. */
const over = (top: RGBA, bottom: RGBA): RGBA => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
})
const css = ({ r, g, b, a }: RGBA) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`

function solid(rgba: RGBA): Fill {
  return {
    type: 'SOLID',
    color: { ...color(rgba), a: 1 },
    opacity: rgba.a,
    visible: true,
  }
}

interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

function paddingOf(style: Record<string, string>): Padding {
  return {
    top: px(style['padding-top']) + px(style['border-top-width']),
    right: px(style['padding-right']) + px(style['border-right-width']),
    bottom: px(style['padding-bottom']) + px(style['border-bottom-width']),
    left: px(style['padding-left']) + px(style['border-left-width']),
  }
}

function decorated(element: SnapshotElement) {
  const style = element.style
  return (
    parseColor(style['background-color']).a > 0 ||
    element.backgrounds.length > 0 ||
    (style['box-shadow'] ?? 'none') !== 'none' ||
    ['top', 'right', 'bottom', 'left'].some(
      (side) => px(style[`border-${side}-width`]) > 0,
    ) ||
    (style['backdrop-filter'] ?? 'none') !== 'none' ||
    px(style.opacity || '1') < 1
  )
}

const positioned = (node: SnapshotNode) =>
  node.kind === 'element' &&
  ['absolute', 'fixed'].includes(node.style.position ?? '')

const boxesMatch = (a: Box, b: Box) =>
  near(a.x, b.x) &&
  near(a.y, b.y) &&
  near(a.width, b.width) &&
  near(a.height, b.height)

// Box-placing properties an element hands to the child that replaces it.
const OUTER_PROPS = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'flex-grow',
  'align-self',
]

/** Drops wrappers that draw nothing and only pass one child through at the same box. */
export function simplify(element: SnapshotElement): SnapshotElement {
  element.children = element.children.map((child) => {
    if (child.kind === 'text') return child
    let current = simplify(child)
    for (;;) {
      const inner = current.children[0]
      if (
        current.children.length !== 1 ||
        inner?.kind !== 'element' ||
        decorated(current) ||
        ['hidden', 'clip'].includes(current.style['overflow-x'] ?? '') ||
        !boxesMatch(current.box, inner.box)
      )
        break
      for (const prop of OUTER_PROPS) {
        const value = current.style[prop]
        if (value && !['static', '0', 'auto', 'normal'].includes(value))
          inner.style[prop] = value
      }
      inner.source ??= current.source
      if (/^(div|span)$/.test(inner.name) && !/^(div|span)$/.test(current.name))
        inner.name = current.name
      current = inner
    }
    return current
  })
  return element
}

interface Plan {
  mode: Mode
  wrap: boolean
  spacing: number
  counterSpacing: number
  primaryAlign: LayoutAlign
  counterAlign: LayoutCounterAlign
  padding: Padding
  /** Extra space before each flow child beyond `spacing`. */
  extra: number[]
  /** Index of the flow child a grow spacer goes before. */
  spacerAt?: number
  /** Per flow child: how it sits on the counter axis. */
  align: LayoutCounterAlign[]
  grid?: {
    columns: GridTrack[]
    rows: GridTrack[]
    cells: {
      column: number
      row: number
      columnSpan: number
      rowSpan: number
    }[]
  }
}

function counterAlignOf(
  kid: Box,
  start: number,
  stop: number,
  axis: Axis,
): LayoutCounterAlign {
  const before = (axis === 'x' ? kid.x : kid.y) - start
  const after = stop - end(kid, axis)
  if (near(before, 0) && near(after, 0)) return 'STRETCH'
  if (near(before, 0)) return 'MIN'
  if (near(after, 0)) return 'MAX'
  // Glyphs sit a little off their line's centre, so centring gets a looser check.
  if (near(before, after, 2)) return 'CENTER'
  return 'MIN'
}

function mostCommon<T>(values: T[], fallback: T): T {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = fallback
  let bestCount = 0
  for (const [value, count] of counts)
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  return best
}

function gridPlan(
  element: SnapshotElement,
  flow: SnapshotNode[],
  padding: Padding,
): Plan['grid'] {
  const tracks = (value: string | undefined) =>
    (value ?? '')
      .split(/\s+/)
      .map(px)
      .filter((track) => track > 0)
  const columns = tracks(element.style['grid-template-columns'])
  const rows = tracks(element.style['grid-template-rows'])
  if (!columns.length || !rows.length) return undefined
  const starts = (list: number[], origin: number, gap: number) => {
    let at = origin
    return list.map((track) => {
      const start = at
      at += track + gap
      return start
    })
  }
  const columnStarts = starts(
    columns,
    element.box.x + padding.left,
    px(element.style['column-gap']),
  )
  const rowStarts = starts(
    rows,
    element.box.y + padding.top,
    px(element.style['row-gap']),
  )
  const cells: NonNullable<Plan['grid']>['cells'] = []
  for (const kid of flow) {
    const column = columnStarts.findIndex((start) => near(start, kid.box.x, 2))
    const row = rowStarts.findIndex((start) => near(start, kid.box.y, 2))
    if (column < 0 || row < 0) return undefined
    const columnEnd = columnStarts.findIndex((start, i) =>
      near(start + (columns[i] ?? 0), end(kid.box, 'x'), 2),
    )
    const rowEnd = rowStarts.findIndex((start, i) =>
      near(start + (rows[i] ?? 0), end(kid.box, 'y'), 2),
    )
    // Grid lines count from 1, as in CSS.
    cells.push({
      column: column + 1,
      row: row + 1,
      columnSpan: columnEnd >= column ? columnEnd - column + 1 : 1,
      rowSpan: rowEnd >= row ? rowEnd - row + 1 : 1,
    })
  }
  const equal = columns.every((column) => near(column, columns[0] as number))
  return {
    columns: columns.map((value) =>
      equal
        ? { sizing: 'FR', value: 1 }
        : { sizing: 'FIXED', value: round(value) },
    ),
    rows: rows.map(() => ({ sizing: 'AUTO', value: 0 })),
    cells,
  }
}

/** Rows a wrapping flex container's children form: children whose heights overlap share one. */
function lineCount(flow: SnapshotNode[]) {
  let lines = 0
  let bottom = -Infinity
  for (const kid of [...flow].sort((a, b) => a.box.y - b.box.y)) {
    if (kid.box.y >= bottom - EPSILON) lines++
    bottom = Math.max(bottom, end(kid.box, 'y'))
  }
  return lines
}

/** Reads how an element lays out its in-flow children from their measured boxes. */
function plan(element: SnapshotElement, flow: SnapshotNode[]): Plan {
  const style = element.style
  const padding = paddingOf(style)
  const none: Plan = {
    mode: 'NONE',
    wrap: false,
    spacing: 0,
    counterSpacing: 0,
    primaryAlign: 'MIN',
    counterAlign: 'MIN',
    padding,
    extra: [],
    align: [],
  }
  if (!flow.length) return none
  const display = style.display ?? 'block'

  if (display.endsWith('grid')) {
    const grid = gridPlan(element, flow, padding)
    if (grid)
      return {
        ...none,
        mode: 'GRID',
        spacing: round(px(style['column-gap'])),
        counterSpacing: round(px(style['row-gap'])),
        align: flow.map(() => 'STRETCH'),
        grid,
      }
  }

  let mode: Mode
  const follows = (axis: Axis) =>
    flow.every(
      (kid, i) =>
        i === 0 ||
        (axis === 'x' ? kid.box.x : kid.box.y) >=
          end((flow[i - 1] as SnapshotNode).box, axis) - EPSILON,
    )
  if (display.endsWith('flex')) {
    if ((style['flex-direction'] ?? '').endsWith('reverse')) return none
    mode = (style['flex-direction'] ?? 'row').startsWith('column')
      ? 'VERTICAL'
      : 'HORIZONTAL'
  } else if (follows('y')) mode = 'VERTICAL'
  else if (follows('x')) mode = 'HORIZONTAL'
  else return none
  const axis: Axis = mode === 'HORIZONTAL' ? 'x' : 'y'
  const cross: Axis = axis === 'x' ? 'y' : 'x'

  const contentStart = (a: Axis) =>
    a === 'x' ? element.box.x + padding.left : element.box.y + padding.top
  const contentEnd = (a: Axis) =>
    a === 'x'
      ? element.box.x + element.box.width - padding.right
      : element.box.y + element.box.height - padding.bottom

  const wraps = mode === 'HORIZONTAL' && style['flex-wrap'] === 'wrap'
  if (wraps && lineCount(flow) > 1)
    return {
      ...none,
      mode,
      wrap: true,
      spacing: round(px(style['column-gap'])),
      counterSpacing: round(px(style['row-gap'])),
      align: flow.map(() => 'MIN'),
    }

  // Children must follow each other along the axis without overlapping.
  if (!follows(axis)) return none
  const gaps = flow
    .slice(1)
    .map(
      (kid, i) =>
        (axis === 'x' ? kid.box.x : kid.box.y) -
        end((flow[i] as SnapshotNode).box, axis),
    )

  const first = flow[0] as SnapshotNode
  const last = flow.at(-1) as SnapshotNode
  const leading =
    (axis === 'x' ? first.box.x : first.box.y) - contentStart(axis)
  const trailing = contentEnd(axis) - end(last.box, axis)

  let spacing = gaps.length ? Math.max(0, Math.min(...gaps)) : 0
  let primaryAlign: LayoutAlign = 'MIN'
  let spacerAt: number | undefined
  const extra = [0, ...gaps.map((gap) => Math.max(0, gap - spacing))]
  const spread = extra.filter((value) => value > EPSILON)

  const grows = flow.some(
    (kid) => kid.kind === 'element' && px(kid.style['flex-grow']) > 0,
  )
  if (grows) {
    // A growing child takes the free space, so the gaps are the CSS gap and nothing more.
    spacing = Math.max(0, Math.min(...gaps, Number.POSITIVE_INFINITY))
    if (!Number.isFinite(spacing)) spacing = 0
    extra.splice(
      0,
      extra.length,
      0,
      ...gaps.map((gap) => Math.max(0, gap - spacing)),
    )
  } else if (
    style['justify-content'] === 'space-between' &&
    gaps.length &&
    near(leading, 0) &&
    near(trailing, 0)
  ) {
    primaryAlign = 'SPACE_BETWEEN'
    spacing = round(px(style[axis === 'x' ? 'column-gap' : 'row-gap']))
    extra.fill(0)
  } else if (spread.length === 1 && near(leading, 0) && near(trailing, 0)) {
    // One gap takes the slack: an `ml-auto` or `flex-1` push, which a grow spacer keeps.
    spacerAt = extra.findIndex((value) => value > EPSILON)
    extra.fill(0)
  } else if (near(leading, 0)) {
    primaryAlign = 'MIN'
  } else if (near(trailing, 0)) {
    primaryAlign = 'MAX'
  } else if (near(leading, trailing)) {
    primaryAlign = 'CENTER'
  } else if (leading > 0) {
    // Leading space nothing else explains moves into the padding.
    if (axis === 'x') padding.left += leading
    else padding.top += leading
  }

  const align = flow.map((kid) =>
    counterAlignOf(kid.box, contentStart(cross), contentEnd(cross), cross),
  )
  // A lone child that sits off both content edges pins to the nearer one, and the
  // padding on that side takes up the difference (negative margins pull it in).
  if (flow.length === 1 && align[0] === 'MIN') {
    const before =
      (cross === 'x' ? first.box.x : first.box.y) - contentStart(cross)
    const after = contentEnd(cross) - end(first.box, cross)
    const [startSide, endSide] =
      cross === 'x'
        ? (['left', 'right'] as const)
        : (['top', 'bottom'] as const)
    if (Math.abs(after) < Math.abs(before) && padding[endSide] + after >= 0) {
      padding[endSide] += after
      align[0] = 'MAX'
    } else if (padding[startSide] + before >= 0) {
      padding[startSide] += before
    }
  }
  return {
    mode,
    // One line needs no wrap, and .fig keeps a wrapping row's cross alignment differently.
    wrap: false,
    spacing: round(spacing),
    counterSpacing: 0,
    primaryAlign,
    counterAlign: mostCommon(
      align.filter((value) => value !== 'STRETCH'),
      'MIN' as LayoutCounterAlign,
    ),
    padding,
    extra: extra.map(round),
    spacerAt,
    align,
  }
}

export type ImageLoader = (url: string) => Promise<Uint8Array | null>

const TEXT_CASE: Record<string, SceneNode['textCase']> = {
  uppercase: 'UPPER',
  lowercase: 'LOWER',
  capitalize: 'TITLE',
}
const TEXT_ALIGN: Record<string, SceneNode['textAlignHorizontal']> = {
  center: 'CENTER',
  right: 'RIGHT',
  end: 'RIGHT',
  justify: 'JUSTIFIED',
}

function characterStyle(style: Record<string, string>) {
  const decoration = style['text-decoration-line'] ?? 'none'
  return {
    fontFamily:
      (style['font-family'] ?? 'Inter')
        .split(',')[0]
        ?.replaceAll('"', '')
        .trim() || 'Inter',
    fontSize: px(style['font-size']) || 16,
    fontWeight: Number.parseInt(style['font-weight'] ?? '400', 10),
    italic: style['font-style'] === 'italic',
    lineHeight:
      style['line-height'] === 'normal' ? null : fine(px(style['line-height'])),
    letterSpacing:
      style['letter-spacing'] === 'normal'
        ? 0
        : fine(px(style['letter-spacing'])),
    textCase: TEXT_CASE[style['text-transform'] ?? ''] ?? 'ORIGINAL',
    fontFeatures: (style['font-variant-numeric'] ?? '').includes('tabular-nums')
      ? [{ tag: 'tnum', enabled: true }]
      : [],
    textDecoration: decoration.includes('underline')
      ? ('UNDERLINE' as const)
      : decoration.includes('line-through')
        ? ('STRIKETHROUGH' as const)
        : ('NONE' as const),
    fills: [solid(parseColor(style.color))],
  }
}

function backgroundFill(
  background: Background,
  box: Box,
  imageHash?: string,
): Fill | null {
  if (background.type === 'linear') {
    // CSS angles run clockwise from "to top"; the gradient line spans the box's extent along it.
    const radians = (background.angle * Math.PI) / 180
    const dx = Math.sin(radians)
    const dy = -Math.cos(radians)
    const half = (Math.abs(box.width * dx) + Math.abs(box.height * dy)) / 2
    const start = {
      x: 0.5 - (dx * half) / box.width,
      y: 0.5 - (dy * half) / box.height,
    }
    const stop = {
      x: 0.5 + (dx * half) / box.width,
      y: 0.5 + (dy * half) / box.height,
    }
    return {
      type: 'GRADIENT_LINEAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: background.stops.map((item) => ({
        color: color(item.color),
        position: item.position,
      })),
      gradientTransform: linearGradientTransform(
        start,
        stop,
        box.width,
        box.height,
      ),
    }
  }
  if (!imageHash) return null
  return {
    type: 'IMAGE',
    imageHash,
    imageScaleMode: background.size.includes('contain')
      ? 'FIT'
      : background.size.includes('cover')
        ? 'FILL'
        : 'TILE',
    color: { r: 0, g: 0, b: 0, a: 0 },
    opacity: 1,
    visible: true,
  }
}

// Computed `left`/`right` report used pixels even when CSS left them `auto`, so the
// constraint comes from where the box sits in its container.
/**
 * The lines a text occupies. A range's rects cover the glyphs' ascent and descent, not the
 * line box, so the line height decides the height, centred on the glyphs.
 */
function lineBox(leaf: SnapshotText): Box {
  const style = leaf.runs[0]?.style ?? {}
  const lineHeight =
    style['line-height'] === 'normal'
      ? leaf.box.height / leaf.lines
      : px(style['line-height'])
  const height = lineHeight * leaf.lines
  return { ...leaf.box, y: leaf.box.y + (leaf.box.height - height) / 2, height }
}

const LAYOUT_NAMES: Record<Mode, string> = {
  HORIZONTAL: 'Row',
  VERTICAL: 'Stack',
  GRID: 'Grid',
  NONE: 'Layers',
}

/** Children as layout sees them: text by its line box rather than its glyphs. */
const lined = (flow: SnapshotNode[]) =>
  flow.map((kid) => (kid.kind === 'text' ? { ...kid, box: lineBox(kid) } : kid))

function constraint(
  box: Box,
  container: Box,
  axis: Axis,
): SceneNode['horizontalConstraint'] {
  const before = axis === 'x' ? box.x - container.x : box.y - container.y
  const after = end(container, axis) - end(box, axis)
  if (near(before, 0) && near(after, 0)) return 'STRETCH'
  if (near(before, after) && before > EPSILON) return 'CENTER'
  if (after < before) return 'MAX'
  return 'MIN'
}

export class SceneBuilder {
  /** The page box each built layer had in the browser, for the layout check. */
  readonly measured = new Map<string, Box>()
  /** The snapshot element each layer came from, for component extraction. */
  readonly elements = new Map<string, SnapshotElement>()
  /** Every solid color drawn, with its light and dark values, for binding to the theme. */
  readonly colors: ColorUse[] = []
  private fixed: SnapshotElement[] = []
  /** The opaque surface each element being built sits on, in both themes. */
  private backdrops: { light: RGBA; dark: RGBA }[] = []

  constructor(
    private graph: SceneGraph,
    private loadImage: ImageLoader,
  ) {}

  private async imageHash(url: string) {
    const bytes = await this.loadImage(url)
    if (!bytes) return undefined
    const hash = computeImageHash(bytes)
    this.graph.images.set(hash, bytes)
    return hash
  }

  private async paint(node: SceneNode, element: SnapshotElement) {
    const style = element.style
    const fills: Fill[] = []
    const background = parseColor(style['background-color'])
    const behind = this.backdrops.at(-1)
    const shadowed = (style['box-shadow'] ?? 'none') !== 'none'
    if (background.a > 0 && background.a < 1 && shadowed && behind) {
      // CSS paints a shadow only outside its box, the renderer also under a see-through
      // fill; over a solid surface the fill is that surface tinted, so it can be opaque.
      const dark = parseColor(style['background-color@dark'])
      const light = over(background, behind.light)
      fills.push(solid(light))
      this.recordColor(
        node.id,
        'fills/0/color',
        { light: css(light), 'light@dark': css(over(dark, behind.dark)) },
        'light',
      )
    } else if (background.a > 0) {
      fills.push(solid(background))
      this.recordColor(node.id, 'fills/0/color', style, 'background-color')
    }
    if (background.a === 1)
      this.backdrops.push({
        light: background,
        dark: parseColor(style['background-color@dark']),
      })
    // CSS lists the top background first; fills paint the last one on top.
    for (const layer of [...element.backgrounds].reverse()) {
      const hash =
        layer.type === 'image' ? await this.imageHash(layer.url) : undefined
      const fill = backgroundFill(layer, element.box, hash)
      if (fill) fills.push(fill)
    }

    const sides = ['top', 'right', 'bottom', 'left']
    const weights = sides.map((side) => px(style[`border-${side}-width`]))
    const strokes: Stroke[] = []
    const side = weights.findIndex((weight) => weight > 0)
    if (side >= 0)
      this.recordColor(
        node.id,
        'strokes/0/color',
        style,
        `border-${sides[side]}-color`,
      )
    if (side >= 0)
      strokes.push({
        ...solid(parseColor(style[`border-${sides[side]}-color`])),
        weight: weights[side] as number,
        align: 'INSIDE',
        ...(style['border-top-style'] === 'dashed'
          ? { dashPattern: [4, 4] }
          : {}),
      })
    const independent =
      side >= 0 && !weights.every((weight) => weight === weights[0])

    // CSS paints inset shadows inside the border, the renderer from the outer edge over the
    // inside stroke, hiding it. On a bordered layer the border wins: its inset highlight goes.
    const bordered = ['top', 'right', 'bottom', 'left'].some(
      (side) => px(style[`border-${side}-width`]) > 0,
    )
    const effects: Effect[] = parseCSSShadows(style['box-shadow']).filter(
      (effect) => !(bordered && effect.type === 'INNER_SHADOW'),
    )
    const blur = style['backdrop-filter']?.match(/blur\(([\d.]+)px\)/)
    if (blur)
      effects.push({
        type: 'BACKGROUND_BLUR',
        color: { r: 0, g: 0, b: 0, a: 0 },
        offset: { x: 0, y: 0 },
        radius: Number(blur[1]),
        spread: 0,
        visible: true,
      })

    const limit = Math.min(element.box.width, element.box.height) / 2
    const radius = (corner: string) =>
      round(Math.min(px(style[`border-${corner}-radius`]), limit))
    const corners = [
      'top-left',
      'top-right',
      'bottom-right',
      'bottom-left',
    ].map(radius)
    const [topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0] = corners

    this.graph.updateNode(node.id, {
      fills,
      strokes,
      effects,
      ...(independent
        ? {
            independentStrokeWeights: true,
            borderTopWeight: weights[0],
            borderRightWeight: weights[1],
            borderBottomWeight: weights[2],
            borderLeftWeight: weights[3],
          }
        : {}),
      opacity: style.opacity ? px(style.opacity) : 1,
      cornerRadius: topLeft,
      topLeftRadius: topLeft,
      topRightRadius: topRight,
      bottomRightRadius: bottomRight,
      bottomLeftRadius: bottomLeft,
      independentCorners: !corners.every((value) => value === topLeft),
      clipsContent: ['hidden', 'clip', 'auto', 'scroll'].includes(
        style['overflow-x'] ?? '',
      ),
    })
  }

  /**
   * A text layer. `room` is the width it gets: the text's own, or for a block
   * element holding only text, the element's.
   */
  private text(
    leaf: SnapshotText,
    parentId: string,
    origin: Box,
    room = leaf.box,
    name?: string,
  ) {
    const [base, ...rest] = leaf.runs
    if (!base) return null
    const baseStyle = characterStyle(base.style)
    const box = { ...lineBox(leaf), x: room.x, width: room.width }
    // `line-height: normal` depends on the font's metrics; pin the line the browser drew.
    baseStyle.lineHeight ??= fine(box.height / leaf.lines)
    const text = leaf.runs.map((run) => run.text).join('')
    const styleRuns: StyleRun[] = []
    let offset = base.text.length
    for (const run of rest) {
      const runStyle = characterStyle(run.style)
      const changed = Object.fromEntries(
        Object.entries(runStyle).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(baseStyle[key as keyof typeof baseStyle]),
        ),
      )
      if (Object.keys(changed).length)
        styleRuns.push({
          start: offset,
          length: run.text.length,
          style: changed,
        })
      offset += run.text.length
    }
    // One-line text hugs its characters unless its box gives it more room; text the
    // page cuts off with an ellipsis truncates the same way.
    const oneLine =
      leaf.lines === 1 && /nowrap|pre/.test(base.style['white-space'] ?? '')
    const truncates = oneLine && base.style['text-overflow'] === 'ellipsis'
    const hugs =
      !truncates &&
      leaf.lines === 1 &&
      (oneLine || near(room.width, leaf.box.width, 1.5))
    const node = this.graph.createNode('TEXT', parentId, {
      name: name ?? text.slice(0, 40),
      text,
      ...baseStyle,
      styleRuns,
      textAlignHorizontal: TEXT_ALIGN[base.style['text-align'] ?? ''] ?? 'LEFT',
      textAutoResize: hugs ? 'WIDTH_AND_HEIGHT' : 'HEIGHT',
      ...(truncates ? { textTruncation: 'ENDING' as const, maxLines: 1 } : {}),
      x: round(box.x - origin.x),
      y: round(box.y - origin.y),
      width: round(box.width),
      height: round(box.height),
    })
    this.measured.set(node.id, box)
    this.recordColor(node.id, 'fills/0/color', base.style, 'color')
    return node
  }

  private recordColor(
    nodeId: string,
    field: string,
    style: Record<string, string>,
    prop: string,
  ) {
    const light = style[prop]
    const dark = style[`${prop}@dark`]
    if (light && dark) this.colors.push({ nodeId, field, light, dark })
  }

  private svg(element: SnapshotElement, parentId: string, origin: Box) {
    const data = element.svg ? prepareSVGImport(element.svg) : null
    const frame = data
      ? createSVGNodesFromImport(this.graph, parentId, data, {
          name: element.name,
          x: round(element.box.x - origin.x),
          y: round(element.box.y - origin.y),
        })
      : null
    if (!frame) return null
    // The import gives its frame the default white fill; an icon draws only its strokes.
    this.graph.updateNode(frame.id, {
      fills: [],
      width: round(element.box.width),
      height: round(element.box.height),
    })
    // Paint in the icon's text color follows the theme with it.
    const ink = parseColor(element.style.color)
    const isInk = (paint: Fill) =>
      paint.type === 'SOLID' &&
      ['r', 'g', 'b'].every((c) =>
        near(paint.color[c as 'r'], ink[c as 'r'], 0.01),
      )
    const walk = (id: string) => {
      for (const child of this.graph.getChildren(id)) {
        if (child.name === 'Vector')
          this.graph.updateNode(child.id, { name: 'Path' })
        if (child.strokes[0] && isInk(child.strokes[0]))
          this.recordColor(child.id, 'strokes/0/color', element.style, 'color')
        if (child.fills[0] && isInk(child.fills[0]))
          this.recordColor(child.id, 'fills/0/color', element.style, 'color')
        walk(child.id)
      }
    }
    walk(frame.id)
    this.measured.set(frame.id, element.box)
    this.elements.set(frame.id, element)
    return frame
  }

  /** Builds a page's body into a fixed-size artboard under `parentId`. */
  async view(body: SnapshotElement, parentId: string, name: string) {
    const root = await this.element(simplify(body), parentId, {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })
    if (!root) throw new Error(`${name}: nothing to build`)
    this.graph.updateNode(root.id, {
      name,
      x: 0,
      y: 0,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      clipsContent: true,
    })
    // Fixed elements (the mobile tab bar) pin to the artboard, not their DOM parent.
    for (const element of this.fixed.splice(0)) {
      const node = await this.element(element, root.id, body.box)
      if (!node) continue
      this.graph.updateNode(node.id, {
        layoutPositioning: 'ABSOLUTE',
        horizontalConstraint: constraint(element.box, body.box, 'x'),
        verticalConstraint: constraint(element.box, body.box, 'y'),
      })
    }
    return root
  }

  async element(
    element: SnapshotElement,
    parentId: string,
    origin: Box,
    parentSource?: string,
  ): Promise<SceneNode | null> {
    if (element.svg) return this.svg(element, parentId, origin)
    const x = round(element.box.x - origin.x)
    const y = round(element.box.y - origin.y)
    const width = round(element.box.width)
    const height = round(element.box.height)
    // A layer that starts another component file says which, so it leads back to `src/`.
    const file = sourceFile(element.source)
    const name =
      file && file !== sourceFile(parentSource)
        ? `${element.name} · ${file.replace(/\.tsx$/, '')}`
        : element.name

    if (element.image !== undefined) {
      const node = this.graph.createNode('RECTANGLE', parentId, {
        name: element.name === 'img' ? 'image' : name,
        x,
        y,
        width,
        height,
      })
      await this.paint(node, element)
      if (parseColor(element.style['background-color']).a === 1)
        this.backdrops.pop()
      const hash = element.image
        ? await this.imageHash(element.image)
        : undefined
      if (hash)
        this.graph.updateNode(node.id, {
          fills: [
            {
              type: 'IMAGE',
              imageHash: hash,
              imageScaleMode:
                element.style['object-fit'] === 'contain' ? 'FIT' : 'FILL',
              color: { r: 0, g: 0, b: 0, a: 0 },
              opacity: 1,
              visible: true,
            },
          ],
        })
      this.measured.set(node.id, element.box)
      this.elements.set(node.id, element)
      return node
    }

    // An undecorated element that only holds text is the text layer itself.
    const only = element.children[0]
    if (
      element.children.length === 1 &&
      only?.kind === 'text' &&
      !decorated(element) &&
      Object.values(paddingOf(element.style)).every((value) => value === 0) &&
      near(element.box.height, lineBox(only).height, 1.5)
    ) {
      const room = element.style.display === 'inline' ? only.box : element.box
      const node = this.text(
        only,
        parentId,
        origin,
        room,
        /^(div|span|p|h\d|label|a)$/.test(element.name) ? undefined : name,
      )
      if (node) this.elements.set(node.id, element)
      return node
    }

    const frame = this.graph.createNode('FRAME', parentId, {
      name,
      x,
      y,
      width,
      height,
    })
    this.measured.set(frame.id, element.box)
    this.elements.set(frame.id, element)
    await this.paint(frame, element)

    const kids = element.children.filter((kid) => {
      if (kid.kind === 'element' && kid.style.position === 'fixed') {
        this.fixed.push(kid)
        return false
      }
      return true
    })
    const flow = kids.filter((kid) => !positioned(kid))
    const layout = plan(element, lined(flow))
    const padding = layout.padding
    this.graph.updateNode(frame.id, {
      layoutMode: layout.mode,
      layoutWrap: layout.wrap ? 'WRAP' : 'NO_WRAP',
      itemSpacing: layout.spacing,
      counterAxisSpacing: layout.counterSpacing,
      primaryAxisAlign: layout.primaryAlign,
      counterAxisAlign: layout.counterAlign,
      // Borders are inside strokes that take no room, as in Figma, so padding is the CSS
      // padding and lands on the spacing scale.
      paddingTop: round(padding.top - px(element.style['border-top-width'])),
      paddingRight: round(
        padding.right - px(element.style['border-right-width']),
      ),
      paddingBottom: round(
        padding.bottom - px(element.style['border-bottom-width']),
      ),
      paddingLeft: round(padding.left - px(element.style['border-left-width'])),
      ...(layout.grid
        ? {
            gridTemplateColumns: layout.grid.columns,
            gridTemplateRows: layout.grid.rows,
            gridColumnGap: layout.spacing,
            gridRowGap: layout.counterSpacing,
          }
        : {}),
    })

    const axis: Axis = layout.mode === 'HORIZONTAL' ? 'x' : 'y'
    let flowIndex = 0
    for (const kid of kids) {
      const inFlow = !positioned(kid)
      const index = inFlow ? flowIndex++ : -1
      if (inFlow && index === layout.spacerAt) {
        const spacer = this.graph.createNode('FRAME', frame.id, {
          name: 'spacer',
          width: 1,
          height: 1,
          fills: [],
        })
        this.graph.updateNode(spacer.id, { layoutGrow: 1 })
      }
      const extra =
        inFlow && (layout.mode === 'HORIZONTAL' || layout.mode === 'VERTICAL')
          ? (layout.extra[index] ?? 0)
          : 0
      let parent = frame.id
      let kidOrigin = element.box
      if (extra > EPSILON) {
        // Space only this child has before it becomes the padding of a wrapper.
        const box =
          axis === 'x'
            ? { ...kid.box, x: kid.box.x - extra, width: kid.box.width + extra }
            : {
                ...kid.box,
                y: kid.box.y - extra,
                height: kid.box.height + extra,
              }
        const wrapper = this.graph.createNode('FRAME', frame.id, {
          name: 'spacing',
          fills: [],
          layoutMode: layout.mode,
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'HUG',
          ...(axis === 'x' ? { paddingLeft: extra } : { paddingTop: extra }),
          x: round(box.x - element.box.x),
          y: round(box.y - element.box.y),
          width: round(box.width),
          height: round(box.height),
        })
        this.measured.set(wrapper.id, box)
        this.sizeChild(wrapper, layout, index, kid, axis)
        // Margin wrappers keep their measured extent; .fig growth adds their padding twice on reopen.
        if (wrapper.layoutGrow > 0)
          this.graph.updateNode(wrapper.id, { layoutGrow: 0, primaryAxisSizing: 'FIXED' })
        parent = wrapper.id
        kidOrigin = box
      }
      const node =
        kid.kind === 'text'
          ? this.text(kid, parent, kidOrigin)
          : await this.element(kid, parent, kidOrigin, element.source)
      if (!node) continue
      if (!inFlow && kid.kind === 'element') {
        this.graph.updateNode(node.id, {
          layoutPositioning: 'ABSOLUTE',
          horizontalConstraint: constraint(kid.box, element.box, 'x'),
          verticalConstraint: constraint(kid.box, element.box, 'y'),
        })
      } else if (parent !== frame.id) {
        if (layout.align[index] === 'STRETCH') {
          this.graph.updateNode(node.id, { layoutAlignSelf: 'STRETCH' })
          if (node.type === 'TEXT' && axis === 'y')
            this.graph.updateNode(node.id, { textAutoResize: 'HEIGHT' })
        }
      } else {
        this.sizeChild(node, layout, index, kid, axis)
      }
    }
    this.sizeSelf(frame, element, layout, lined(flow), axis)
    // A bare HTML container is named for what it does in the layout.
    if (name === element.name && /^(div|span|section)$/.test(name))
      this.graph.updateNode(frame.id, { name: LAYOUT_NAMES[layout.mode] })
    if (parseColor(element.style['background-color']).a === 1)
      this.backdrops.pop()
    return frame
  }

  private sizeChild(
    node: SceneNode,
    layout: Plan,
    index: number,
    kid: SnapshotNode,
    axis: Axis,
  ) {
    if (layout.mode === 'NONE') return
    if (layout.mode === 'GRID') {
      const cell = layout.grid?.cells[index]
      // Cells fill their column; rows size to their content, as CSS auto rows do.
      if (cell)
        this.graph.updateNode(node.id, { gridPosition: cell, layoutGrow: 1 })
      return
    }
    const cross: Axis = axis === 'x' ? 'y' : 'x'
    const align = layout.align[index] ?? 'MIN'
    const grows =
      !layout.wrap && kid.kind === 'element' && px(kid.style['flex-grow']) > 0
    const updates: Partial<SceneNode> = {}
    if (grows) updates.layoutGrow = 1
    // Text, and frames holding only text, that hug their characters across the axis keep
    // hugging rather than stretch to what the text measured in Chrome, so slightly wider
    // design fonts still fit on one line.
    const children = this.graph.getChildren(node.id)
    const hugsAcross =
      cross === 'x' &&
      (node.type === 'TEXT'
        ? node.textAutoResize === 'WIDTH_AND_HEIGHT'
        : node.layoutMode === 'HORIZONTAL' &&
          node.primaryAxisSizing === 'HUG' &&
          children.length > 0 &&
          children.every(
            (child) =>
              child.type === 'TEXT' &&
              child.textAutoResize === 'WIDTH_AND_HEIGHT',
          ))
    // Text is as tall as its lines; one that filled its row's height sits centred in it.
    const effective =
      align === 'STRETCH' && hugsAcross
        ? 'MIN'
        : align === 'STRETCH' && node.type === 'TEXT' && cross === 'y'
          ? 'CENTER'
          : align
    if (effective === 'STRETCH') updates.layoutAlignSelf = 'STRETCH'
    else if (effective !== layout.counterAlign)
      updates.layoutAlignSelf = effective
    // Text that fills its line wraps inside that width instead of hugging its characters.
    if (
      node.type === 'TEXT' &&
      ((effective === 'STRETCH' && cross === 'x') || (grows && axis === 'x'))
    )
      updates.textAutoResize =
        node.textAutoResize === 'NONE' ? 'NONE' : 'HEIGHT'
    this.graph.updateNode(node.id, updates)
  }

  private sizeSelf(
    frame: SceneNode,
    element: SnapshotElement,
    layout: Plan,
    flow: SnapshotNode[],
    axis: Axis,
  ) {
    if (layout.mode === 'NONE' || layout.mode === 'GRID' || !flow.length) return
    const p = layout.padding
    // What the children span plus the padding (which holds any leading space the plan moved).
    const extent = (a: Axis) => {
      const start = Math.min(
        ...flow.map((kid) => (a === 'x' ? kid.box.x : kid.box.y)),
      )
      const stop = Math.max(...flow.map((kid) => end(kid.box, a)))
      return stop - start + (a === 'x' ? p.left + p.right : p.top + p.bottom)
    }
    const hug = (a: Axis) => near(size(element.box, a), extent(a))
    const cross: Axis = axis === 'x' ? 'y' : 'x'
    // A frame cannot hug an axis a child fills: the two sizes would depend on each other.
    const children = this.graph
      .getChildren(frame.id)
      .filter((child) => child.layoutPositioning !== 'ABSOLUTE')
    const grows = children.some((child) => child.layoutGrow > 0)
    const stretches = children.some(
      (child) => child.layoutAlignSelf === 'STRETCH',
    )
    this.graph.updateNode(frame.id, {
      primaryAxisSizing:
        !grows && layout.primaryAlign !== 'SPACE_BETWEEN' && hug(axis)
          ? 'HUG'
          : 'FIXED',
      counterAxisSizing:
        !layout.wrap && !stretches && hug(cross) ? 'HUG' : 'FIXED',
    })
  }
}
