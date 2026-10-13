# Model viewer

Collection quick previews and model detail pages use [shadcn-3d-viewer](https://github.com/michidk/shadcn-3d-viewer). The component is installed as source in `src/components/ui/model-viewer/`, following the upstream source-install workflow. It inherits the workshop's semantic theme tokens.

Import the lazy entry so the Three.js renderer loads only when a viewer mounts:

```tsx
import { ModelViewer } from "@/components/ui/model-viewer/lazy";
import { ViewerSkeleton } from "@/components/loading";

<ModelViewer
  src="/api/files/example.glb"
  aria-label="Example model"
  loadingFallback={<ViewerSkeleton overlay />}
  showRetry
/>
```

Static renders remain the default on collection cards. The opt-in preview uses `showUi={false}`, `height="100%"`, and `defaultAutoRotate`; only one card preview is active at a time.

## Controls

The detail viewer provides orbit, four-view split, and first-person cameras; perspective and orthographic projection; day, night, and outdoor lighting; realistic, solid, normal, and wireframe shading; grid and floor toggles; animation playback; scene inspection; screenshots; and fullscreen. Toolbar state is local unless the caller supplies a controlled prop and its change callback. Use `default*` props for initial uncontrolled state.

The toolbar keeps shading, camera, inspection, reset, and viewer options visible in one row. Camera options include split and fly modes, orthographic projection, and automatic rotation. Viewer options group lighting, grid, floor, the orientation helper, and PNG screenshots. On narrow viewers, labeled menu buttons become icons with accessible names and tooltips; touch targets remain at least 44px. Fullscreen stays in the lower corner, and animation controls appear only for animated models.

The orientation helper has a single on/off control and supports mouse and keyboard controls. First-person navigation uses WASD or arrow keys, Space/E to rise, and Shift/Q to descend. Escape releases pointer lock. Frames that restrict pointer lock support drag-look instead. The camera does not collide with geometry.

Screenshot controls download or copy a PNG, including all four panes in split mode. Clipboard permissions may block copying; download remains available. Fullscreen uses an in-page fallback when the browser restricts the Fullscreen API.

The viewer pauses rendering and animation while hidden. Failed model loads offer retry. A failed renderer download stays inside the viewer and offers **Reload page**, which refreshes obsolete module URLs after deployment.

## Object references

The model page controls `selectedMesh` through `onSelectedMeshChange` and resolves its name and parent path from `onInspect`. Selection appears in the change composer and is scoped to the displayed saved GLB. Submitted references are stored with the model's source run and appended to that model's agent input; subsequent branches do not inherit stale selection metadata. The API rejects a reference whose GLB differs from the selected source run.

The upstream selection fix keeps outline helpers out of material overrides, picking and hierarchy counts. Empty-space clicks and Escape clear selection; orbit drags do not select. Upstream browser tests capture the selected GLB before and after a shading change, measure its orange outline pixels, and exercise controlled selection, repeated clicks, clearing and source replacement.

## Upstream source

The installed source is pinned to commit [`95cbba478d37a6f5966d42338ed5a11a3ccfbc52`](https://github.com/michidk/shadcn-3d-viewer/tree/95cbba478d37a6f5966d42338ed5a11a3ccfbc52). Its [MIT license](../src/components/ui/model-viewer/LICENSE) is retained alongside the source.

Local adaptations include scoped Base UI primitives, a compact review toolbar, the workshop's initial three-quarter camera direction, and spacing for the orientation helper below the toolbar. Other app controls retain their existing Radix implementations. The viewer's stylesheet owns its controls; application CSS owns card and page placement. Selected upstream lifecycle, camera, and model-inspection tests run through Bun.

For updates, review the upstream source diff, copy the viewer files and its required primitives, retain these adaptations, and run `bun run verify`. Check a real exported GLB at desktop and phone widths, including split view, shading, screenshots, fullscreen, and the compact card preview. The procedural material editor has its own texture/slot preview and remains separate.
