# Sticks & Clay designs

Open `views/sticks-and-clay.fig` in [OpenPencil](https://openpencil.dev).
The document captures the running workshop as editable layers, with one page
per view and desktop (1440 × 900) and touch-phone (390 × 844) artboards.
Long pages grow below a screen-fold guide. Dialogs keep their original viewport.

The view inventory is `capture.config.json`. It includes the public landing
page, projects, the global asset board, every admin page, project stages,
reference editing, materials, asset histories and editing, the 3D media and
inspector tabs, graphic/SVG/pixel versions, iteration and fork dialogs, model
import, sprite export, and the image lightbox.

Pages named `fixture` use browser-only API responses to show otherwise missing
states: empty/error projects, design generation/failure/approval, CAD setup,
and visual-target approval. They do not change the database. CAD has no saved
output in this workshop. Its output-layout fixture uses a labeled schematic,
example measurements, and placeholder download links rather than generated CAD files.
The remaining pages use existing workshop records. API writes are blocked
throughout capture; no approval or generation action is submitted.

`Components`, `Primitives`, and `Icons` contain reusable layers and instances.
Layers retain measured auto layout where it reproduces the browser and fall
back to fixed positioning where needed. `capture-report.json` records the view
inventory, component counts, and layout drift after writing and reopening.
`tokens/` contains the same color, spacing, radius, typography, and shadow
tokens in DTCG JSON. The app currently has one light palette; the document's
Dark mode repeats that palette rather than inventing another theme.

## Refresh the document

Start the normal `asset-studio` preview and the landing-page preview described
below, then run:

```sh
cd design
bun install --frozen-lockfile
bunx playwright-core install chromium-headless-shell
bun run typecheck
bun capture.ts
```

`APP_URL` overrides the workshop URL. The landing entry has its own URL in
`capture.config.json`. Record IDs in the inventory refer to the current local
workshop; update those paths when using a different database.

`VIEWS="Projects,Asset board"` captures a subset. It replaces the entire output,
so use `OUTPUT=/tmp/subset.fig` to keep the full document. Unknown view names
fail before writing. A capture also replaces `tokens/` and `capture-report.json`.
Copy any hand-edited design to another file before recapturing.

Untracked `screenshots/` holds browser PNGs and measured JSON for comparison.
`REUSE_SNAPSHOTS=1` explicitly reuses those measurements during a retry. Omit it
for fresh captures after an app change. The capture checks both artboards exist
and measures layout drift again after reopening the written `.fig`.

The toolkit came from the OpenPencil design skill used by Roastbook. This copy
adds dialog selectors, browser-only state fixtures, light-only token support,
background propagation from the HTML element, password masking,
WebGL buffer preservation, margin-wrapper round-trip fixes, and an isolated
browser page for each artboard so polling requests cannot cross captures.

## Landing-page preview

`vite.config.ts` enables the public, read-only demo UI while retaining the
standard local database adapter. It is only for design capture, not deployment.
It uses the normal app dependencies and local database configuration.

From the repository root, reuse `asset-studio-demo`:

```sh
vibepod-preview restart asset-studio-demo
vibepod-preview doctor asset-studio-demo
```

If it is missing, register it with the current T3 thread ID:

```sh
vibepod-preview run --owner-thread <thread-id> --port 33323 asset-studio-demo -- \
  bash -lc 'exec bun node_modules/vite/bin/vite.js --config design/vite.config.ts --host 0.0.0.0 --port "$PORT"'
```

## Editor and agent access

The existing `open-pencil` preview can serve both Roastbook and Sticks & Clay.
`open-pencil/editor.sh` pins the editor version and serves `.fig`/`.pen` files
from `OPENPENCIL_FILES_ROOT`, defaulting to this project's `design/views/`.
For a shared editor, use the workspace directory as the root and set
`OPENPENCIL_DEFAULT_FILE=sticks-and-clay/design/views/sticks-and-clay.fig`.
An explicit file URL opens Roastbook without changing the default document.
Keep the editor behind VibePod's authenticated preview gateway. The overlay
preserves gateway cookies for same-origin file links; external file links still
omit credentials.

```sh
design/open-pencil/editor.sh setup
vibepod-preview list
# Reuse open-pencil. To change its saved command, stop it before registering it.
vibepod-preview run --owner-thread <thread-id> --ready-timeout 5m --port 1420 open-pencil -- \
  env OPENPENCIL_DEV_ORIGIN="https://open-pencil.$VIBEPOD_PREVIEW_DOMAIN" \
  OPENPENCIL_FILES_ROOT="$HOME/workspaces" \
  OPENPENCIL_DEFAULT_FILE=sticks-and-clay/design/views/sticks-and-clay.fig \
  design/open-pencil/editor.sh start
vibepod-preview doctor open-pencil
```

The MCP token stays in `~/.config/vibepod/open-pencil/token`. Agent clients use
`bun ~/workspaces/open-pencil/packages/mcp/src/stdio.ts`, with
`OPENPENCIL_MCP_DISCOVERY_PATH` pointing to the running editor's discovery file
under `/tmp/open-pencil-mcp/` and `OPENPENCIL_MCP_ROOT` set to the files root.
A browser tab must have the editor open for MCP tools to work. After changing a
client's MCP configuration, restart that client to load it. Long-lived clients
may also need a reconnect after the editor restarts. A fresh CLI connection can
use the same discovery path with `bun packages/cli/src/index.ts documents list`
from the OpenPencil checkout.

Read and edit named pages through MCP, passing their `page_id` on every call.
OpenPencil loads pages lazily; reopen the document after visiting many pages
if its 10,000-loaded-node agent edit limit is reached. Save review edits to a
separate document, because refreshing the capture overwrites the source file.

## Capture limits

Text, shapes, and controls are editable. Image assets, WebGL canvases, and
some SVG artwork are rasterized. Hover/focus states, pseudo-elements, and CSS
transforms are not reproduced. System fonts may be substituted by the editor. Collapsed disclosures and scrolling panels show
the state visible in the app. This is a review document, not a working app
prototype. Browser screenshots are the reference when a capture differs.
