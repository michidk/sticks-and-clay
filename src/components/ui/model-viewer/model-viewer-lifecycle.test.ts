import { expect, test } from "bun:test";
import {
  initialViewerLifecycle,
  viewerLifecycleReducer as reduce,
  type ViewerLifecycle,
  type ViewerLifecycleEvent,
} from "./model-viewer-lifecycle";

const transitions: Record<ViewerLifecycle["status"], ViewerLifecycle["status"][]> = {
  idle: ["loading", "idle", "idle", "idle", "idle"],
  loading: ["loading", "loading", "idle", "error", "ready"],
  ready: ["loading", "loading", "idle", "error", "ready"],
  error: ["loading", "loading", "idle", "error", "error"],
};
const events: ViewerLifecycleEvent[] = [
  { type: "mount" },
  { type: "reset" },
  { type: "unmount" },
  { type: "error" },
  { type: "ready", pane: 0, expectedPanes: 1 },
];

for (const status of Object.keys(transitions) as ViewerLifecycle["status"][]) {
  for (const [index, event] of events.entries()) {
    test(`${status} + ${event.type} preserves lifecycle invariants`, () => {
      const readyPanes = new Set([2]);
      const current: ViewerLifecycle = { status, generation: 7, readyPanes };
      const next = reduce(current, event);
      expect(next.status).toBe(transitions[status][index]);
      const startsGeneration = ["mount", "reset", "unmount"].includes(event.type);
      expect(next.generation).toBe(startsGeneration ? 8 : 7);
      if (startsGeneration) expect(next.readyPanes.size).toBe(0);
      expect(current).toEqual({ status, generation: 7, readyPanes: new Set([2]) });
    });
  }
}

test("split panes become ready only after all distinct panes report, in any order", () => {
  let state = reduce(initialViewerLifecycle, { type: "mount" });
  for (const pane of [3, 1, 0]) {
    state = reduce(state, { type: "ready", pane, expectedPanes: 4 });
    expect(state.status).toBe("loading");
    expect(reduce(state, { type: "ready", pane, expectedPanes: 4 })).toBe(state);
  }
  state = reduce(state, { type: "ready", pane: 2, expectedPanes: 4 });
  expect(state.status).toBe("ready");
  expect(state.readyPanes.size).toBe(4);
});

test("errors cannot be cleared by late readiness; retry starts with no ready panes", () => {
  let state = reduce(initialViewerLifecycle, { type: "mount" });
  state = reduce(state, { type: "ready", pane: 0, expectedPanes: 2 });
  state = reduce(state, { type: "error" });
  expect(reduce(state, { type: "ready", pane: 1, expectedPanes: 2 })).toBe(state);
  state = reduce(state, { type: "reset" });
  state = reduce(state, { type: "ready", pane: 1, expectedPanes: 2 });
  expect(state.status).toBe("loading");
  state = reduce(state, { type: "ready", pane: 0, expectedPanes: 2 });
  expect(state.status).toBe("ready");
  expect(state.generation).toBe(2);
});

test("unmounted viewers ignore readiness and errors, and remount in a fresh generation", () => {
  let state = reduce(initialViewerLifecycle, { type: "mount" });
  state = reduce(state, { type: "ready", pane: 0, expectedPanes: 1 });
  state = reduce(state, { type: "unmount" });
  expect(reduce(state, { type: "ready", pane: 0, expectedPanes: 1 })).toBe(state);
  expect(reduce(state, { type: "error" })).toBe(state);
  expect(reduce(state, { type: "mount" })).toEqual({
    status: "loading",
    generation: 3,
    readyPanes: new Set(),
  });
  expect(initialViewerLifecycle.readyPanes.size).toBe(0);
});
