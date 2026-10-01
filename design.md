# Sticks & Clay design guide

This is the application's UI design reference, based on the existing theme in `src/styles.css` and the running project list and project workspace inspected on 2026-09-29. Project-specific asset design references are separate, versioned documents stored in the database.

## Character

Sticks & Clay feels like a calm creative workshop: warm ivory surfaces, forest-green typography, sage accents, generous space, and restrained outlines. The assets and reference images provide the visual variety. Keep the interface quiet enough to compare 3D models or graphics and read detailed design feedback.

The home headline pairs a plain sans-serif statement (“Build a world.”) with a softer italic serif line (“Keep it consistent.”). Use that editorial contrast sparingly. The brand combines a shaded forest-green stick overlapping a softly rounded terracotta cube with a rounded, solid-green Sticks & Clay wordmark. The transparent header lockup lives at `public/brand/sticks-and-clay-lockup-v2.png`; the standalone emblem and favicon use `sticks-and-clay-mark-v2.png` and `sticks-and-clay-favicon-v2.png`. Render the lockup at 220px wide on desktop and 200px on phones, with descriptive alternative text and an accessible home link. Reserve terracotta for the brand so forest green remains the action color.

## Palette

These colors now back semantic shadcn tokens in `src/styles.css` (`--background`, `--primary`, `--card`, and related roles). Use those tokens through shadcn components and Tailwind utilities; keep this guide synchronized when changing the theme.

| Role | Color | Use |
| --- | --- | --- |
| Canvas | `#f5f5ee` | Page background |
| Main ink | `#273b33` | Body text and headings |
| Header / modal surface | `#fafbf5` | Shared chrome and dialogs |
| Card surface | `#fcfcf8` | Project and model cards |
| Panel surface | `#fbfcf6` | Workspace sections |
| Primary action | `#284e3c` | Main buttons, with `#fbffe9` text |
| Primary hover | `#39634c` | Hovered primary buttons |
| Secondary action | `#fffef7` | Default buttons; hover `#e8ecdf` |
| Supporting text | `#7a8273` | Introductory copy |
| Serif accent | `#76846a` | Emphasized home headline |
| Card border | `#dce1d5` | Fine structural outlines |
| Brand clay | `#bd795c` | Terracotta accent in the brand emblem |
| Progress fill | `#829e5e` | On a `#e4ead9` track |
| Viewer background | `#e9ede8` | Daytime React Three Fiber lightbox stage |

Status badges pair text with color:

| State | Background | Text | Border |
| --- | --- | --- | --- |
| Ready / done / approved | `#e5efcf` | `#466630` | `#d3e0bd` |
| Designing / building / judging / running | `#e8edf8` | `#5b6e98` | `#d8e0f3` |
| Failed | `#f6e5df` | `#9a5142` | `#e9d1c9` |
| Warning / review | `#f8efd6` | `#967126` | `#eadcb9` |

Agent lifecycle labels use the same badge language everywhere progress or an
individual agent run is shown: neutral sage for **Agent: queued**, blue for
**Agent: working**, and green for **Agent: completed**. Keep technical workflow
phases and failure outcomes visible separately from this three-state lifecycle.

## Typography and spacing

- The font stack starts with Inter, then system sans-serif fonts; the app does not currently load a bundled Inter font. Base text is 14px. Georgia supplies the italic headline accent; code, transcripts, and the design editor use system monospace.
- Desktop home headlines are 56px with 1.1 line height and −2.8px tracking. Project titles are 40px. Section headings are 20px; card headings are 17px. Most headings use moderate weights around 530–570.
- Eyebrows are 10px, widely tracked, and uppercase. Supporting text is generally 12–14px with relaxed line height. Small labels and metadata use 9–11px; preserve readability when introducing new information.
- Main content is centered at a maximum width of 1330px, with desktop padding of 48px 40px 65px. The header is 82px tall on desktop, with its contents aligned to the main content. Grids use 23px gaps; panels use 26px padding.
- Use 7px corners for controls, 10px for panels, 12px for cards, and 16px for dialogs. Separation comes primarily from spacing and 1px borders. Card hover shadows are subtle; dialogs use a stronger shadow.

## Components and layout

- **Project list:** preserve the full editorial introduction for an empty workspace, and use a compact introduction for returning users. Search, active/attention filters, and newest/name sorting sit above the three-column card grid. Setup offers visible 3D assets / Graphics radio choices. Cards show their collection type.
- **Project cards:** a 16:9 cover showing the newest completed project photograph (reference image fallback), with an explicit Generated collection / Reference image label. Status describes queued, active, attention or completed work, separately from design approval. Show asset/completion counts, name, two-line description, date and a rounded estimated cost. When no reference exists, use the existing soft sage gradient, thin Layers icon, and STYLE STARTS HERE caption.
- **Project workspace:** compact identity, generation action, expandable brief and four statistics, then underlined tabs for assets, Design reference, and Activity & cost. Keep the first asset visible early; references remain accessible in the design tab on phones.
- **Models:** 240px cover images with an opt-in inline 3D quick preview, readable status, asset name, brief, triangle/cost metadata, and separate GLB/source downloads. Only one card preview is active at a time; collection renders sit in a collapsed Collection studio section below model cards when available.
- **Graphics:** preserve the full square, portrait, or landscape image with contain sizing rather than cropping it into the model-card ratio. Generation asks for a canvas per batch. Cards expose the PNG download, generation status, brief, cost, and a link to activity. Do not show Blender, triangle, judge-round, 3D preview, or collection-scene controls for graphic projects.
- **Design reference:** readable Markdown, section links, revision/approval status and comparisons; a main document column with a 280px reference sidebar. The editable source is monospace. Editing/preview preserves unsaved text. Save as draft, approve, discard edits and revision restoration stay distinct, with persistent editing actions. Explain that saved drafts need approval and existing batches retain their snapshots.
- **Activity:** requests grouped by asset with asset, action and outcome filters. Expandable rows prioritize action, timestamp, outcome and estimated cost; technical model/engine details, exact cost and transcripts live inside. Mobile rows stack without hiding status. Label missing prices as not yet priced, distinct from unfinished jobs.
- **Forms:** shadcn Label, Input, Textarea, and Button with stacked labels, ivory surfaces, generous padding, and dashed upload areas. Use Alert for errors.
- **Dialogs:** shadcn Dialog with focus management and Escape behavior; centered on a translucent green overlay with blur. Standard dialogs are 570px wide, constrained by the viewport and a 92vh maximum height. Model inspection uses a dedicated page.
- **3D preview:** neutral lighting and background, orbit/zoom controls, loading/error text, and a short interaction hint. Let the asset's material colors remain the focus.
- **Icons and motion:** use `lucide-react` line icons. Existing hover transitions last 0.15–0.2s; activity spinners rotate over 1.4s. Avoid decorative motion that competes with work in progress.

## Responsive behavior

| Width | Existing behavior |
| --- | --- |
| Above 900px | Three-column cards, four statistics, document plus sidebar, 480px viewer |
| 601–900px | Two-column cards, document sidebar moves below into two columns, 380px viewer |
| 600px and below | One-column cards and collection renders; two-by-two statistics; stacked headings and actions; full-width main actions; two-row header; 19px main side padding; 42px home title and 34px project title; 320px viewer |

At phone sizes, dialogs use 12px outer padding and smaller inner padding. Render grids stack, tabs become more compact, and long text must wrap without widening the page. These breakpoint values come from CSS; model details are checked at desktop and phone widths.

## Interaction and content rules

Use concise, specific actions such as “New project,” “Generate models,” and “Save and approve.” Keep failure, review, approval, and completion with issues distinguishable. Progress describes workflow milestones, not a time estimate. Label model costs as estimates and retain access to their breakdown.

The shared model viewer is a quiet lightbox, not a separate visual language: softly lit sage daylight, a charcoal-blue night option, and an optional grid. Its floating controls use the app's existing shadcn buttons and translucent ivory surfaces. Offer bounded-zoom orbit, a four-direction split view (front/right/back/left), and a collision-free first-person fly camera. Use the compact Three.js editor-style XYZ axis helper in the top-right; its six axis endpoints snap the camera to orthographic directions. Keep reset in the main toolbar, fullscreen at the bottom-right, and make all UI optional for small previews. The shading menu offers Realistic, Solid, Normals, and Wireframe modes. The camera menu highlights its trigger while open and copies the current scene (all four panes in split mode) as a PNG or downloads it, with visible success/error feedback. Model loading uses the shared viewer skeleton. Keep controls reachable at phone width and provide accessible labels for icon-only actions.

Use semantic links for navigation and buttons for actions, associated form labels, descriptive image alternatives, visible keyboard focus, and text alongside status colors. For new or revised dialogs, verify keyboard operation, focus management, and Escape behavior. Check contrast and touch targets when adding controls; the existing small muted labels are a visual baseline, not an accessibility certification. Respect reduced-motion preferences when extending animation.

## Maintaining the theme

Start with `src/styles.css`, `src/components/ui/`, `src/routes/__root.tsx`, and the relevant route/component. Use the installed shadcn primitive for controls that have one; preserve app-specific layouts and use semantic theme tokens for new colors. Skeletons mirror project cards, workspace statistics, queue entries, agent cards, text, images, and the 3D viewer while loading. Keep loaded content visible during background polling. Validate UI changes in both the project list and a populated workspace, including phone width and loading, empty, review, error, and long-content states relevant to the change. Update this guide when intentional changes alter the shared visual language.

## Administration and texture inspection

The header groups Projects and one Admin entry as icon-and-text links, with a forest-green active section (Projects remains active inside a project). Admin pages share a bordered left sidebar for Queue, Agents, Diagnostics and Settings; below 900px it becomes a compact horizontal subnavigation so page content keeps enough width. At phone widths, the brand sits above a full-width navigation row with 44px touch targets. Admin cards use restrained shadows, clear status badges and dense but readable control groups. Agents exposes model and effort or quality overrides while keeping engines and prompt sources visibly read-only. Queue puts pause and concurrency controls above job operations. Diagnostics uses status cards and redacted operational details. Settings groups timeouts, pricing assumptions and generation defaults with a persistent save action. Model detail pages are a workbench: the heading carries the status badge, a version picker and the download actions, and below it a large 3D viewer with media tabs sits beside a tabbed inspector (Review, Analysis, Versions, Brief, Activity). The viewer stays sticky on desktop while the inspector scrolls, and a facts strip under the viewer lists triangles, dimensions, stage, version and the model cost estimate. On phones the viewer, inspector, pipeline and build story stack, and the inspector tabs wrap. Selected media, section and version persist in the URL. Texture cards open the selected version's image for inspection/download.

## Reference image intake

The project setup dialog uses Uppy’s inline Dashboard for local reference-image selection, drag-and-drop and scoped clipboard paste, with a separate **From URL** disclosure backed by the app’s import endpoint. Show the six-image count, supported formats and 8 MB limit before selection. Selected and saved images share a thumbnail grid with individually labelled remove buttons; use three columns on desktop and two on phones. Keep URL import errors inside the uploader, retain selections after errors, and disable competing intake/submission actions while importing. Do not intercept text paste in form fields. Theme Uppy with the workshop’s semantic colors and use existing shadcn Button, Input, Collapsible and Alert components around it.

## Model pipeline graph

The model page puts the viewer first. Below the workbench, a compact pipeline strip shows every recorded step as a chip (running, failed, changes requested and passed states keep their badge colors, judge chips carry the score); selecting a chip expands the recorded left-to-right pipeline graph on that step. Visual target, build, photography and judge nodes come from actual model runs; revisions extend the path, and judge nodes show their score and outcome. Do not invent photography or judge stages for older or unreviewed builds. Running, failed, interrupted, changes requested and passed states include text and icons. The model's milestone progress and final outcome remain separate from judge approval. Selecting a node expands its result and feedback, with links to the exact archived build and activity history. On phones, scroll the graph horizontally inside its panel; the page itself must not overflow.

The build story sits below the pipeline beside its continuation composer on desktop, and the two stack on phones. It presents the same recorded steps as readable messages with the step's role icon, with a collapsed original brief. The composer starts from the selected saved version: Iterate creates a linked continuation with the same name, while Fork variant asks for a new name. Both take a change prompt and a fresh review-round limit. A separate design action uses one selected saved render to draft a new project design revision and add that render to references; when all six reference slots are used, choose one to replace. The draft requires review and approval.

## Project overview

The project overview pairs its brief and primary generation action with a compact reference-image panel. A slim metrics row summarizes collection size, active work, items needing attention and estimated cost. Collection search and status filters operate on models and pending requests. Queued or planning batches occupy ordinary model cards, one per outstanding model; replace those placeholders as model rows are created. Keep failed-batch recovery available even if its model rows already exist. Placeholder cards show honest queue/planning states and must not link to nonexistent models. The collection grid, reference panel and filters adapt to phone widths.

The project setup brief is optional. Use one Draft brief with AI / Refine brief with AI action below the uploader; it needs a name and includes any references and notes. Explain which inputs it uses. The setup fields scroll within the dialog while its creation footer stays visible. Blank briefs proceed to design generation from the name and references.

## Review and recovery usability

Model reviews lead with the score, outcome, finding counts by severity (minor neutral, major amber, critical red), a short assessment and actionable findings. Each finding shows thumbnails of the archived renders it cites, linking only to the selected version’s renders, with the judge’s view note as a caption; keep the complete judge assessment in Full review. Start the GLB camera at a front three-quarter angle for the workshop’s +Y-forward Blender export convention. Phone viewers offer 44px controls, a consolidated View menu and pinch-to-zoom guidance; retain the full desktop toolbar. Dialog close buttons have 44px hit areas.

Generation uses the label Review rounds per stage, explaining early passes, geometry approval before materials, and the four-pass unjudged path at zero. Queue failures appear above active/history sections with plain-language guidance, expandable error details and links to the exact model or project recovery flow. Preserve existing resume/retry behavior.
