export type ViewerLifecycle = {
  status: "idle" | "loading" | "ready" | "error";
  readyPanes: ReadonlySet<number>;
  generation: number;
};

export type ViewerLifecycleEvent =
  | { type: "mount" }
  | { type: "reset" }
  | { type: "unmount" }
  | { type: "ready"; pane: number; expectedPanes: number }
  | { type: "error" };

export const initialViewerLifecycle: ViewerLifecycle = {
  status: "idle",
  readyPanes: new Set(),
  generation: 0,
};

export function viewerLifecycleReducer(
  current: ViewerLifecycle,
  event: ViewerLifecycleEvent,
): ViewerLifecycle {
  switch (event.type) {
    case "mount":
      return { status: "loading", readyPanes: new Set(), generation: current.generation + 1 };
    case "reset":
      return {
        status: current.status === "idle" ? "idle" : "loading",
        readyPanes: new Set(),
        generation: current.generation + 1,
      };
    case "unmount":
      return { status: "idle", readyPanes: new Set(), generation: current.generation + 1 };
    case "error":
      return current.status === "loading" || current.status === "ready"
        ? { ...current, status: "error" }
        : current;
    case "ready": {
      if (current.status !== "loading" || current.readyPanes.has(event.pane)) return current;
      const readyPanes = new Set(current.readyPanes).add(event.pane);
      return {
        ...current,
        readyPanes,
        status: readyPanes.size >= event.expectedPanes ? "ready" : "loading",
      };
    }
  }
}
