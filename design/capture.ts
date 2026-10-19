// Captures every view of a running app into one OpenPencil document,
// views/<name>.fig: a page per view with its desktop and mobile artboards, the
// app's tokens as variables and styles, and repeated layers as components.
// capture.config.json names the app, its stylesheet and its views; see the
// open-pencil-design skill for the whole workflow.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { populateFigPage } from '@open-pencil/core/io/formats/fig'
import { prepareGraphFonts } from '@open-pencil/core/text'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { chromium, type Page } from 'playwright-core'
import { z } from 'zod'
import { SceneBuilder } from './capture/build'
import { extractComponents } from './capture/components'
import {
  type Box,
  ELEMENT_PROPS,
  type SnapshotElement,
  snapshotPage,
  TEXT_PROPS,
  trimRepeats,
} from './capture/snapshot'
import {
  importTokens,
  parseTheme,
  StyleMatcher,
  ThemeBinder,
  type TokenFile,
  typographyTokenFile,
  variableTokenFiles,
} from './capture/tokens'
import { config } from './capture/config'
import { checkLayout } from './capture/verify'

const APP_URL = process.env.APP_URL ?? config.appUrl
// Optional remote Chrome (for example a chromedp/headless-shell container).
const CDP_URL = process.env.CDP_URL
const OUTPUT =
  process.env.OUTPUT ?? `views/${config.name.toLowerCase().replace(/\W+/g, '-')}.fig`
const TOKENS_DIR = 'tokens'
const ONLY = process.env.VIEWS?.split(',')
for (const name of ONLY ?? [])
  if (!config.views.some((view) => view.name === name)) throw new Error(`Unknown view: ${name}`)
const fixtureResponse = z.object({
  project: z.object({
    name: z.string(), assetType: z.string(), status: z.string(),
    error: z.string().nullable(), progress: z.number(), phase: z.string(),
  }).passthrough().optional(),
  projects: z.array(z.unknown()).optional(),
  assetVersions: z.array(z.object({ id: z.string(), status: z.string() }).passthrough()).optional(),
}).catchall(z.unknown())

// Common device sizes; a page taller than the screen grows its artboard to fit.
const VIEWPORTS = [
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Mobile', width: 390, height: 844 },
]
// Seed data lists dozens of records; a design shows the pattern with a few.
const LIST_LIMIT = config.listLimit
const ARTBOARD_GAP = 160

// `detail` opens the first entry linked from `path` instead of `path` itself.
const VIEWS = config.views.map((view) => ({
  ...view,
  detail: view.detail ? new RegExp(view.detail) : undefined,
}))

// Measuring has to see the page at rest, in the font instances OpenPencil renders.
const CAPTURE_CSS =
  '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important }'

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
}

// Grow the viewport to the content height to capture the whole view: the
// configured scroll container's overflow, or the document's.
async function fitToContent(page: Page, width: number) {
  for (let i = 0; i < 4; i++) {
    const overflow = await page.evaluate((selector) => {
      const area = (selector && document.querySelector(selector)) || document.documentElement
      return area.scrollHeight - area.clientHeight
    }, config.scrollContainer)
    if (overflow <= 1) return
    const { height } = page.viewportSize() ?? { height: 800 }
    await page.setViewportSize({
      width,
      height: Math.min(height + overflow, 12000),
    })
    await settle(page)
  }
}

async function snapshotView(
  page: Page,
  view: (typeof VIEWS)[number],
  viewport: (typeof VIEWPORTS)[number],
) {
  const snapshotPath = `screenshots/${view.name}-${viewport.name}.json`
  if (process.env.REUSE_SNAPSHOTS) {
    const cached = Bun.file(snapshotPath)
    if (await cached.exists()) return cached.json()
  }
  // Each artboard owns a page, so polling and fixture routes cannot cross views.
  page = await page.context().newPage()
  await page.addInitScript(() => {
    // The viewer normally discards WebGL buffers after drawing. Keep them for editable canvas image fills.
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(getContext, canvas, args) {
        if (args[0] === 'webgl' || args[0] === 'webgl2')
          args[1] = { ...args[1], preserveDrawingBuffer: true }
        return Reflect.apply(getContext, canvas, args)
      },
    })
  })
  try {
  await page.setViewportSize(viewport)
  {
    await page.route('**/api/**', async (route) => {
      if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
      if (route.request().url().includes('/api/files/design-fixtures/cad-preview.svg'))
        return route.fulfill({ contentType: 'image/svg+xml', body: await readFile('fixtures/cad-preview.svg', 'utf8') })
      if (!view.fixture || !/\/api\/projects(?:\/|\?|$)/.test(route.request().url())) return route.continue()
      if (view.fixture === 'error') return route.fulfill({ status: 503, json: { error: 'The workshop is temporarily unavailable. Try again.' } })
      const response = await route.fetch()
      const data = fixtureResponse.parse(await response.json())
      if (view.fixture === 'empty') data.projects = []
      else if (view.fixture === 'cad-output') {
        if (!data.project) throw new Error('CAD output fixture needs a project')
        const modelId = view.path.match(/models\/([^/?]+)/)?.[1]
        const model = data.assetVersions?.find((model) => model.id === modelId)
        if (!model) throw new Error('CAD output fixture needs a version')
        data.project.assetType = 'cad'
        data.project.name = 'CAD workshop · capture fixture'
        model.name = 'Bored bracket · layout fixture'
        model.prompt = 'Example CAD bracket, 40 × 30 × 10 mm, with a 6 mm bore. This is a browser-only layout fixture with schematic media and placeholder export links. No CAD files were generated.'
        model.feedback = null
        const runs = z.array(z.object({ modelId: z.string().nullable(), role: z.string(), status: z.string(), result: z.unknown() }).passthrough()).parse(data.runs)
        const template = runs.find((run) => run.modelId === modelId && run.role === 'graphic' && run.status === 'done')
        if (!template) throw new Error('CAD output fixture needs a saved graphic build template')
        const key = 'design-fixtures/cad-preview.svg'
        data.runs = [{ ...template, estimatedCost: 0, role: 'cad', result: {
          key,
          exports: { step: 'design-fixtures/example.step', stl: 'design-fixtures/example.stl', script: 'design-fixtures/example.py' },
          previews: [{ key, label: 'Schematic preview · layout fixture' }],
          analysis: { dimensionsMm: { x: 40, y: 30, z: 10 }, solidCount: 1,
            checks: [{ name: 'Example width', state: 'passed', actual: 40 }] },
        } }]
      } else if (view.fixture === 'visual-target') {
        const modelId = view.path.match(/models\/([^/?]+)/)?.[1]
        const model = data.assetVersions?.find((model) => model.id === modelId)
        if (!model) throw new Error('Visual-target fixture needs a saved model')
        model.status = 'awaiting_approval'
      } else if (data.project) {
        if (view.fixture === 'cad') {
          data.project.assetType = 'cad'
          data.project.name = 'CAD workshop · capture fixture'
          for (const key of ['assets', 'assetVersions', 'versions', 'runs', 'batches', 'photographs', 'activeJobs']) data[key] = []
        } else {
          data.project.status = view.fixture
          data.project.error = view.fixture === 'failed' ? 'Design generation stopped. The brief is saved and can be retried.' : null
          data.project.progress = view.fixture === 'designing' ? 42 : 100
          data.project.phase = view.fixture === 'designing' ? 'Developing the visual direction' : 'Ready for review'
        }
      }
      return route.fulfill({ response, json: data })
    })
  }
  await page.goto(new URL(view.path, APP_URL).href)
  await settle(page)
  if (view.detail) {
    const pattern = view.detail
    const hrefs = await page.$$eval('a[href]', (links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    )
    const href = hrefs.find((candidate) => pattern.test(candidate))
    if (!href) return null
    await page.goto(new URL(href, APP_URL).href)
    await settle(page)
  }
  if (view.fixture === 'cad-output') {
    const source = 'data:image/svg+xml;base64,' + Buffer.from(await readFile('fixtures/cad-preview.svg')).toString('base64')
    await page.locator('img[src*="design-fixtures"]').evaluateAll((images, source) => {
      for (const image of images) if (image instanceof HTMLImageElement) { image.removeAttribute('srcset'); image.src = source }
    }, source)
    await settle(page)
  }
  for (const selector of view.clicks ?? []) {
    await page.locator(selector).click()
    await settle(page)
  }
  await page.addStyleTag({ content: CAPTURE_CSS + ' body { background: var(--background) !important; min-height: 100vh }' })
  await page.evaluate(trimRepeats, LIST_LIMIT)
  if (!view.clicks?.length) await fitToContent(page, viewport.width)
  await page.evaluate(() => {
    for (const field of document.querySelectorAll('input[type=password]')) {
      if (field instanceof HTMLInputElement && field.value) field.value = '••••••••'
    }
  })
  await mkdir('screenshots', { recursive: true })
  await page.screenshot({ path: `screenshots/${view.name}-${viewport.name}.png`, fullPage: true })
  const snapshot = await page.evaluate(snapshotPage, {
    element: ELEMENT_PROPS,
    text: TEXT_PROPS,
  })
  await writeFile(snapshotPath, JSON.stringify(snapshot))
  return snapshot
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.close()
  }
}

const imageCache = new Map<string, Promise<Uint8Array | null>>()
function loadImage(url: string) {
  let cached = imageCache.get(url)
  if (!cached) {
    cached = url.startsWith('data:')
      ? Promise.resolve(
          new Uint8Array(
            Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
          ),
        )
      : fetch(url)
          .then(async (response) =>
            response.ok ? new Uint8Array(await response.arrayBuffer()) : null,
          )
          .catch(() => null)
    imageCache.set(url, cached)
  }
  return cached
}

/** The first page: what the document is, where it comes from, and how it is laid out. */
function cover(
  graph: SceneGraph,
  pageId: string,
  views: number,
  components: { components: number },
) {
  graph.updateNode(pageId, { name: 'Cover' })
  const frame = graph.createNode('FRAME', pageId, {
    name: 'Cover',
    width: 1440,
    height: 900,
    layoutMode: 'VERTICAL',
    itemSpacing: 24,
    paddingTop: 120,
    paddingLeft: 120,
    paddingRight: 120,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    fills: [
      {
        type: 'SOLID',
        color: { r: 0.961, g: 0.961, b: 0.933, a: 1 },
        opacity: 1,
        visible: true,
      },
    ],
  })
  const ink = [
    {
      type: 'SOLID' as const,
      color: { r: 0.227, g: 0.165, b: 0.118, a: 1 },
      opacity: 1,
      visible: true,
    },
  ]
  const line = (
    text: string,
    fontSize: number,
    fontWeight: number,
    fontFamily = config.fonts.body,
  ) =>
    graph.createNode('TEXT', frame.id, {
      name: text.slice(0, 40),
      text,
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight: Math.round(fontSize * 1.3),
      fills: ink,
      textAutoResize: 'HEIGHT',
      layoutAlignSelf: 'STRETCH',
      width: 1200,
      height: fontSize,
    })
  line(config.name, 96, 800, config.fonts.display)
  line(
    'Every view of the app, desktop (1440×900) and mobile (390×844), with its tokens and components.',
    28,
    500,
  )
  line(
    `${views} views · ${components.components} components · variables for color (Light and Dark), spacing, radius and fonts.`,
    20,
    400,
  )
  line(
    `Generated ${new Date().toISOString().slice(0, 10)} by design/capture.ts from the running app (src/). ` +
      'Re-running the capture replaces this file: change the app, or copy what you design into a new file.',
    20,
    400,
  )
}

const graph = new SceneGraph()
const [firstPage] = graph.getPages()
if (!firstPage) throw new Error('a new document has no page')
const library = graph.addPage('Components')

const css = await readFile(config.stylesheet, 'utf8')
const tokenFiles: TokenFile[] = variableTokenFiles(parseTheme(css))
const skipped = importTokens(graph, library.id, tokenFiles)
if (skipped.length) console.warn('tokens skipped:', skipped)
const binder = new ThemeBinder(graph)

const browser = CDP_URL
  ? await chromium.connectOverCDP(CDP_URL)
  : await chromium.launch()
// The mobile capture is a touch phone, so `pointer: coarse` styles (44px targets) apply.
const pages = new Map<string, Page>()
for (const viewport of VIEWPORTS) {
  const touch = viewport.name === 'Mobile'
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    isMobile: touch,
    hasTouch: touch,
  })
  pages.set(viewport.name, await context.newPage())
}

const elements = new Map<string, SnapshotElement>()
const measured = new Map<string, Box>()
const artboards: { id: string; name: string }[] = []
const viewPages: string[] = []
let colorsBound = 0
let numbersBound = 0

for (const view of VIEWS) {
  if (ONLY && !ONLY.includes(view.name)) continue
  const viewPage = graph.addPage(view.name)
  let x = 0
  for (const viewport of VIEWPORTS) {
    let snapshot: SnapshotElement | null = null
    // A dev server can reload the page mid-capture (dependency re-optimization), so retry.
    for (let attempt = 1; ; attempt++) {
      try {
        snapshot = await snapshotView(
          pages.get(viewport.name) as Page,
          view,
          viewport,
        )
        break
      } catch (error) {
        if (attempt === 3) throw error
        console.warn(
          `retry ${view.name} (${viewport.name}): ${error instanceof Error ? error.message.split('\n')[0] : error}`,
        )
      }
    }
    if (!snapshot) {
      console.warn(`skip ${view.name}: no entry linked from ${view.path}`)
      break
    }
    const builder = new SceneBuilder(graph, loadImage)
    const name = `${view.name} — ${viewport.name}`
    const root = await builder.view(snapshot, viewPage.id, name)
    graph.updateNode(root.id, { x })
    // A page longer than the screen marks where the screen ends.
    if (snapshot.box.height > viewport.height)
      graph.updateNode(root.id, {
        guides: [
          { id: `${root.id}:fold`, axis: 'y', position: viewport.height },
        ],
      })
    x += snapshot.box.width + ARTBOARD_GAP
    await prepareGraphFonts(graph, [root.id])
    const report = await checkLayout(graph, root.id, builder.measured)
    for (const use of builder.colors)
      if (graph.getNode(use.nodeId) && binder.color(use)) colorsBound++
    for (const id of builder.measured.keys()) {
      const node = graph.getNode(id)
      if (node) numbersBound += binder.numbers(node)
    }
    for (const [id, element] of builder.elements) elements.set(id, element)
    for (const [id, box] of builder.measured) measured.set(id, box)
    artboards.push({ id: root.id, name })
    console.log(
      `${name}: ${report.layers} layers, ${report.autoLayout} auto layout, ${report.fallbacks.length} fixed`,
    )
  }
  if (x > 0) viewPages.push(viewPage.id)
  else graph.deleteNode(viewPage.id)
}
for (const page of pages.values()) await page.unrouteAll({ behavior: 'wait' })
await browser.close()

// Text styles for the type the views use, then every matching layer takes its style.
const texts = [...graph.getAllNodes()].filter(
  (node): node is SceneNode => node.type === 'TEXT' && !node.internalOnly,
)
const typography = typographyTokenFile(texts)
importTokens(graph, library.id, [typography])
const styles = new StyleMatcher(graph)
let styled = 0
for (const node of graph.getAllNodes())
  if (!node.internalOnly && styles.apply(node)) styled++

const components = extractComponents(
  graph,
  viewPages,
  library.id,
  elements,
  measured,
)
// The cover leads; the library pages follow the views.
cover(graph, firstPage.id, viewPages.length, components)
for (const name of ['Components', 'Primitives', 'Icons']) {
  const libraryPage = graph
    .getPages()
    .find((candidate) => candidate.name === name)
  if (libraryPage)
    graph.reorderChild(libraryPage.id, graph.rootId, graph.getPages().length)
}
// .fig keeps pages in order-key order; without keys it writes them in the order above.
for (const page of graph.getPages())
  page.source = { ...page.source, orderKey: null }

// Instances must still lay out as the page did.
let drift = 0
for (const artboard of artboards) {
  const report = await checkLayout(graph, artboard.id, measured, {
    fallBack: false,
  })
  drift += report.fallbacks.length
  if (report.fallbacks.length)
    console.warn(
      `${artboard.name}: ${report.fallbacks.length} frames off after componentizing`,
    )
}

if (process.env.DEBUG_TEXT)
  for (const node of graph.getAllNodes()) {
    const box = measured.get(node.id)
    if (node.type !== 'TEXT' || !box || Math.abs(box.height - node.height) < 3)
      continue
    let owner = graph.getNode(node.parentId ?? '')
    while (owner && owner.type !== 'INSTANCE')
      owner = graph.getNode(owner.parentId ?? '')
    const main = owner?.componentId ? graph.getNode(owner.componentId) : null
    console.log(
      'TEXT',
      JSON.stringify({
        text: node.text,
        box,
        w: node.width,
        h: node.height,
        ar: node.textAutoResize,
        lh: node.lineHeight,
        fs: node.fontSize,
        ff: node.fontFamily,
        fw: node.fontWeight,
        style: node.textStyleId,
        bv: node.boundVariables,
        self: node.layoutAlignSelf,
        grow: node.layoutGrow,
        owner: owner?.name,
        main: main?.name,
      }),
    )
  }
// The token files the document was built from, for code to read and other tools to import.
await rm(TOKENS_DIR, { recursive: true, force: true })
const merged: TokenFile[] = tokenFiles.map((file) =>
  file.path === typography.path
    ? {
        ...file,
        content: {
          ...(file.content as object),
          ...(typography.content as object),
        },
      }
    : file,
)
for (const file of merged) {
  const path = join(TOKENS_DIR, file.path)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(file.content, null, 2)}\n`)
}

await mkdir(dirname(OUTPUT), { recursive: true })
const { data } = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument(
  'fig',
  graph,
)
await writeFile(OUTPUT, data as Uint8Array)
console.log(
  `wrote ${OUTPUT}: ${viewPages.length} views, ${graph.nodes.size} nodes, ${colorsBound} colors and ${numbersBound} sizes bound, ` +
    `${styled} styled layers, ${components.components} components (${components.sets} sets, ${components.instances} instances), ` +
    `${drift} frames off after componentizing`,
)

// The saved document must still look like the pages: reopen it, give its layers the
// boxes their originals were measured at, and lay every artboard out again.
const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph: saved } = await io.readDocument({
  name: OUTPUT,
  data: data as Uint8Array,
})
for (const savedPage of saved.getPages())
  await populateFigPage(saved, savedPage.id)
const savedMeasured = new Map<string, Box>()
const pair = (from: SceneNode, to: SceneNode) => {
  const box = measured.get(from.id)
  if (box) savedMeasured.set(to.id, box)
  const targets = saved.getChildren(to.id)
  graph.getChildren(from.id).forEach((child, i) => {
    const target = targets[i]
    if (target) pair(child, target)
  })
}
let reopened = 0
for (const artboard of artboards) {
  const original = graph.getNode(artboard.id)
  const copy = [...saved.getAllNodes()].find(
    (node) =>
      node.name === artboard.name &&
      node.parentId &&
      saved.getNode(node.parentId)?.type === 'CANVAS',
  )
  if (!original || !copy) continue
  pair(original, copy)
  const report = await checkLayout(saved, copy.id, savedMeasured, {
    fallBack: false,
  })
  reopened += report.fallbacks.length
  if (report.fallbacks.length)
    console.warn(
      `${artboard.name}: ${report.fallbacks.length} frames off after reopening`,
    )
}
console.log(`reopened ${OUTPUT}: ${reopened} frames off`)
await writeFile('capture-report.json', JSON.stringify({
  views: VIEWS.filter((view) => !ONLY || ONLY.includes(view.name)),
  artboards, nodes: graph.nodes.size, components,
  framesOffAfterComponentizing: drift, framesOffAfterReopening: reopened,
}, null, 2) + '\n')
if (artboards.length !== viewPages.length * VIEWPORTS.length) throw new Error('Missing desktop or mobile artboard')
