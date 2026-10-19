// Turns repeated layers into components: every Lucide icon, and every layer a
// shared React component rendered that occurs more than once with the same
// structure. The first occurrence becomes the main component on the Components
// page, and every occurrence, that one included, becomes an instance carrying
// its own text, images, colors and sizes as overrides. shadcn's `data-variant`
// and `data-size` become the variant properties of a component set.

import {
  FigmaAPI,
  type FigmaComponentNode,
  type FigmaNodeProxy,
} from '@open-pencil/core/figma-api'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { basename } from 'node:path'
import { config } from './config'
import type { Box, SnapshotElement } from './snapshot'

/** Fields that make up a layer's identity or structure rather than how it looks. */
const STRUCTURE_FIELDS = new Set<string>([
  'id',
  'type',
  'name',
  'parentId',
  'childIds',
  'componentId',
  'instanceOverrides',
  'source',
  'derivedLayout',
  'componentPropertyDefinitions',
  'componentPropertyReferences',
  'componentPropertyAssignments',
  'componentPropertyValues',
  'variantPropSpecs',
])

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Route files hold pages, not reusable components.
const isRouteFile = (file: string) =>
  /^(index|__root|\$.*|.*-page|new|settings|stats)\.tsx$/.test(file)

function signature(graph: SceneGraph, node: SceneNode): string {
  const own =
    node.type === 'INSTANCE'
      ? `I:${node.componentId}`
      : node.type === 'RECTANGLE'
        ? `R:${node.fills[0]?.type === 'IMAGE' ? 'image' : 'shape'}`
        : `${node.type}:${node.layoutMode}`
  if (
    node.type === 'TEXT' ||
    node.type === 'INSTANCE' ||
    node.type === 'VECTOR'
  )
    return own
  return `${own}[${graph
    .getChildren(node.id)
    .map((child) => signature(graph, child))
    .join(',')}]`
}

// What a .fig instance cannot override on its layers (tested by saving and reopening):
// they always come from the component, so occurrences have to agree on them.
// Variable bindings too: a layer bound to another token than its component's reverts.
const FIXED_IN_COMPONENT = [
  'layoutMode',
  'clipsContent',
  'horizontalConstraint',
  'verticalConstraint',
  'gridPosition',
  'boundVariables',
] as const

/**
 * Whether two same-shaped layers agree on everything an instance takes from its component:
 * the fields above, and where freely placed descendants sit.
 */
function samePlacement(
  graph: SceneGraph,
  a: SceneNode,
  b: SceneNode,
  root = true,
): boolean {
  // Where the instance itself sits (its grid cell, its constraints) is its own, not the component's.
  const fields = root
    ? (['layoutMode', 'clipsContent'] as const)
    : FIXED_IN_COMPONENT
  if (fields.some((field) => !same(a[field], b[field]))) return false
  const others = graph.getChildren(b.id)
  return graph.getChildren(a.id).every((child, i) => {
    const other = others[i]
    if (!other) return false
    const free =
      a.layoutMode === 'NONE' || child.layoutPositioning === 'ABSOLUTE'
    if (
      free &&
      (['x', 'y'] as const).some(
        (axis) => !pinnedAlike(axis, a, child, b, other),
      )
    )
      return false
    return (
      child.type === 'INSTANCE' || samePlacement(graph, child, other, false)
    )
  })
}

/**
 * Whether two freely placed layers keep the same distance to the edge their constraint
 * pins them to, so the component's constraints put each where its occurrence had it.
 */
function pinnedAlike(
  axis: 'x' | 'y',
  parentA: SceneNode,
  a: SceneNode,
  parentB: SceneNode,
  b: SceneNode,
) {
  const edges = (parent: SceneNode, node: SceneNode) => {
    const start = axis === 'x' ? node.x : node.y
    const size = axis === 'x' ? node.width : node.height
    const room = axis === 'x' ? parent.width : parent.height
    return {
      start,
      end: room - start - size,
      centre: start + size / 2 - room / 2,
    }
  }
  const one = edges(parentA, a)
  const two = edges(parentB, b)
  const constraint =
    axis === 'x' ? a.horizontalConstraint : a.verticalConstraint
  const close = (key: 'start' | 'end' | 'centre') =>
    Math.abs(one[key] - two[key]) <= 1
  if (constraint === 'MAX') return close('end')
  if (constraint === 'CENTER') return close('centre')
  if (constraint === 'STRETCH') return close('start') && close('end')
  return close('start')
}

function height(graph: SceneGraph, node: SceneNode): number {
  if (node.type === 'INSTANCE') return 1
  return (
    1 +
    Math.max(
      0,
      ...graph.getChildren(node.id).map((child) => height(graph, child)),
    )
  )
}

/** The artboard (page-level frame) a layer sits in. */
function artboardOf(graph: SceneGraph, node: SceneNode) {
  let top = node
  while (top.parentId && graph.getNode(top.parentId)?.type !== 'CANVAS')
    top = graph.getNode(top.parentId) as SceneNode
  return top
}

const viewportOf = (graph: SceneGraph, node: SceneNode) =>
  artboardOf(graph, node).name.split(' — ').at(-1) ?? ''

// Where each component file lives in the app, for component descriptions.
const SOURCES = new Map(
  [
    ...new Bun.Glob('**/*.tsx').scanSync({
      cwd: config.sourceRoot,
    }),
  ].map((path) => [
    path.split('/').at(-1) as string,
    `${basename(config.sourceRoot)}/${path}`,
  ]),
)

const pascal = (file: string) =>
  file
    .replace(/\.tsx$/, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

interface Group {
  family: string
  variant: Record<string, string>
  nodes: SceneNode[]
  kind: 'icon' | 'primitive' | 'component'
  source?: string
  /** The viewports its occurrences are in, read before they are replaced. */
  viewports: Set<string>
}

const PRIMITIVES =
  /^(button|badge|card|input|select|textarea|separator|skeleton|switch|checkbox|label|tabs|tooltip|toggle|toggle-group|slider|progress|avatar)\.tsx$/

function candidates(
  graph: SceneGraph,
  pageIds: string[],
  elements: Map<string, SnapshotElement>,
) {
  const groups = new Map<
    string,
    Group & { file?: string; source?: string; part?: string }
  >()
  const visit = (node: SceneNode) => {
    for (const child of graph.getChildren(node.id)) visit(child)
    if (node.type !== 'FRAME') return
    let group: Omit<Group, 'nodes' | 'viewports'> & {
      file?: string
      part?: string
    }
    if (node.name.startsWith('icon/')) {
      group = {
        family: `Icon/${node.name.slice(5)}`,
        variant: {},
        kind: 'icon',
      }
    } else {
      const element = elements.get(node.id)
      const file = element?.source?.split(':')[0]
      if (!element || !file || !node.name.includes(' · ') || isRouteFile(file))
        return
      group = {
        family: pascal(file),
        variant: element.variant ?? {},
        kind: PRIMITIVES.test(file) ? 'primitive' : 'component',
        file,
        source: element.source,
        // The part of the file it is: its shadcn slot, else its element, never data-bearing labels.
        part: element.slot ?? element.tag,
      }
    }
    const key = `${group.source ?? group.family}|${JSON.stringify(group.variant)}|${signature(graph, node)}`
    const entry = groups.get(key) ?? {
      ...group,
      nodes: [],
      viewports: new Set<string>(),
    }
    entry.nodes.push(node)
    groups.set(key, entry)
  }
  for (const pageId of pageIds)
    for (const child of graph.getChildren(pageId)) visit(child)
  // Instances keep their layers where the component puts them (.fig, like Figma, has no
  // position overrides), so occurrences share a component only where those places agree.
  for (const [key, group] of [...groups]) {
    if (group.kind === 'icon') continue
    const clusters: SceneNode[][] = []
    for (const node of group.nodes) {
      const cluster = clusters.find((members) =>
        samePlacement(graph, members[0] as SceneNode, node),
      )
      if (cluster) cluster.push(node)
      else clusters.push([node])
    }
    groups.delete(key)
    for (const [i, nodes] of clusters.entries())
      groups.set(`${key}#${i}`, { ...group, nodes })
  }
  // Something a view shows once per viewport is a section of that view, not a component:
  // it has to recur on another page, or more than once on one artboard.
  const recurs = (group: Group) => {
    const pages = new Set(
      group.nodes.map((node) => artboardOf(graph, node).parentId),
    )
    const perArtboard = new Map<string, number>()
    for (const node of group.nodes) {
      const id = artboardOf(graph, node).id
      perArtboard.set(id, (perArtboard.get(id) ?? 0) + 1)
    }
    return pages.size > 1 || Math.max(...perArtboard.values()) > 1
  }
  const kept = [...groups.values()].filter(
    (group) => group.kind === 'icon' || recurs(group),
  )
  for (const group of kept)
    for (const node of group.nodes) group.viewports.add(viewportOf(graph, node))
  // A file that renders several roots names each by its part, then by line if parts repeat.
  const sources = new Map<string, Set<string>>()
  for (const group of kept)
    if (group.file && group.source)
      (
        sources.get(group.file) ??
        sources.set(group.file, new Set()).get(group.file)
      )?.add(group.source)
  const parts = new Map<string, Set<string>>()
  for (const group of kept) {
    if (
      !group.file ||
      !group.source ||
      (sources.get(group.file)?.size ?? 0) < 2
    )
      continue
    const key = `${group.file}|${group.part}`
    ;(parts.get(key) ?? parts.set(key, new Set()).get(key))?.add(group.source)
  }
  // Parts that only one viewport shows are told apart by it, others by their line.
  for (const group of kept) {
    if (
      !group.file ||
      !group.source ||
      (sources.get(group.file)?.size ?? 0) < 2
    )
      continue
    const shared = (parts.get(`${group.file}|${group.part}`)?.size ?? 0) > 1
    const viewports = group.viewports
    const suffix = !shared
      ? ''
      : viewports.size === 1
        ? ` · ${[...viewports][0]}`
        : ` ${group.source.split(':')[1]}`
    group.family = `${pascal(group.file)}/${group.part}${suffix}`
  }
  return kept
}

/** Where a component comes from, which Dev Mode and agents read from its description. */
function describe(group: Group) {
  if (group.kind === 'icon')
    return `Lucide icon "${group.family.slice(5)}" (lucide-react).`
  const [file = '', line] = group.source?.split(':') ?? []
  const path = SOURCES.get(file) ?? file
  return `Rendered by ${path}${line ? `:${line}` : ''}. Captured from the running app by design/capture.ts.`
}

export interface ComponentReport {
  components: number
  sets: number
  instances: number
}

/**
 * Records that a layer differs from its component in `field`, on every instance it sits in,
 * as OpenPencil does: the nearest keeps it through its own syncs, the outer ones through theirs.
 */
function markOverride(instances: SceneNode[], nodeId: string, field: string) {
  for (const instance of instances) {
    if (nodeId === instance.id) {
      instance.instanceOverrides.self.set(field, true)
      continue
    }
    const fields =
      instance.instanceOverrides.descendants.get(nodeId) ??
      new Map<string, unknown>()
    fields.set(field, true)
    instance.instanceOverrides.descendants.set(nodeId, fields)
  }
}

/** Points each cloned instance's overrides at the cloned layers instead of the originals. */
function remapClonedOverrides(
  graph: SceneGraph,
  source: SceneNode,
  clone: SceneNode,
) {
  const ids = new Map<string, string>()
  const pair = (a: SceneNode, b: SceneNode) => {
    ids.set(a.id, b.id)
    graph.getChildren(a.id).forEach((child, i) => {
      const twin = graph.getChildren(b.id)[i]
      if (twin) pair(child, twin)
    })
  }
  pair(source, clone)
  for (const [from, to] of ids) {
    const original = graph.getNode(from)
    const copy = graph.getNode(to)
    if (original?.type !== 'INSTANCE' || !copy) continue
    copy.instanceOverrides = {
      self: new Map(original.instanceOverrides.self),
      descendants: new Map(
        [...original.instanceOverrides.descendants].map(([id, fields]) => [
          ids.get(id) ?? id,
          new Map(fields),
        ]),
      ),
    }
  }
}

/** Copies what an occurrence shows onto the instance that replaces it, layer by layer. */
function applyOverrides(
  graph: SceneGraph,
  instances: SceneNode[],
  from: SceneNode,
  to: SceneNode,
  measured: Map<string, Box>,
) {
  const box = measured.get(from.id)
  if (box) measured.set(to.id, box)
  // Everything an occurrence shows differently from its component becomes an override.
  const changes: Partial<SceneNode> = {}
  for (const [field, value] of Object.entries(from))
    if (
      !STRUCTURE_FIELDS.has(field) &&
      !same(value, to[field as keyof SceneNode])
    )
      Object.assign(changes, { [field]: structuredClone(value) })
  if (Object.keys(changes).length) {
    graph.updateNode(to.id, changes)
    for (const field of Object.keys(changes))
      markOverride(instances, to.id, field)
  }
  const sources = graph.getChildren(from.id)
  const targets = graph.getChildren(to.id)
  sources.forEach((source, i) => {
    const target = targets[i]
    if (target)
      applyOverrides(
        graph,
        target.type === 'INSTANCE' ? [...instances, target] : instances,
        source,
        target,
        measured,
      )
  })
}

export function extractComponents(
  graph: SceneGraph,
  viewPageIds: string[],
  libraryPageId: string,
  elements: Map<string, SnapshotElement>,
  measured: Map<string, Box>,
): ComponentReport {
  const api = new FigmaAPI(graph)
  const report: ComponentReport = { components: 0, sets: 0, instances: 0 }
  // Icons, primitives and app components each get a page, wrapping their components.
  const shelves = new Map<Group['kind'], SceneNode>()
  const shelf = (kind: Group['kind']) => {
    let frame = shelves.get(kind)
    if (!frame) {
      const page =
        kind === 'component'
          ? libraryPageId
          : graph.addPage(kind === 'icon' ? 'Icons' : 'Primitives').id
      frame = graph.createNode('FRAME', page, {
        name: {
          icon: 'Icons',
          primitive: 'Primitives',
          component: `${config.name} components`,
        }[kind],
        layoutMode: 'HORIZONTAL',
        layoutWrap: 'WRAP',
        itemSpacing: 48,
        counterAxisSpacing: 48,
        paddingTop: 64,
        paddingRight: 64,
        paddingBottom: 64,
        paddingLeft: 64,
        width: kind === 'icon' ? 960 : 2800,
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'HUG',
        fills: [],
      })
      shelves.set(kind, frame)
    }
    return frame
  }

  // Inner components first, so outer ones are built from instances of them.
  const groups = candidates(graph, viewPageIds, elements).sort(
    (a, b) =>
      height(graph, a.nodes[0] as SceneNode) -
      height(graph, b.nodes[0] as SceneNode),
  )
  const families = new Map<string, { group: Group; main: FigmaNodeProxy }[]>()

  for (const group of groups) {
    const nodes = group.nodes.filter((node) => graph.getNode(node.id))
    const first = nodes[0]
    if (!first) continue
    const clone = graph.cloneTree(first.id, shelf(group.kind).id, {
      x: 0,
      y: 0,
      layoutGrow: 0,
      layoutAlignSelf: 'AUTO',
      layoutPositioning: 'AUTO',
      gridPosition: null,
    })
    if (!clone) continue
    remapClonedOverrides(graph, first, clone)
    const proxy = api.createComponentFromNode(
      api.getNodeById(clone.id) as FigmaNodeProxy,
    )
    const main = graph.getNode(proxy.id) as SceneNode
    graph.updateNode(main.id, {
      name: group.family,
      symbolDescription: describe(group),
    })
    if (group.kind === 'icon')
      for (const child of graph.getChildren(main.id))
        graph.updateNode(child.id, {
          horizontalConstraint: 'SCALE',
          verticalConstraint: 'SCALE',
        })
    report.components++

    for (const node of nodes) {
      const parent = node.parentId && graph.getNode(node.parentId)
      if (!parent) continue
      const index = parent.childIds.indexOf(node.id)
      const instance = graph.createInstance(main.id, parent.id)
      if (!instance) continue
      graph.reorderChild(instance.id, parent.id, index)
      // Where the occurrence sat and how it sized itself come along with what it showed.
      applyOverrides(graph, [instance], node, instance, measured)
      graph.deleteNode(node.id)
      report.instances++
    }
    const family = families.get(group.family) ?? []
    family.push({ group, main: proxy })
    families.set(group.family, family)
  }

  // Occurrences of one React component that differ by variant or structure share a set.
  for (const [name, members] of families) {
    if (members.length < 2) continue
    const keys = [
      ...new Set(
        members.flatMap((member) => Object.keys(member.group.variant)),
      ),
    ]
    const title = (key: string) => key.charAt(0).toUpperCase() + key.slice(1)
    const names = members.map((member) =>
      keys.map((key) => `${title(key)}=${member.group.variant[key] ?? 'none'}`),
    )
    // Members alike in variant get the first property that tells them apart: the breakpoint
    // each shows on, else the token its surface is filled with, else a layout number.
    const repeated = (list: string[][]) =>
      new Set(list.map((name) => name.join())).size < list.length
    const fillToken = (member: (typeof members)[number]) => {
      const main = graph.getNode(member.main.id)
      const id = main?.boundVariables['fills/0/color']
      return (id && graph.variables.get(id)?.name) || 'none'
    }
    const properties: [string, (member: (typeof members)[number]) => string][] =
      [
        [
          'Breakpoint',
          (member) =>
            (member.group.viewports.size === 1
              ? [...member.group.viewports][0]
              : 'Both') as string,
        ],
        ['Fill', fillToken],
      ]
    for (const [property, value] of properties) {
      if (!repeated(names)) break
      const tried = names.map((name, i) => [
        ...name,
        `${property}=${value(members[i] as (typeof members)[number])}`,
      ])
      if (
        new Set(tried.map((name) => name.join())).size >
        new Set(names.map((name) => name.join())).size
      )
        names.splice(0, names.length, ...tried)
    }
    if (repeated(names)) {
      const seen = new Map<string, number>()
      for (const name of names) {
        const count = (seen.get(name.join()) ?? 0) + 1
        seen.set(name.join(), count)
        name.push(`Layout=${count}`)
      }
    }
    for (const [i, member] of members.entries())
      graph.updateNode(member.main.id, { name: names[i]?.join(', ') })
    const parent = graph.getNode(members[0]?.main.id ?? '')?.parentId
    if (!parent) continue
    const set = api.combineAsVariants(
      members.map((member) => member.main as unknown as FigmaComponentNode),
      api.getNodeById(parent) as FigmaNodeProxy,
    )
    graph.updateNode(set.id, {
      name,
      symbolDescription: describe(members[0]?.group as Group),
    })
    report.sets++
  }
  return report
}
