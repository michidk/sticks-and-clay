// The page-side half of the capture: walks the rendered DOM and records each
// element's measured box and the computed styles the scene builder needs. It is
// passed to page.evaluate, so everything it uses must be defined inside it.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface TextRun {
  text: string
  style: Record<string, string>
}

export type Background =
  | {
      type: 'linear'
      angle: number
      stops: { color: RGBA; position: number }[]
    }
  | { type: 'image'; url: string; size: string }

export interface SnapshotElement {
  kind: 'element'
  tag: string
  name: string
  /** `file.tsx:line` of the JSX that rendered it, when the dev build annotates it. */
  source?: string
  /** shadcn's `data-slot`, a stable name for the part a component renders. */
  slot?: string
  /** shadcn `data-variant` / `data-size`, which become component variants. */
  variant?: Record<string, string>
  box: Box
  style: Record<string, string>
  backgrounds: Background[]
  children: SnapshotNode[]
  /** Serialized SVG markup, with currentColor resolved. */
  svg?: string
  /** Absolute image URL or data URL. */
  image?: string
}

export interface SnapshotText {
  kind: 'text'
  box: Box
  runs: TextRun[]
  /** Number of rendered lines; one-line text keeps its natural width. */
  lines: number
}

export type SnapshotNode = SnapshotElement | SnapshotText

export const ELEMENT_PROPS = [
  'display',
  'position',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'justify-content',
  'align-items',
  'align-self',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'background-color',
  'box-shadow',
  'opacity',
  'overflow-x',
  'overflow-y',
  'object-fit',
  'backdrop-filter',
  'top',
  'right',
  'bottom',
  'left',
]

export const TEXT_PROPS = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'text-overflow',
  'white-space',
  'font-variant-numeric',
]

export async function snapshotPage(props: {
  element: string[]
  text: string[]
}): Promise<SnapshotElement> {
  const COLOR_FUNCTION =
    /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi
  const COLOR_PROPS = new Set([
    'color',
    'background-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
  ])
  const swatch = document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true })
  const colorCache = new Map<string, RGBA>()

  // Any CSS color, including oklab() from color-mix, as 8-bit sRGB.
  const rgba = (color: string): RGBA => {
    let cached = colorCache.get(color)
    if (!cached) {
      if (!swatch) throw new Error('no 2d canvas')
      swatch.clearRect(0, 0, 1, 1)
      swatch.fillStyle = '#000'
      swatch.fillStyle = color
      swatch.fillRect(0, 0, 1, 1)
      const [r = 0, g = 0, b = 0, a = 0] = swatch.getImageData(0, 0, 1, 1).data
      cached =
        a === 0
          ? { r: 0, g: 0, b: 0, a: 0 }
          : { r: r / 255, g: g / 255, b: b / 255, a: a / 255 }
      colorCache.set(color, cached)
    }
    return cached
  }
  const cssRGBA = (color: string) => {
    const { r, g, b, a } = rgba(color)
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Number(a.toFixed(3))})`
  }

  // Each color picked is read again under the dark theme, as `<property>@dark`.
  const darkReads: {
    record: Record<string, string>
    prop: string
    element: Element
    pseudo?: string
  }[] = []

  const pick = (element: Element, names: string[], pseudo?: string) => {
    const style = getComputedStyle(element, pseudo)
    const result: Record<string, string> = {}
    for (const name of names) {
      const value = style.getPropertyValue(name)
      if (COLOR_PROPS.has(name)) {
        result[name] = cssRGBA(value)
        darkReads.push({ record: result, prop: name, element, pseudo })
      } else {
        result[name] =
          name === 'box-shadow' ? value.replace(COLOR_FUNCTION, cssRGBA) : value
      }
    }
    return result
  }

  const toBox = (rect: DOMRect): Box => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  })

  // Top-level comma split, so commas inside functions stay put.
  const splitTop = (value: string) => {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < value.length; i++) {
      const char = value[i]
      if (char === '(') depth++
      else if (char === ')') depth--
      else if (char === ',' && depth === 0) {
        parts.push(value.slice(start, i).trim())
        start = i + 1
      }
    }
    parts.push(value.slice(start).trim())
    return parts
  }

  const SIDES: Record<string, number> = {
    'to top': 0,
    'to right': 90,
    'to bottom': 180,
    'to left': 270,
    'to top right': 45,
    'to right top': 45,
    'to bottom right': 135,
    'to right bottom': 135,
    'to bottom left': 225,
    'to left bottom': 225,
    'to top left': 315,
    'to left top': 315,
  }

  const rasterize = (src: string, width: number, height: number, scale = 2) =>
    new Promise<string | null>((resolve) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(width * scale)
        canvas.height = Math.ceil(height * scale)
        canvas
          .getContext('2d')
          ?.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      image.onerror = () => resolve(null)
      image.src = src
    })

  const backgroundsOf = async (
    style: CSSStyleDeclaration,
  ): Promise<Background[]> => {
    const value = style.backgroundImage
    if (!value || value === 'none') return []
    const result: Background[] = []
    const sizes = splitTop(style.backgroundSize)
    for (const [index, layer] of splitTop(value).entries()) {
      const url = layer.match(/^url\("?(.*?)"?\)$/)?.[1]
      if (url) {
        const size = sizes[index] ?? sizes[0] ?? 'auto'
        const href = new URL(url, location.href).href
        // SVG tiles become pictures at their tile size, which a tiled image fill repeats.
        const [width, height] = size.split(/\s+/).map(Number.parseFloat)
        const svg = href.endsWith('.svg') && width && height
        const image = svg ? await rasterize(href, width, height, 1) : href
        if (image) result.push({ type: 'image', url: image, size })
        continue
      }
      const linear = layer.match(/^linear-gradient\((.*)\)$/)?.[1]
      if (!linear) continue
      const args = splitTop(linear)
      let angle = 180
      const first = (args[0] ?? '').replace(/\s*in \w+(-\w+)?/, '').trim()
      if (/^-?[\d.]+deg$/.test(first)) {
        angle = Number.parseFloat(first)
        args.shift()
      } else if (first in SIDES) {
        angle = SIDES[first] as number
        args.shift()
      } else if (first === '' || /^in /.test(args[0] ?? '')) {
        args.shift()
      }
      const stops = args.map((stop, index) => {
        const position = stop.match(/\s(-?[\d.]+)%$/)
        const color = position ? stop.slice(0, position.index) : stop
        return {
          color: rgba(color),
          position: position
            ? Number(position[1]) / 100
            : index / Math.max(args.length - 1, 1),
        }
      })
      if (stops.length) result.push({ type: 'linear', angle, stops })
    }
    return result
  }

  const nameOf = (element: Element) => {
    // Lucide icons carry their name as a class: `lucide lucide-map-pin`.
    const icon = element.getAttribute('class')?.match(/\blucide-([\w-]+)/)?.[1]
    if (element.tagName.toLowerCase() === 'svg' && icon) return `icon/${icon}`
    return (
      element.getAttribute('aria-label') ??
      element.getAttribute('data-slot') ??
      (element.id || element.tagName.toLowerCase())
    )
  }

  const sourceOf = (element: Element) =>
    element
      .getAttribute('data-tsd-source')
      ?.match(/([^/]+\.tsx):(\d+)/)
      ?.slice(1)
      .join(':')

  const variantOf = (element: Element) => {
    const variant: Record<string, string> = {}
    for (const key of ['variant', 'size']) {
      const value = element.getAttribute(`data-${key}`)
      if (value) variant[key] = value
    }
    return Object.keys(variant).length ? variant : undefined
  }

  const isHidden = (element: Element) => {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return true
    if (Number(style.opacity) === 0) return true
    const rect = element.getBoundingClientRect()
    // sr-only and other visually hidden helpers
    return (
      (style.position === 'absolute' && rect.width <= 1 && rect.height <= 1) ||
      style.clipPath === 'inset(50%)'
    )
  }

  // An element draws its own box when it has a background, border, padding or shadow;
  // inline elements without one are just styled text inside a paragraph.
  const drawsBox = (style: CSSStyleDeclaration) =>
    rgba(style.backgroundColor).a > 0 ||
    style.backgroundImage !== 'none' ||
    style.boxShadow !== 'none' ||
    ['top', 'right', 'bottom', 'left'].some(
      (side) =>
        Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 ||
        Number.parseFloat(style.getPropertyValue(`padding-${side}`)) > 0,
    )

  const INLINE_TAGS = [
    'span',
    'strong',
    'em',
    'b',
    'i',
    'a',
    'small',
    'abbr',
    'time',
    'br',
    'sup',
    'sub',
    'code',
  ]

  // Text and inline, undecorated elements that hold only text: one rich text layer.
  const isTextOnly = (element: Element): boolean =>
    Array.from(element.childNodes).every((child) => {
      if (
        child.nodeType === Node.TEXT_NODE ||
        child.nodeType === Node.COMMENT_NODE
      )
        return true
      if (!(child instanceof HTMLElement)) return false
      if (isHidden(child)) return true
      const style = getComputedStyle(child)
      return (
        style.display === 'inline' &&
        !drawsBox(style) &&
        INLINE_TAGS.includes(child.tagName.toLowerCase()) &&
        isTextOnly(child)
      )
    })

  const collectRuns = (element: Element, runs: TextRun[]) => {
    const style = pick(element, props.text)
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? ''
        if (text) runs.push({ text, style })
      } else if (child instanceof HTMLElement && !isHidden(child)) {
        if (child.tagName === 'BR') runs.push({ text: '\n', style })
        else collectRuns(child, runs)
      }
    }
  }

  const textLeaf = (nodes: Node[], runs: TextRun[]): SnapshotText | null => {
    // Collapse whitespace the browser collapsed, unless the element preserves it.
    if (!runs.some((run) => run.style['white-space']?.startsWith('pre'))) {
      for (const run of runs) run.text = run.text.replace(/[ \t\n\r]+/g, ' ')
      const first = runs[0]
      if (first) first.text = first.text.trimStart()
      const last = runs.at(-1)
      if (last) last.text = last.text.trimEnd()
    }
    const kept = runs.filter((run) => run.text.length > 0)
    if (!kept.length) return null
    const range = document.createRange()
    range.setStartBefore(nodes[0] as Node)
    range.setEndAfter(nodes.at(-1) as Node)
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0,
    )
    if (!rects.length) return null
    const lines = new Set(rects.map((rect) => Math.round(rect.bottom))).size
    return {
      kind: 'text',
      box: toBox(range.getBoundingClientRect()),
      runs: kept,
      lines,
    }
  }

  async function visit(node: Element): Promise<SnapshotElement | null> {
    const tag = node.tagName.toLowerCase()
    if (
      ['script', 'style', 'link', 'meta', 'template', 'noscript'].includes(tag)
    )
      return null
    if (isHidden(node)) return null
    const computed = getComputedStyle(node)
    const element: SnapshotElement = {
      kind: 'element',
      tag,
      name: nameOf(node),
      source: sourceOf(node),
      slot: node.getAttribute('data-slot') ?? undefined,
      variant: variantOf(node),
      box: toBox(node.getBoundingClientRect()),
      style: pick(node, [...props.element, ...props.text]),
      backgrounds: await backgroundsOf(computed),
      children: [],
    }
    if (element.box.width < 0.5 && element.box.height < 0.5) return null

    if (tag === 'svg') {
      const clone = node.cloneNode(true) as SVGElement
      clone.setAttribute('width', String(element.box.width))
      clone.setAttribute('height', String(element.box.height))
      element.svg = new XMLSerializer()
        .serializeToString(clone)
        .replaceAll('currentColor', cssRGBA(computed.color))
      return element
    }
    if (tag === 'img') {
      const image = node as HTMLImageElement
      const src = image.currentSrc || image.src
      element.image =
        src.endsWith('.svg') || src.startsWith('data:image/svg')
          ? ((await rasterize(src, element.box.width, element.box.height)) ??
            src)
          : src
      return element
    }
    if (tag === 'canvas') {
      try {
        element.image = (node as HTMLCanvasElement).toDataURL()
      } catch {
        // A tainted canvas (cross-origin map tiles) stays an empty frame.
      }
      return element
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const field = node as HTMLInputElement
      if (['checkbox', 'radio', 'hidden', 'range', 'file'].includes(field.type))
        return element
      const value =
        tag === 'select'
          ? ((node as unknown as HTMLSelectElement).selectedOptions[0]?.text ??
            '')
          : field.value
      const text = value || field.placeholder
      if (!text) return element
      const style = pick(node, props.text, value ? undefined : '::placeholder')
      // A field shows one line and cuts off what does not fit.
      if (tag !== 'textarea')
        Object.assign(style, {
          'white-space': 'nowrap',
          'text-overflow': 'ellipsis',
        })
      // The control's text sits in its content box, vertically centred for one line.
      const padLeft =
        Number.parseFloat(computed.paddingLeft) +
        Number.parseFloat(computed.borderLeftWidth)
      const padRight =
        Number.parseFloat(computed.paddingRight) +
        Number.parseFloat(computed.borderRightWidth)
      const lineHeight =
        Number.parseFloat(computed.lineHeight) ||
        Number.parseFloat(computed.fontSize) * 1.25
      const multiline = tag === 'textarea'
      element.children.push({
        kind: 'text',
        runs: [{ text, style }],
        lines: multiline ? 2 : 1,
        box: {
          x: element.box.x + padLeft,
          y: multiline
            ? element.box.y +
              Number.parseFloat(computed.paddingTop) +
              Number.parseFloat(computed.borderTopWidth)
            : element.box.y + (element.box.height - lineHeight) / 2,
          width: element.box.width - padLeft - padRight,
          // Text boxes are centred on their lines, so a two-line box is two lines tall.
          height: multiline ? lineHeight * 2 : lineHeight,
        },
      })
      return element
    }

    if (node.childNodes.length && isTextOnly(node)) {
      const runs: TextRun[] = []
      collectRuns(node, runs)
      // An element as narrow as its text, which the browser fits whole, hugs it rather than
      // truncate when a slightly wider font measures it; wider elements keep their ellipsis.
      const fits = document.createRange()
      fits.selectNodeContents(node)
      if (node.scrollWidth <= node.clientWidth && node.clientWidth - fits.getBoundingClientRect().width < 2)
        for (const run of runs) run.style['text-overflow'] = 'clip'
      const leaf = textLeaf(Array.from(node.childNodes), runs)
      if (leaf) element.children.push(leaf)
      return element
    }

    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const leaf = textLeaf(
          [child],
          [{ text: child.textContent ?? '', style: pick(node, props.text) }],
        )
        if (leaf) element.children.push(leaf)
      } else if (child instanceof Element) {
        const layer = await visit(child)
        if (layer) element.children.push(layer)
      }
    }
    return element
  }

  const body = await visit(document.body)
  if (!body) throw new Error('the page rendered no body')
  const root = document.documentElement
  const wasDark = root.classList.contains('dark')
  root.classList.add('dark')
  for (const read of darkReads)
    read.record[`${read.prop}@dark`] = cssRGBA(
      getComputedStyle(read.element, read.pseudo).getPropertyValue(read.prop),
    )
  if (!wasDark) root.classList.remove('dark')
  return body
}

/**
 * Cuts lists the seed data makes long: an element's children rendered by the same JSX
 * line beyond the first `limit` are removed, and the page lays itself out again. Small
 * repeats such as chart cells and rating stars stay whole.
 */
export function trimRepeats(limit: number) {
  let removed = 0
  for (const parent of Array.from(document.querySelectorAll('body *'))) {
    const runs = new Map<string, Element[]>()
    for (const child of Array.from(parent.children)) {
      const source = child.getAttribute('data-tsd-source')
      if (!source) continue
      const run = runs.get(source) ?? []
      run.push(child)
      runs.set(source, run)
    }
    for (const items of runs.values()) {
      if (items.length <= limit) continue
      const { width, height } = (items[0] as Element).getBoundingClientRect()
      if (height < 32 || width < 64) continue
      for (const item of items.slice(limit)) item.remove()
      removed += items.length - limit
    }
  }
  return removed
}
