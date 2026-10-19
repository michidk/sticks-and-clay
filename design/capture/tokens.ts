// The app's design tokens as W3C design token (DTCG) files, which OpenPencil
// imports into variables and styles: colors from the stylesheet in a Light
// and a Dark mode, the 4px spacing scale, the radius scale, the fonts, the
// shadows, and the type scale the config names.
import {
  defaultTokenImportOptions,
  importTokensIntoGraph,
  planTokenImport,
  readDesignTokens,
} from '@open-pencil/core/io/formats/design-tokens'
import type { Effect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { parseCSSShadows } from '@open-pencil/scene-graph/css'
import { near, px } from './build'
import { config } from './config'

export interface TokenFile {
  path: string
  content: unknown
}

interface Theme {
  light: Map<string, string>
  dark: Map<string, string>
  radius: number
}

function declarations(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`styles.css has no ${selector} block`)
  let depth = 0
  let stop = start
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) {
      stop = i
      break
    }
  }
  const block = css.slice(start, stop).replace(/\/\*[\s\S]*?\*\//g, '')
  return new Map(
    Array.from(block.matchAll(/--([\w-]+):\s*([^;]+);/g), ([, name, value]) => [
      name as string,
      (value as string).replace(/\s+/g, ' ').trim(),
    ]),
  )
}

export function parseTheme(css: string): Theme {
  return {
    light: declarations(css, ':root'),
    dark: css.includes('.dark {') ? declarations(css, '.dark') : declarations(css, ':root'),
    radius: px(declarations(css, ':root').get('radius')) * 16,
  }
}

const SPACING = [
  2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80, 96,
]
const dimension = (value: number) => ({ value, unit: 'px' })
const hex = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value)

const FONTS = config.fonts

/** OpenPencil's own token fields: the CSS a token is in code, and where pickers offer it. */
const code = (web: string, scopes: string[]) => ({
  $extensions: { 'dev.openpencil': { codeSyntax: { WEB: web }, scopes } },
})

// Text colors are for text and icons, border colors for strokes, the rest for surfaces.
function colorScopes(name: string) {
  if (/(^|-)(foreground|text)$|^link$/.test(name))
    return ['TEXT_FILL', 'SHAPE_FILL', 'STROKE']
  if (/(^|-)(border|input|ring)$/.test(name)) return ['STROKE']
  return ['FRAME_FILL', 'SHAPE_FILL', 'STROKE']
}

/** DTCG shadows from a CSS shadow list. */
function shadowToken(css: string) {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
  return parseCSSShadows(css).map((effect: Effect) => ({
    color: `#${channel(effect.color.r)}${channel(effect.color.g)}${channel(effect.color.b)}${channel(effect.color.a)}`,
    offsetX: dimension(effect.offset.x),
    offsetY: dimension(effect.offset.y),
    blur: dimension(effect.radius),
    spread: dimension(effect.spread),
    ...(effect.type === 'INNER_SHADOW' ? { inset: true } : {}),
  }))
}

/** Variable collections: Color (Light, Dark), Spacing, Radius and Font. */
export function variableTokenFiles(theme: Theme): TokenFile[] {
  const colors = (values: Map<string, string>) =>
    Object.fromEntries(
      [...values]
        .filter(([, value]) => hex(value))
        .map(([name, value]) => [
          name,
          {
            $type: 'color',
            $value: value,
            ...code(`var(--${name})`, colorScopes(name)),
          },
        ]),
    )
  const radius = theme.radius
  return [
    { path: 'Color/Light.tokens.json', content: colors(theme.light) },
    { path: 'Color/Dark.tokens.json', content: colors(theme.dark) },
    {
      path: 'Spacing/Value.tokens.json',
      content: {
        spacing: Object.fromEntries(
          SPACING.map((value) => [
            value,
            {
              $type: 'dimension',
              $value: dimension(value),
              // Tailwind derives every step from one --spacing unit of 4px.
              ...code(`calc(var(--spacing) * ${value / 4})`, ['GAP']),
            },
          ]),
        ),
      },
    },
    {
      path: 'Radius/Value.tokens.json',
      content: {
        radius: Object.fromEntries(
          Object.entries({
            sm: radius - 4,
            md: radius - 2,
            lg: radius,
            xl: radius + 4,
          }).map(([name, value]) => [
            name,
            {
              $type: 'dimension',
              $value: dimension(value),
              ...code(`var(--radius-${name})`, ['CORNER_RADIUS']),
            },
          ]),
        ),
      },
    },
    {
      path: 'Font/Value.tokens.json',
      content: {
        font: Object.fromEntries(
          Object.entries(FONTS).map(([name, value]) => [
            name,
            {
              $type: 'fontFamily',
              $value: value,
              ...code(`var(--font-${name === 'body' ? 'sans' : name})`, [
                'FONT_FAMILY',
              ]),
            },
          ]),
        ),
      },
    },
    {
      path: 'styles.tokens.json',
      content: {
        shadow: Object.fromEntries(
          [...theme.light]
            .filter(
              ([name]) => name.endsWith('shadow') || name.includes('shadow-'),
            )
            .map(([name, value]) => [
              name
                .split('-')
                .filter((part) => part !== 'shadow')
                .join('-') || 'default',
              { $type: 'shadow', $value: shadowToken(value) },
            ]),
        ),
      },
    },
  ]
}

const WEIGHTS: Record<number, string> = {
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extrabold',
}

/** The configured type scale; other sizes are named by family and size. */
function typeName(
  text: Pick<SceneNode, 'fontFamily' | 'fontSize' | 'fontWeight'>,
) {
  const weight = WEIGHTS[text.fontWeight] ?? String(text.fontWeight)
  // The project's type scale names a family and size; anything else is named by them.
  const named = config.typeNames[`${text.fontFamily}/${text.fontSize}`]
  if (named) return `${named}/${weight}`
  const role = text.fontFamily === FONTS.display ? 'Display' : 'Text'
  return `${role}/${text.fontSize}/${weight}`
}

type TypeKey = Pick<
  SceneNode,
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textCase'
  | 'italic'
>
const typeKey = (text: TypeKey) =>
  [
    text.fontFamily,
    text.fontSize,
    text.fontWeight,
    text.lineHeight,
    text.letterSpacing,
    text.textCase,
    text.italic,
  ].join('|')

/**
 * Text styles for the type the captured views use: each combination used at least
 * `minimum` times becomes a style, named by the configured scale.
 */
export function typographyTokenFile(texts: TypeKey[], minimum = 2): TokenFile {
  const counts = new Map<string, { text: TypeKey; count: number }>()
  for (const text of texts) {
    const key = typeKey(text)
    const entry = counts.get(key) ?? { text, count: 0 }
    entry.count++
    counts.set(key, entry)
  }
  const used = [...counts.values()]
    .filter((entry) => entry.count >= minimum)
    .sort((a, b) => b.count - a.count)
  const groups: Record<string, Record<string, unknown>> = {}
  const taken = new Set<string>()
  for (const { text } of used) {
    // The most used variant takes the plain name; others say what sets them apart.
    let name = typeName(text)
    if (taken.has(name))
      name += text.textCase === 'UPPER' ? ' caps' : ` ${text.lineHeight}`
    if (taken.has(name)) name += ` ${text.letterSpacing}`
    if (taken.has(name)) continue
    taken.add(name)
    const path = name.split('/')
    const leaf = path.pop() as string
    let group = groups as Record<string, unknown>
    for (const part of path) {
      group[part] ??= {}
      group = group[part] as Record<string, unknown>
    }
    group[leaf] = {
      $type: 'typography',
      $value: {
        fontFamily:
          text.fontFamily === FONTS.display
            ? '{font.display}'
            : text.fontFamily === FONTS.body
              ? '{font.body}'
              : text.fontFamily,
        fontSize: dimension(text.fontSize),
        fontWeight: text.fontWeight,
        lineHeight: text.lineHeight === null ? 1.2 : dimension(text.lineHeight),
        letterSpacing: dimension(text.letterSpacing),
      },
      // Case and italics have no place in `$value`; OpenPencil reads its own fields for them.
      $extensions: {
        'dev.openpencil': {
          text: {
            fontFamily: text.fontFamily,
            fontWeight: text.fontWeight,
            italic: text.italic,
            fontSize: text.fontSize,
            lineHeight: text.lineHeight,
            letterSpacing: text.letterSpacing,
            textDecoration: 'NONE',
            textCase: text.textCase,
          },
        },
      },
    }
  }
  return { path: 'styles.tokens.json', content: groups }
}

export function importTokens(
  graph: SceneGraph,
  pageId: string,
  files: TokenFile[],
) {
  const bundle = readDesignTokens(
    files.map((file) => ({
      path: file.path,
      text: JSON.stringify(file.content),
    })),
  )
  const plan = planTokenImport(
    graph,
    bundle,
    defaultTokenImportOptions(graph, bundle),
  )
  importTokensIntoGraph(graph, pageId, plan)
  return plan.skipped
}

const channels = (css: string) => css.match(/[\d.]+/g)?.map(Number) ?? []
const hexOf = (css: string) => {
  const [r = 0, g = 0, b = 0] = channels(css)
  return [r, g, b]
    .map((value) => Math.round(value).toString(16).padStart(2, '0'))
    .join('')
}
const alphaOf = (css: string) => channels(css)[3] ?? 1

/** A color a layer draws, as the light and dark themes computed it. */
export interface ColorUse {
  nodeId: string
  field: string
  light: string
  dark: string
}

/** Binds layers to the theme's variables wherever the captured values are the token values. */
export class ThemeBinder {
  private colors = new Map<string, string>()
  private spacing = new Map<number, string>()
  private radii = new Map<number, string>()

  constructor(private graph: SceneGraph) {
    for (const collection of graph.variableCollections.values()) {
      const variables = graph.getVariablesForCollection(collection.id)
      if (collection.name === 'Color') {
        const light = collection.modes.find(
          (mode) => mode.name === 'Light',
        )?.modeId
        const dark = collection.modes.find(
          (mode) => mode.name === 'Dark',
        )?.modeId
        // Chart and sidebar colors repeat others; plain surface tokens win a tie.
        const ordered = [...variables].sort(
          (a, b) =>
            Number(/chart|sidebar/.test(a.name)) -
            Number(/chart|sidebar/.test(b.name)),
        )
        for (const variable of ordered) {
          const pair = [light, dark].map((mode) => {
            const value = mode && variable.valuesByMode[mode]
            return value && typeof value === 'object' && 'r' in value
              ? [value.r, value.g, value.b]
                  .map((c) =>
                    Math.round(c * 255)
                      .toString(16)
                      .padStart(2, '0'),
                  )
                  .join('')
              : ''
          })
          const key = pair.join('|')
          if (!this.colors.has(key)) this.colors.set(key, variable.id)
        }
      }
      const numbers =
        collection.name === 'Spacing'
          ? this.spacing
          : collection.name === 'Radius'
            ? this.radii
            : null
      if (!numbers) continue
      for (const variable of variables) {
        const value = variable.valuesByMode[collection.defaultModeId]
        if (typeof value === 'number' && !numbers.has(value))
          numbers.set(value, variable.id)
      }
    }
  }

  /** Binds a color when both themes drew the same token, at the same alpha. */
  color(use: ColorUse) {
    if (alphaOf(use.light) !== alphaOf(use.dark) || alphaOf(use.light) === 0)
      return false
    const variable = this.colors.get(`${hexOf(use.light)}|${hexOf(use.dark)}`)
    if (!variable) return false
    this.graph.bindVariable(use.nodeId, use.field, variable)
    return true
  }

  /** Binds padding, gaps and corner radii that sit on the spacing and radius scales. */
  numbers(node: SceneNode) {
    let bound = 0
    const bind = (field: keyof SceneNode, scale: Map<number, string>) => {
      const value = node[field]
      if (typeof value !== 'number' || value === 0) return
      const variable = [...scale].find(([token]) =>
        near(token, value, 0.01),
      )?.[1]
      if (!variable) return
      this.graph.bindVariable(node.id, field, variable)
      bound++
    }
    if (node.layoutMode !== 'NONE') {
      for (const field of [
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
      ] as const)
        bind(field, this.spacing)
      if (node.layoutMode === 'GRID') {
        bind('gridColumnGap', this.spacing)
        bind('gridRowGap', this.spacing)
      } else if (node.primaryAxisAlign !== 'SPACE_BETWEEN') {
        bind('itemSpacing', this.spacing)
        if (node.layoutWrap === 'WRAP') bind('counterAxisSpacing', this.spacing)
      }
    }
    if (node.independentCorners)
      for (const field of [
        'topLeftRadius',
        'topRightRadius',
        'bottomRightRadius',
        'bottomLeftRadius',
      ] as const)
        bind(field, this.radii)
    else bind('cornerRadius', this.radii)
    return bound
  }
}

/** The effect and text styles a graph holds, to apply to the layers that match them. */
export class StyleMatcher {
  private effects: SceneNode[] = []
  private texts = new Map<string, SceneNode>()

  constructor(private graph: SceneGraph) {
    for (const node of graph.getAllNodes()) {
      if (node.sharedStyleType === 'EFFECT') this.effects.push(node)
      if (node.sharedStyleType === 'TEXT') this.texts.set(typeKey(node), node)
    }
  }

  apply(node: SceneNode) {
    if (node.type === 'TEXT') {
      const style = this.texts.get(typeKey(node))
      if (!style?.source.id) return false
      this.graph.updateNode(node.id, { textStyleId: style.source.id })
      return true
    }
    if (!node.effects.length) return false
    const style = this.effects.find((candidate) =>
      sameEffects(candidate.effects, node.effects),
    )
    if (!style?.source.id) return false
    this.graph.updateNode(node.id, {
      effects: structuredClone(style.effects),
      effectStyleId: style.source.id,
    })
    return true
  }
}

function sameEffects(a: Effect[], b: Effect[]) {
  return (
    a.length === b.length &&
    a.every((effect, i) => {
      const other = b[i] as Effect
      return (
        effect.type === other.type &&
        near(effect.offset.x, other.offset.x, 0.01) &&
        near(effect.offset.y, other.offset.y, 0.01) &&
        near(effect.radius, other.radius, 0.01) &&
        near(effect.spread, other.spread, 0.01) &&
        ['r', 'g', 'b', 'a'].every((c) =>
          near(effect.color[c as 'r'], other.color[c as 'r'], 0.01),
        )
      )
    })
  )
}
