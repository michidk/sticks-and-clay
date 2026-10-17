# Sticks & Clay design guide

This is the application's UI design reference, based on the existing theme in `src/styles.css` and the running project list and project workspace inspected on 2026-09-29. Project-specific asset design references are separate, versioned documents stored in the database.

## Character

Sticks & Clay feels like a calm creative workshop: warm ivory surfaces, forest-green typography, sage accents, generous space, and restrained outlines. The assets and reference images provide the visual variety. Keep the interface quiet enough to compare 3D models or graphics and read detailed design feedback.

Page copy is plain and task-oriented: headings name the thing on the page (“Projects”, the project name, “Design reference · v3”), and there are no eyebrows, taglines, slogans or arrow glyphs. The brand combines a shaded forest-green stick overlapping a softly rounded terracotta cube with a rounded, solid-green Sticks & Clay wordmark. The transparent header lockup lives at `public/brand/sticks-and-clay-lockup-v2.png`; the standalone emblem and favicon use `sticks-and-clay-mark-v2.png` and `sticks-and-clay-favicon-v2.png`. Render the lockup at 220px wide on desktop and 200px on phones, with descriptive alternative text and an accessible home link. Reserve terracotta for the brand so forest green remains the action color.

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

One shared `StatusBadge` (`src/components/status.tsx`) maps every workflow status and verdict to a tone and label: neutral for queued or cancelled, blue with a spinner for anything in progress, green for complete or approved, amber for review or completed with issues, red for failed. The shared `Progress` shows the phase label, a percentage and the bar. There is no separate agent-lifecycle badge.

## Typography and spacing

- The font stack starts with Inter, then system sans-serif fonts; the app does not currently load a bundled Inter font. Base text is 14px. Georgia supplies the italic headline accent; code, transcripts, and the design editor use system monospace.
- Page titles use the shared `.page-header` (clamp 26–38px) with a breadcrumb trail above them. Admin pages keep the larger `.page-heading`. Section headings are 20px; card headings are 17px. Most headings use moderate weights around 530–570.
- Supporting text is generally 12–14px with relaxed line height. Small labels and metadata use 9–11px; preserve readability when introducing new information.
- Main content is centered at a maximum width of 1330px, with desktop padding of 48px 40px 65px. The header is 82px tall on desktop, with its contents aligned to the main content. Grids use 23px gaps; panels use 26px padding.
- Use 7px corners for controls, 10px for panels, 12px for cards, and 16px for dialogs. Separation comes primarily from spacing and 1px borders. Card hover shadows are subtle; dialogs use a stronger shadow.

## Components and layout

Place alert text in the shadcn AlertDescription component so it uses the content column and wraps within the panel on phones. Project-list polling errors clear after a successful refresh; creation-dialog errors remain visible until the next form action.

- **Project list:** “Projects” with a count and a New project button; an empty workspace gets one sentence explaining the flow. Search, active/attention filters, and newest/name sorting sit above the three-column card grid. Setup offers visible 3D assets / Graphics / SVG files radio choices. Cards show their collection type.
- **Project cards:** a 16:9 cover showing the newest completed project photograph (reference image fallback; graphics and references keep their full image with contain sizing and padding). Status sits top-left, the asset type bottom-left and the actions menu top-right, outside the link. The card meta line carries the date and the Generated collection / Reference image label. Status describes queued, active, attention or completed work, separately from design approval; unsent drafts say Draft. Show asset/completion counts, name, two-line description (an italic placeholder when there is no brief), and a rounded estimated cost. The Show filter adds Archived; archived projects are hidden from All and from the count. When no reference exists, use the existing soft sage gradient and thin Layers icon.
- **Project workspace:** breadcrumb, project name, a meta row (status badge, asset type, design version and approval, estimated cost; the last two jump to their tabs), a collapsed brief, an actions menu (Archive or Unarchive, and Delete while nothing has been generated) and one primary action (Add ideas, or Review design before approval). Underlined tabs in the order Design, Mockups, Ideas, Models (Graphics for 2D projects), Materials, Collection and Activity carry counts and live in the URL as `?tab=`; Collection and Activity are right-aligned. Collection appears once a batch has collection renders (3D lineup and demo scene, or the 2D sheet). Ideas holds the saved-ideas table; Models holds the generated and in-progress collection and is the default tab once anything exists. Old `?tab=style` links open Design. An unapproved project opens on Design; Mockups and Materials appear once the design is approved. There is no Style tab: accepted mockups are the visual direction. An archived project stays readable behind a notice, with generation, mockups and design updates blocked.
- **Models:** 240px cover images with an opt-in inline 3D quick preview, readable status, asset name, brief, triangle/cost metadata, and separate GLB/source downloads. Only one card preview is active at a time; collection renders sit in a collapsed Collection studio section below model cards when available.
- **Graphics:** preserve the full square, portrait, or landscape image with contain sizing rather than cropping it into the model-card ratio. Generation asks for a canvas per batch. Cards expose the PNG or SVG download, generation status, brief, cost, and a link to activity. Do not show Blender, triangle, judge-round, 3D preview, or collection-scene controls for graphic projects.
- **Design reference:** a studio split like the model page: the Design chat on the left (sticky; stacked below the document on phones) and the document with its reference sidebar on the right. The new project's brief is design v1 verbatim, with no AI processing, so a blank brief starts from the project name. The chat lists every revision as a message with its author, approval state and a Revert to this button (reverting writes a new revision) and a collapsed comparison with the current version. An AI draft waits as the current revision with Accept (approve) and Discard (revert to the previous approved version). The composer offers Change (apply a request), Improve (AI tightens the whole design) and Mockups (jump to the Mockups tab). Provider failures show plain-language text with Try again, Edit prompt and, for usage limits, a link to Settings. History actions wait while there are unsaved edits, a running update or a stale document. The document keeps Edit, Save as draft, Save and approve (or Approve when nothing changed), Discard edits and revision restoration; saved drafts need approval and existing batches retain their snapshots. Readable Markdown with section links; the editable source is monospace and preserves unsaved text while editing or previewing.
- **Activity:** requests grouped by asset with asset, action and outcome filters. Actions use the same readable labels and role icons as the model page (Build, Photography, Judge, Design reference, Collection plan), never raw role ids. Expandable rows prioritize action, timestamp, outcome and estimated cost; technical model/engine details, exact cost, token counts with inline colour swatches, and transcripts live inside. Mobile rows stack without hiding status. Label missing prices as not yet priced, distinct from unfinished jobs.
- **Forms:** shadcn Label, Input, Textarea, and Button with stacked labels, ivory surfaces, generous padding, and dashed upload areas. Use Alert for errors.
- **Dialogs:** shadcn Dialog with focus management and Escape behavior; centered on a translucent green overlay with blur. Every dialog ends in a `DialogFooter` with a Cancel button (DialogClose) and one primary action; forms scroll inside while the footer stays visible. Standard dialogs are 570px wide, constrained by the viewport and a 92vh maximum height. Model inspection uses a dedicated page.
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

In the collection, failed processing after model creation appears as a recovery alert below the model grid. Reserve model cards for existing assets and unfilled generation slots. Show collection renders only for batches represented by the current models; keep previous iteration artifacts in storage.

When queued or running work exists but the worker heartbeat is stale, the project list and workspace show one alert explaining that generation is paused, with a link to Diagnostics. Show active design updates in the project status and on their source model, separately from the model's approval. Disable design saves during an update. Preserve unsaved edits when a new revision arrives and offer an explicit discard-and-load action before approval. The queue includes design generation, design updates, and immediate name/brief drafts alongside generation jobs.

Use concise, specific actions such as “New project,” “Generate models,” and “Save and approve.” Keep failure, review, approval, and completion with issues distinguishable. Progress describes workflow milestones, not a time estimate. Label model costs as estimates and retain access to their breakdown.

The shared model viewer is a quiet lightbox, not a separate visual language: softly lit sage daylight, a charcoal-blue night option, and an optional grid. Its floating controls use the app's existing shadcn buttons and translucent ivory surfaces. Offer bounded-zoom orbit, a four-direction split view (front/right/back/left), and a collision-free first-person fly camera. Use the compact Three.js editor-style XYZ axis helper in the top-right; its six axis endpoints snap the camera to orthographic directions. Keep reset in the main toolbar, fullscreen at the bottom-right, and make all UI optional for small previews. The shading menu offers Realistic, Solid, Normals, and Wireframe modes. The camera menu highlights its trigger while open and copies the current scene (all four panes in split mode) as a PNG or downloads it, with visible success/error feedback. Model loading uses the shared viewer skeleton. Keep controls reachable at phone width and provide accessible labels for icon-only actions.

Use semantic links for navigation and buttons for actions, associated form labels, descriptive image alternatives, visible keyboard focus, and text alongside status colors. For new or revised dialogs, verify keyboard operation, focus management, and Escape behavior. Check contrast and touch targets when adding controls; the existing small muted labels are a visual baseline, not an accessibility certification. Respect reduced-motion preferences when extending animation.

## Maintaining the theme

Start with `src/styles.css`, `src/components/ui/`, `src/routes/__root.tsx`, and the relevant route/component. Use the installed shadcn primitive for controls that have one; preserve app-specific layouts and use semantic theme tokens for new colors. Skeletons mirror project cards, workspace statistics, queue entries, agent cards, text, images, and the 3D viewer while loading. Keep loaded content visible during background polling. Validate UI changes in both the project list and a populated workspace, including phone width and loading, empty, review, error, and long-content states relevant to the change. Update this guide when intentional changes alter the shared visual language.

## Administration and texture inspection

The header groups Projects and one Admin entry as icon-and-text links, with a forest-green active section (Projects remains active inside a project). Admin pages share a bordered left sidebar for Queue, Agents, Diagnostics and Settings; below 900px it becomes a compact horizontal subnavigation so page content keeps enough width. At phone widths the navigation stays on the brand row as icon-only 44px links with titles and visually hidden labels. Admin cards use restrained shadows, clear status badges and dense but readable control groups. Agents exposes model and effort or quality overrides while keeping engines and prompt sources visibly read-only. Queue puts pause and concurrency controls above job operations. Diagnostics uses status cards and redacted operational details. Settings groups timeouts and generation defaults with a persistent save action; model pricing stays repository-managed. Model detail pages are a studio split like a chat tool: the conversation column on the left carries the model heading, the build story as messages (user bubbles for the brief and change prompts, agent cards for each recorded step with judge scores and Read review / Inspect links) and a pinned composer; the preview pane on the right fills the rest of the viewport with media tabs, the version picker, Download GLB, Blender source and a More files menu (source bundle, LODs, sprite sheet, only when they exist) in its top bar, then the viewer, a facts strip (triangles, dimensions, stage, version, cost estimate), the pipeline and the tabbed records (Review, Analysis, Tools, Versions, Activity) scrolling inside the pane. The breadcrumb stops at the project because the model heading is the current page; the original brief stays collapsed at the top of the build story. On phones the heading, preview, feed and composer stack. Selected media, section and version persist in the URL. Any image asset (renders, textures, visual target, review thumbnails) opens in a lightbox with arrow-key paging, download and open-original actions. Texture cards open the selected version's image for inspection/download.

## Reference image intake

The project setup dialog uses Uppy’s inline Dashboard for local reference-image selection, drag-and-drop and scoped clipboard paste, with a separate **From URL** disclosure backed by the app’s import endpoint. Show the six-image count, supported formats and 8 MB limit before selection. Selected and saved images share a thumbnail grid with individually labelled remove buttons; use three columns on desktop and two on phones. Keep URL import errors inside the uploader, retain selections after errors, and disable competing intake/submission actions while importing. Do not intercept text paste in form fields. Theme Uppy with the workshop’s semantic colors and use existing shadcn Button, Input, Collapsible and Alert components around it.

The design reference sidebar uses the same uploader during review and editing. Save reference changes with the document through Save as draft or Save and approve. Discard edits restores both text and saved references. Polling and toggling the document preview preserve selections. Adding an image does not automatically rewrite the generated design.

## Design mockups

Mockups are an optional tab shown after approval, laid out like the design studio: a Mockup chat on the left and a gallery of every mockup on the right. Generation uses the configured ChatGPT Image API for 1–4 landscape concept images from the frozen approved design and its references, with an optional description, honest queued/running states, partial results, cancellation and failed-job resume. Each generated image becomes its own saved mockup, so earlier design versions stay in the gallery.

Every mockup can be revised (the chat composer then shows it as the base and the image is sent first), downloaded, deleted behind a confirmation, or accepted. Accepting asks for optional context ("I like the thin outlines"); accepted mockups show a green border, an Accepted badge and their note, can be edited or removed from the direction, and are sent with their notes, newest four, to every batch started afterwards. Users can also upload PNG, JPG or WebP mockups. Open images in the shared lightbox. Keep concept previews separate from final assets and uploaded references, and explain that image requests are paid and recorded in Activity & cost.

## Model and graphic ideas

The collection's Add ideas dialog captures the brief, requested count, review rounds and sprite or canvas settings. With an approved design its primary action is Save and start generation; Save for later keeps the idea without queueing anything. Before approval only Save idea is offered. AI brief drafting remains optional and paid. Saved ideas appear in a compact table at the top of the Ideas tab, above the collection they will join: one row per idea with the first line of its brief, count, settings and Start, Edit and Discard actions. Saving or starting opens the Ideas tab. Edit opens the idea dialog with its saved brief and settings; Save changes updates only an unstarted idea and does not queue generation. Starting requires an approved design and snapshots the design and collection guidance at that time. A started idea moves into the asset collection as a queued batch; repeated starts reuse that batch. Discard removes only an unstarted idea.

Put the brief first in the idea dialog, followed by a bordered Generation settings group. Keep count and review rounds or canvas side by side on desktop and stacked on phones. Sprite delivery uses an inline checkbox; show cell size and animation frames only when enabled. Scroll the fields independently and keep the Save idea footer visible.

## Model pipeline strip

The model page puts the viewer first. Below the workbench, a compact pipeline strip shows every recorded step as a chip (running, failed, changes requested and passed states keep their badge colors, judge chips carry the score); selecting a chip opens that step's result and feedback below the strip, with links to the exact archived build and activity history. There is no separate expanded graph: the build story already shows the sequence. Visual target, build, photography and judge chips come from actual model runs. Do not invent photography or judge stages for older or unreviewed builds. Running, failed, interrupted, changes requested and passed states include text and icons. The model's milestone progress and final outcome remain separate from judge approval. On phones, scroll the strip horizontally inside its panel; the page itself must not overflow.

The build story is the left conversation column; it presents the same recorded steps as readable messages with the step's role icon, with a collapsed original brief. Finished steps fold to a one-line summary (icon, label, judge score, state) that expands on demand; the latest or running step stays open. The pinned composer starts from the selected saved version (Ctrl or ⌘ + Enter sends): Iterate creates a linked continuation with the same name, while Fork variant asks for a new name. Both take a change prompt and a fresh review-round limit. A separate design action uses one selected saved render to draft a new project design revision and add that render to references; the render, and when all six reference slots are used the reference to replace, are chosen from thumbnail image choices rather than dropdowns. The draft requires review and approval.

## Project overview

The project overview puts the brief and the primary generation action in the page header; approved 3D projects also offer an Import model action there, which opens a dialog for a GLB or Blender file and starts a reviewed model. References live in the Design tab. Iterated collection entries show their lineage (Iteration N, Fork of X) above the original brief rather than the latest change prompt. Collection filter chips (All, In progress, Needs attention, Completed) carry counts and sit beside the collection search. Queued or planning batches occupy ordinary model cards, one per outstanding model; replace those placeholders as model rows are created. A batch that fails after its models exist (the collection render step) shows its error and a Retry renders action on the affected model's card, never as a detached panel. Placeholder cards show honest queue/planning states and must not link to nonexistent models. The collection grid, reference panel and filters adapt to phone widths.

The project setup brief is optional. Use one Draft brief with AI / Refine brief with AI action below the uploader; it works from any of a name, notes or reference images and explains which inputs it uses. Suggest name likewise works from the brief or the references alone, so neither AI action depends on the other. The setup fields scroll within the dialog while its creation footer stays visible. Blank briefs proceed to design generation from the name and references.

## Review and recovery usability

Model reviews lead with the score, outcome, finding counts by severity (minor neutral, major amber, critical red), a short assessment and actionable findings. Each finding shows thumbnails of the archived renders it cites, linking only to the selected version’s renders, with the judge’s view note as a caption; keep the complete judge assessment in Full review. Start the GLB camera at a front three-quarter angle for the workshop’s +Y-forward Blender export convention. Phone viewers offer 44px controls, a consolidated View menu and pinch-to-zoom guidance; retain the full desktop toolbar. Dialog close buttons have 44px hit areas.

Generation uses the label Review rounds per stage, explaining early passes, geometry approval before materials, and the four-pass unjudged path at zero. Queue failures appear above active/history sections with plain-language guidance, expandable error details and links to the exact model or project recovery flow. Preserve existing resume/retry behavior.

PBR material controls live in a dedicated tab within approved 3D collections, using labelled shadcn fields grouped into Scale, Surface and Weathering fieldsets; each saved material's map files sit behind one Downloads menu. Saved material cards show full review sheets, numeric evidence and downloads. Version tools (render again, sprite export, match collection style, fix selected findings) have their own Tools tab in the model records; the sprite export dialog lives there, with palette/timing controls and errors inside the dialog. Saved export history shows complete sheets without cropping and retains cancel/resume actions.

Selecting a mesh in the 3D view or scene inspector adds a removable object reference above the change composer. Show its name and parent path. Tie it to the displayed saved GLB version and clear it when that version changes. Submitted changes retain a reference link to the exact source version in the build story.

New 3D ideas include a Skip visual mock checkbox. By default, the build story shows the current target with Approve & build and a feedback field for Revise visual target. Waiting targets use the amber Awaiting approval status and appear under Needs attention. Keep the approval card inside the scrollable conversation, with the complete image visible and no cropped preview.
