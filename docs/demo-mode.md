# Read-only demo

Sticks & Clay has a read-only demo edition for a public showcase. The edition
is compiled in, so a standard build cannot be switched into a demo through its
environment, and the demo cannot be switched back.

## What the demo is

- `/` serves a public landing page. The workshop's project list lives at
  `/projects` in every edition; standard builds redirect `/` there.
- Every page shows a read-only banner. `src/server.ts` answers every request
  other than GET and HEAD with 403 before any API, server function, MCP or
  OAuth handler runs. That check is the security boundary: the demo's buttons
  stay visible and fail with the read-only message.
- The database is an in-memory PGlite restored from a snapshot made at build
  time. `src/db/demo.ts` replaces `src/db/client.ts` in the demo bundle, so the
  API and its queries are the same code as the PostgreSQL edition. There is no
  worker, Eve, Blender or provider credential.
- Stored files are bundled into the serverless function as its data directory.

## Fixtures

The demo shows real projects exported from a local workshop into `demo/`:
`demo/fixtures.json` holds their rows and `demo/files/` the files they
reference. To fit a serverless function, the export keeps only the WebP
previews of raster images (the demo serves the largest preview when an original
is requested), leaves out `.blend` and source-bundle downloads, and drops
images inlined in agent transcripts. Finished jobs are kept; queued or running
ones are not, because nothing would ever finish them.

```sh
bun run demo:export                     # every project that is not a draft or archived
bun run demo:export <projectId> [...]   # chosen projects
```

The export reads `DATABASE_URL` and `STUDIO_DATA_DIR` (defaults: the local
Compose database and `data/`) and replaces `demo/` entirely. Review the result
before committing it: it becomes public.

The committed snapshot keeps at most three build iterations per model, including
builds referenced by another version and the newest builds. Original build
numbers are retained, so gaps are expected. Removed iterations' runs, events,
and unreferenced files are omitted. Costs in this curated history cover only
the retained runs. Exporting again replaces this curated snapshot with the
source workshop's full history.

## Build and deploy

```sh
bun run build:demo
vercel deploy --prebuilt
```

`build:demo` migrates a PGlite database with `drizzle/`, loads the fixtures,
snapshots it, runs `vite build` with `STUDIO_EDITION=demo` (the Nitro `vercel`
preset), and copies the snapshot, the PGlite runtime and `demo/files` into
`.vercel/output`. `vercel.json` selects this build for Git-connected
deployments. Each serverless instance restores its own copy, so the first
request after a cold start is slower.
