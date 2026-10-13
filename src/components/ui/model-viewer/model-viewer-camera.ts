import type { ViewerCameraOptions, ViewerCameraState } from "./model-viewer-types";

/** Mutable camera data lives outside React's root render loop. */
export function createViewerCameraStore() {
  let snapshot: ViewerCameraState | null = null;
  let controller: ((view: ViewerCameraState, transition: boolean) => void) | null = null;
  const listeners = new Set<() => void>();
  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const publish = (view: ViewerCameraState | null) => {
    const current = snapshot;
    if (
      view &&
      current &&
      view.position.every((n, i) => Math.abs(n - current.position[i]) < 1e-6) &&
      view.target.every((n, i) => Math.abs(n - current.target[i]) < 1e-6)
    )
      return;
    if (!view && !snapshot) return;
    snapshot = view;
    listeners.forEach((listener) => listener());
  };
  const register = (next: typeof controller) => {
    controller = next;
    if (!next) publish(null);
  };
  const setView = (view: ViewerCameraState, options?: ViewerCameraOptions) => {
    if (!controller || !validCameraView(view)) return false;
    controller(view, options?.transition ?? true);
    return true;
  };
  return { getSnapshot, subscribe, publish, register, setView };
}

export type ViewerCameraStore = ReturnType<typeof createViewerCameraStore>;

function validCameraView(view: ViewerCameraState) {
  const values = [...view.position, ...view.target];
  return (
    values.every(Number.isFinite) &&
    view.position.some((n, i) => Math.abs(n - view.target[i]) > 1e-9)
  );
}
