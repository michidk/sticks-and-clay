# Sticks & Clay design guide

This is the application's UI design reference, based on the existing theme in `src/styles.css` and the running project list and project workspace inspected on 2026-09-29. Project-specific asset design references are separate, versioned documents stored in the database.

## Character

Sticks & Clay feels like a calm creative workshop: warm ivory surfaces, forest-green typography, sage accents, generous space, and restrained outlines. The assets and reference images provide the visual variety. Keep the interface quiet enough to compare models and read detailed design feedback.

The home headline pairs a plain sans-serif statement (“Build a world.”) with a softer italic serif line (“Keep it consistent.”). Use that editorial contrast sparingly. The brand combines a forest-green stick and terracotta clay-arch emblem, the Sticks & Clay text wordmark, and a small outlined WORKSHOP label. The emblem lives at `public/brand/sticks-and-clay.png`, with a matching PNG favicon. Keep the wordmark as accessible text; reserve terracotta for the brand so forest green remains the action color.

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

## Typography and spacing

- The font stack starts with Inter, then system sans-serif fonts; the app does not currently load a bundled Inter font. Base text is 14px. Georgia supplies the italic headline accent; code, transcripts, and the design editor use system monospace.
- Desktop home headlines are 56px with 1.1 line height and −2.8px tracking. Project titles are 40px. Section headings are 20px; card headings are 17px. Most headings use moderate weights around 530–570.
- Eyebrows are 10px, widely tracked, and uppercase. Supporting text is generally 12–14px with relaxed line height. Small labels and metadata use 9–11px; preserve readability when introducing new information.
- Main content is centered at a maximum width of 1330px, with desktop padding of 48px 40px 65px. The header is 82px tall on desktop, with its contents aligned to the main content. Grids use 23px gaps; panels use 26px padding.
- Use 7px corners for controls, 10px for panels, 12px for cards, and 16px for dialogs. Separation comes primarily from spacing and 1px borders. Card hover shadows are subtle; dialogs use a stronger shadow.

## Components and layout

- **Project list:** eyebrow, two-line headline, supporting copy, and a prominent New project action; a three-column card grid; a dashed creation card; a short three-step workflow explanation.
- **Project cards:** 205px cover, status at the top left, name and arrow, two-line description, then a divided metadata row for date and estimated usage. When no reference exists, use the existing soft sage gradient, thin Layers icon, and STYLE STARTS HERE caption.
- **Project workspace:** back link, project identity and generation action, four statistics, then underlined tabs for Models, Design reference, and Activity & cost.
- **Models:** 240px cover images with an opt-in inline 3D quick preview, readable status, asset name, brief, triangle/cost metadata, and separate GLB/source downloads. Only one card preview is active at a time; collection renders sit in a two-column panel above model cards when available.
- **Design reference:** readable Markdown with GFM tables and revision comparisons; a main document column with a 280px reference sidebar. The editable source is monospace. Keep save, approval, and revision restoration distinct.
- **Activity:** expandable run rows with role icons, status, usage, and cost; details reveal transcripts and technical information. Preserve progressive disclosure.
- **Forms:** shadcn Label, Input, Textarea, and Button with stacked labels, ivory surfaces, generous padding, and dashed upload areas. Use Alert for errors.
- **Dialogs:** shadcn Dialog with focus management and Escape behavior; centered on a translucent green overlay with blur. Standard dialogs are 570px wide; asset dialogs are 1000px, constrained by the viewport and a 92vh maximum height.
- **3D preview:** neutral lighting and background, orbit/zoom controls, loading/error text, and a short interaction hint. Let the asset's material colors remain the focus.
- **Icons and motion:** use `lucide-react` line icons. Existing hover transitions last 0.15–0.2s; activity spinners rotate over 1.4s. Avoid decorative motion that competes with work in progress.

## Responsive behavior

| Width | Existing behavior |
| --- | --- |
| Above 900px | Three-column cards, four statistics, document plus sidebar, 480px viewer |
| 601–900px | Two-column cards, document sidebar moves below into two columns, 380px viewer |
| 600px and below | One-column cards and collection renders; two-by-two statistics; stacked headings and actions; full-width main actions; two-row header; 19px main side padding; 42px home title and 34px project title; 320px viewer |

At phone sizes, dialogs use 12px outer padding and smaller inner padding. Render grids stack, tabs become more compact, and long text must wrap without widening the page. These breakpoint values come from CSS; desktop pages were visually inspected for this documentation.

## Interaction and content rules

Use concise, specific actions such as “New project,” “Generate models,” and “Save and approve.” Keep failure, review, approval, and completion with issues distinguishable. Progress describes workflow milestones, not a time estimate. Label model costs as estimates and retain access to their breakdown.

The shared model viewer is a quiet lightbox, not a separate visual language: soft sage daylight, a charcoal-blue night option, a subtle ground plane, and an optional grid. Its floating controls use the app's existing shadcn buttons and translucent ivory surfaces. Offer orbit, object rotation, and first-person movement; keep the view cube and directional arrows in the top-right, and make all UI optional for small previews. A camera menu copies the current scene as a PNG or downloads it, with visible success/error feedback. Model loading uses the shared viewer skeleton. Keep controls reachable at phone width and provide accessible labels for icon-only actions.

Use semantic links for navigation and buttons for actions, associated form labels, descriptive image alternatives, visible keyboard focus, and text alongside status colors. For new or revised dialogs, verify keyboard operation, focus management, and Escape behavior. Check contrast and touch targets when adding controls; the existing small muted labels are a visual baseline, not an accessibility certification. Respect reduced-motion preferences when extending animation.

## Maintaining the theme

Start with `src/styles.css`, `src/components/ui/`, `src/routes/__root.tsx`, and the relevant route/component. Use the installed shadcn primitive for controls that have one; preserve app-specific layouts and use semantic theme tokens for new colors. Skeletons mirror project cards, workspace statistics, queue entries, agent cards, text, images, and the 3D viewer while loading. Keep loaded content visible during background polling. Validate UI changes in both the project list and a populated workspace, including phone width and loading, empty, review, error, and long-content states relevant to the change. Update this guide when intentional changes alter the shared visual language.

## Administration and texture inspection

The header groups Projects, Queue and Agents as icon-and-text links, with a forest-green active section (Projects remains active inside a project). At phone widths, the brand and outlined WORKSHOP badge sit above a full-width navigation row with 44px touch targets. The read-only Agents page uses responsive panels with model, effort, engine and prompt settings. Model dialogs have a Textures tab beside History, 3D model and Renders; tabs wrap on small screens. Texture cards open the selected version's image for inspection/download. Project setup offers an optional, initially blank triangle-budget field.

## Reference image intake

The project setup dialog uses a shared picture uploader inspired by Roastbook. A sage drop area offers file selection, drag-and-drop and scoped clipboard paste, with a separate **From URL** disclosure below it. Show the six-image count, supported formats and 8 MB limit before selection. Selected and saved images share a thumbnail grid with individually labelled remove buttons; use three columns on desktop and two on phones. Keep URL import errors inside the uploader, retain selections after errors, and disable competing intake/submission actions while importing. Do not intercept text paste in form fields. Use existing shadcn Button, Input, Collapsible and Alert components and the workshop's semantic colors.
