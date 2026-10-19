// VibePod overlay: serves the editor behind the preview gateway and reaches the
// dev MCP companion through a same-origin /__mcp proxy, so the browser never
// needs the pod's loopback port or a second authenticated hostname.
//
// The dev server sends ~2,700 unbundled modules, which stalls behind the
// gateway, so this config builds a bundle in development mode (which keeps the
// MCP bridge, gated on import.meta.env.DEV) and serves it with `vite preview`.
import { createReadStream } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import process from 'node:process'

import {
  type Connect,
  defineConfig,
  mergeConfig,
  type Plugin,
  type UserConfig,
} from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { openPencilAutomationPlugin } from './vite/automation'
import base from './vite.config'

const publicOrigin = process.env.OPENPENCIL_DEV_ORIGIN
const mcpPort = process.env.OPENPENCIL_DEV_MCP_PORT ?? '7600'
const filesRoot = process.env.OPENPENCIL_FILES_ROOT
if (!publicOrigin)
  throw new Error('OPENPENCIL_DEV_ORIGIN must be the public editor origin')

// In a browser, MCP open_file fetches the file's absolute path from this origin.
// Serve read-only design files under OPENPENCIL_FILES_ROOT at those paths, and
// at /views/<name>.fig for links; a bare / opens OPENPENCIL_DEFAULT_FILE.
function designFiles(root: string): Plugin {
  async function install(middlewares: Connect.Server) {
    const realRoot = await realpath(root)
    // Each editor load re-sends its MCP settings; an empty root means this one.
    middlewares.use(
      '/__openpencil/mcp/restart',
      async (request, _response, next) => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        let body = Buffer.concat(chunks)
        let parsed: unknown = null
        try {
          parsed = JSON.parse(body.toString('utf8'))
        } catch {
          // Malformed bodies pass through; the automation plugin rejects them.
        }
        if (
          parsed &&
          typeof parsed === 'object' &&
          Reflect.get(parsed, 'rootDirectory') === ''
        ) {
          body = Buffer.from(
            JSON.stringify({ ...parsed, rootDirectory: realRoot }),
          )
        }
        Object.assign(request, {
          [Symbol.asyncIterator]: async function* () {
            yield body
          },
        })
        next()
      },
    )
    middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://x')
      const fallback = process.env.OPENPENCIL_DEFAULT_FILE
      if (request.method === 'GET' && url.pathname === '/' && !url.search && fallback) {
        const file = `${publicOrigin}/views/${fallback}`
        response.writeHead(302, {
          location: `/?file=${encodeURIComponent(file)}`,
        })
        return response.end()
      }
      const path = decodeURIComponent(url.pathname)
      if (request.method !== 'GET' || !['.fig', '.pen'].includes(extname(path)))
        return next()
      const real = await realpath(
        path.startsWith('/views/') ? join(realRoot, path.slice(7)) : path,
      ).catch(() => null)
      if (!real?.startsWith(realRoot + sep)) return next()
      response.setHeader('content-type', 'application/octet-stream')
      createReadStream(real).pipe(response)
    })
  }
  return {
    name: 'vibepod-design-files',
    // Before the automation plugin, so its restart handler sees the patched body.
    enforce: 'pre',
    configureServer: (server) => install(server.middlewares),
    configurePreviewServer: (server) => install(server.middlewares),
  }
}

// The gateway needs its cookie when the editor opens its own design files.
function authenticatedLocalLinks(): Plugin {
  return {
    name: 'vibepod-authenticated-file-links',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/app/document/io/web-link.ts')) return
      const original = "credentials: 'omit'"
      if (code.split(original).length !== 2)
        throw new Error('OpenPencil file-link implementation changed; review the gateway cookie adapter')
      return {
        code: code.replace(original, "credentials: url.origin === location.origin ? 'same-origin' : 'omit'"),
        map: null,
      }
    },
  }
}

// The base config only starts the MCP companion for `vite` (serve); start it
// for `vite preview` too, with the dev token the bundle embeds.
function previewAutomation(): Plugin {
  const plugin = openPencilAutomationPlugin('serve', undefined)
  const configureServer = plugin.configureServer as (server: unknown) => unknown
  return {
    name: 'vibepod-preview-automation',
    configurePreviewServer: (server) => configureServer(server),
  }
}

const gateway = {
  allowedHosts: [new URL(publicOrigin).hostname],
  proxy: {
    '/__mcp': {
      target: `http://127.0.0.1:${mcpPort}`,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/__mcp/, '') || '/',
    },
  },
}

export default defineConfig(async (env) => {
  const resolved = (
    typeof base === 'function' ? await base(env) : await base
  ) as UserConfig
  // The base service worker precaches ~35 MB through the gateway after every
  // rebuild and answers navigations from that cache; replace it with one that
  // unregisters itself.
  resolved.plugins = resolved.plugins
    ?.flat()
    .filter(
      (plugin) =>
        !(
          plugin &&
          'name' in plugin &&
          plugin.name.startsWith('vite-plugin-pwa')
        ),
    )
  return mergeConfig(resolved, {
    // Relative, so it follows whichever origin served the page (WebSocket accepts
    // relative http(s) URLs since Chrome 125, Firefox 124, and Safari 17.3).
    define: {
      __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: JSON.stringify(
        process.env.OPENPENCIL_DEV_TOKEN,
      ),
      __OPENPENCIL_LOCAL_AUTOMATION_URL__: JSON.stringify('/__mcp'),
      __OPENPENCIL_LOCAL_AUTOMATION_HTTP_URL__: JSON.stringify('/__mcp'),
    },
    plugins: [
      ...(filesRoot ? [designFiles(filesRoot)] : []),
      authenticatedLocalLinks(),
      previewAutomation(),
      VitePWA({ selfDestroying: true }),
    ],
    server: gateway,
    preview: gateway,
  })
})
