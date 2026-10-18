// Copies projects from a local studio into the demo fixtures: `bun scripts/export-demo.ts [projectId...]`.
// Without ids it exports every project that is neither a draft nor archived. Replaces demo/ entirely.
// To fit a serverless function, raster images keep only their previews, source downloads (.zip, .blend) are
// left out, and images inlined in agent transcripts are dropped.
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const source = resolve(process.env.STUDIO_DATA_DIR || "data");
const sql = postgres(process.env.DATABASE_URL || "postgres://studio:studio_local@127.0.0.1:55439/studio", { max: 1 });
const rows = (query: Promise<{ row: Record<string, unknown> }[]>) => query.then((result) => result.map(({ row }) => row));

const ids: string[] = process.argv.length > 2
  ? process.argv.slice(2)
  : (await sql`select id from projects where status <> 'draft' and archived_at is null`).map((p) => p.id);
if (!ids.length) throw new Error("No projects to export");

const tables: Record<string, Record<string, unknown>[]> = {
  projects: await rows(sql`select to_jsonb(t) as row from projects t where id in ${sql(ids)}`),
};
for (const table of ["design_revisions", "mockups", "batches", "assets", "asset_versions", "material_versions", "agent_runs"])
  tables[table] = await rows(sql`select to_jsonb(t) as row from ${sql(table)} t where "projectId" in ${sql(ids)}`);
const runIds = tables.agent_runs.map((run) => run.id as string);
tables.agent_events = runIds.length
  ? await rows(sql`select to_jsonb(t) as row from agent_events t where "runId" in ${sql(runIds)}`) : [];
// Only finished jobs: the demo has no worker, so anything queued or running would look stuck forever.
const targets = Object.values(tables).flat().map((row) => row.id as string);
tables.jobs = await rows(sql`select to_jsonb(t) as row from jobs t where "targetId" in ${sql(targets)} and status in ('done', 'failed', 'cancelled')`);
await sql.end();

const output = resolve("demo");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "files"), { recursive: true });
await writeFile(
  resolve(output, "fixtures.json"),
  JSON.stringify(tables)
    .replace(/"data:[\w/+.-]+;base64,[\w+/=]+"/g, '"data:,"')
    .replaceAll(dirname(source) + "/", ""), // server paths in transcripts become relative
);

// Every stored file is referenced by its storage key somewhere in these rows.
const keys = new Set(JSON.stringify(tables).match(/(?<=")(?:[\w.-]+\/)+[\w.-]+\.\w{2,5}(?=")/g));
let copied = 0;
for (const key of keys) {
  const file = resolve(source, key);
  if (/\.(zip|blend)$/.test(key) || !file.startsWith(source + "/") || !(await stat(file).catch(() => null))?.isFile()) continue;
  await mkdir(dirname(resolve(output, "files", key)), { recursive: true });
  await cp(file, resolve(output, "files", key));
  copied++;
}

// The demo's filesystem is read-only, so make every preview size now; the demo serves originals as previews.
process.env.STUDIO_DATA_DIR = resolve(output, "files");
const { thumbnail, THUMBNAIL_WIDTHS } = await import("../src/lib/thumbnail.server");
for (const key of keys)
  if (await thumbnail(key, THUMBNAIL_WIDTHS[0]).catch(() => null)) await rm(resolve(output, "files", key));

console.log(`Exported ${ids.length} projects, ${Object.values(tables).flat().length} rows and ${copied} files to demo/`);
