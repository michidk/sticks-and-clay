# Model viewer

`ModelViewer` displays a GLB in a Three.js lightbox. Import it lazily on pages that do not always show a model. Static renders are the default on collection cards; an opt-in compact viewer avoids creating many WebGL contexts for a large collection.

## Component options

| Option | Behavior |
|---|---|
| `src`, `alt`, `height`, `className` | Model URL, accessible label, and layout. Omitting `src` shows sample cubes. |
| `mode` | `orbit`, `split`, or `firstPerson`. Orbit has bounded zoom; split shows front, right, back, and left views. |
| `lighting` | `day` or `night` |
| `shading` | `realistic`, `solid`, `normals`, or `wireframe` |
| `showGrid`, `showCubes` | Initial scene options |
| `showUi` | Set to `false` for a compact preview without controls or hints. |
| `showOrientation` | Show the XYZ axis helper. Click an axis endpoint to align the camera. |
| `autoRotate`, `autoRotateSpeed` | Initial orbit animation options |
| `onLoad`, `onError` | Loading and failure callbacks |
| `onModeChange`, `onLightingChange`, `onShadingChange` | Scene option callbacks |

The toolbar changes options locally. Use the callbacks when the parent needs to retain those changes. Reset returns the camera to its initial view.

## Camera controls

In first-person mode, click the scene to lock the pointer. Move with WASD or the arrow keys; use Space/E to rise and Shift/Q to descend. Escape releases the pointer. The camera does not collide with model geometry. Embedded frames that disallow pointer lock support dragging on the focused canvas to look around, with the same movement keys.

## Images and fullscreen

The camera menu captures the scene as a PNG, including all four panes in split mode. Copy to clipboard puts the image on the system clipboard; Download image saves it with a model-based filename. If browser clipboard permissions block copying, the viewer reports the error and downloading remains available.

The bottom-right button enters fullscreen. Compact viewers with `showUi={false}` omit these actions.
