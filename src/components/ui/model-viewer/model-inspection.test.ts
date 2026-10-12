import { expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import {
  frameBounds,
  inspectModel,
} from "./model-inspection";
import { createViewerCameraStore } from "./model-viewer-camera";

test("camera store publishes live views and validates arbitrary view commands", () => {
  const store = createViewerCameraStore();
  const received: string[] = [];
  const unsubscribe = store.subscribe(() => received.push(JSON.stringify(store.getSnapshot())));
  const view = { position: [2, 3, 4], target: [0, 0, 0] } as const;
  expect(store.setView({ position: [...view.position], target: [...view.target] })).toBe(false);
  const commands: Array<{ transition: boolean }> = [];
  store.register((_view, transition) => commands.push({ transition }));
  expect(
    store.setView(
      { position: [...view.position], target: [...view.target] },
      { transition: false },
    ),
  ).toBe(true);
  expect(commands).toEqual([{ transition: false }]);
  expect(store.setView({ position: [0, 0, 0], target: [0, 0, 0] })).toBe(false);
  expect(store.setView({ position: [Infinity, 0, 0], target: [0, 0, 0] })).toBe(false);
  store.publish({ position: [...view.position], target: [...view.target] });
  store.publish({ position: [...view.position], target: [...view.target] });
  expect(received).toHaveLength(1);
  store.register(null);
  expect(store.getSnapshot()).toBeNull();
  expect(received).toHaveLength(2);
  unsubscribe();
});

test("framing fits tiny, huge and offset objects at narrow aspect ratios", () => {
  for (const scale of [0.000001, 1, 1e6]) {
    const mesh = new Mesh(new BoxGeometry(2, 4, 6));
    mesh.scale.setScalar(scale);
    mesh.position.set(100 * scale, -20 * scale, 50 * scale);
    const frame = frameBounds(mesh, 0.25);
    expect(frame.center.toArray()).toEqual(mesh.position.toArray());
    expect(frame.near).toBeLessThan(frame.distance - frame.radius);
    expect(frame.far).toBeGreaterThan(frame.distance + frame.radius);
    expect(Math.asin(frame.radius / frame.distance)).toBeLessThan(
      Math.atan(Math.tan((21 * Math.PI) / 180) * 0.25),
    );
  }
});

test("inspection counts shared resources once and preserves hierarchy", () => {
  const root = new Group();
  const material = new MeshStandardMaterial({ map: new Texture() });
  root.add(new Mesh(new BoxGeometry(), material), new Mesh(new BoxGeometry(), material));
  const info = inspectModel(root);
  expect(info.triangles).toBe(24);
  expect(info.materials).toBe(1);
  expect(info.textures).toBe(1);
  expect(info.nodes.filter((node) => node.mesh)).toHaveLength(2);
  expect(new Set(info.nodes.map((node) => node.id)).size).toBe(3);
});
