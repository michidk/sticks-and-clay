import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

const viewSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  detail: z.string().optional(),
  clicks: z.array(z.string()).optional(),
  fixture: z.enum(['designing', 'failed', 'review', 'cad', 'empty', 'error', 'visual-target', 'cad-output']).optional(),
})
const configSchema = z.object({
  name: z.string().min(1),
  appUrl: z.url().default('http://localhost:3000'),
  stylesheet: z.string().default('../src/styles.css'),
  sourceRoot: z.string().default('../src'),
  scrollContainer: z.string().default(''),
  fonts: z.object({ display: z.string(), body: z.string() }).default({ display: 'Inter', body: 'Inter' }),
  typeNames: z.record(z.string(), z.string()).default({}),
  listLimit: z.number().int().positive().default(6),
  views: z.array(viewSchema).min(1),
})
export type CaptureConfig = z.infer<typeof configSchema>
const path = resolve(process.env.CAPTURE_CONFIG ?? 'capture.config.json')
const raw = configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
if (new Set(raw.views.map((view) => view.name)).size !== raw.views.length)
  throw new Error('Capture view names must be unique')
export const config: CaptureConfig = {
  ...raw,
  stylesheet: resolve(dirname(path), raw.stylesheet),
  sourceRoot: resolve(dirname(path), raw.sourceRoot),
}
