import { expect, test } from "bun:test";
import { assetSnapshot } from "./asset-snapshot.server";
import { generationInput } from "./api-inputs";
import { workshopSchema } from "./workshop";

const project = {
  references: ["references/first.png", "references/second.png"],
  referenceNotes: { "references/first.png": "First palette", "references/second.png": "Second silhouette" },
  workshop: workshopSchema.parse({ variation: 10 }),
};
const asset = {
  references: ["references/asset-old.png"],
  referenceNotes: { "references/asset-old.png": "Old handle" },
  input: generationInput.parse({ prompt: "switch", count: 1, judgeIterations: 0, parts: [{ name: "Handle", brief: "Movable lever" }] }),
};

test("iterations retain frozen project direction while replacing asset references and parts", () => {
  const frozen = assetSnapshot(project, asset);
  const changedProject = {
    ...project,
    references: ["references/second.png", "references/new-project.png"],
    referenceNotes: { "references/second.png": "New second note", "references/new-project.png": "New direction" },
    workshop: workshopSchema.parse({ variation: 80 }),
  };
  const changedAsset = {
    references: ["references/asset-new.png"], referenceNotes: { "references/asset-new.png": "New handle" },
    input: generationInput.parse({ prompt: "switch", count: 1, judgeIterations: 0 }),
  };
  const next = assetSnapshot(changedProject, changedAsset, frozen);
  expect(next.references).toEqual(["references/first.png", "references/second.png", "references/asset-new.png"]);
  expect(next.referenceNotes).toEqual([
    { position: 1, note: "First palette" }, { position: 2, note: "Second silhouette" }, { position: 3, note: "New handle" },
  ]);
  expect(next.parts).toBeUndefined();
  expect(next.variation).toBe(10);
  expect(frozen.references).toContain("references/asset-old.png");
  expect(frozen.parts).toEqual([{ name: "Handle", brief: "Movable lever" }]);
  const refreshed = assetSnapshot(changedProject, changedAsset);
  expect(refreshed.references).toEqual(["references/second.png", "references/new-project.png", "references/asset-new.png"]);
  expect(refreshed.referenceNotes).toEqual([
    { position: 1, note: "New second note" }, { position: 2, note: "New direction" }, { position: 3, note: "New handle" },
  ]);
  expect(refreshed.variation).toBe(80);
});

test("legacy snapshot reference notes follow the frozen keys instead of today's ordering", () => {
  const snapshot = assetSnapshot(project, { ...asset, references: ["references/new.png"], referenceNotes: { "references/new.png": "New part" } }, {
    ...workshopSchema.parse({}), references: ["references/second.png", "references/first.png"],
    referenceNotes: [{ position: 1, note: "Frozen second note" }, { position: 2, note: "Frozen first note" }],
  });
  expect(snapshot.references).toEqual(["references/second.png", "references/first.png", "references/new.png"]);
  expect(snapshot.referenceNotes).toEqual([
    { position: 1, note: "Frozen second note" }, { position: 2, note: "Frozen first note" }, { position: 3, note: "New part" },
  ]);
  expect(snapshot.projectReferences).toEqual(["references/second.png", "references/first.png"]);
});

test("combined project and asset references obey the image limit after deduplication", () => {
  expect(assetSnapshot(project, { ...asset, references: project.references }).references).toHaveLength(2);
  expect(() => assetSnapshot(project, { ...asset, references: ["a", "b", "c", "d", "e"] })).toThrow("at most 6");
});


test("legacy accepted mockups remain attached after references become explicit", () => {
  const base = { ...workshopSchema.parse({}), mockups: [{ key: "mockups/accepted.png", note: "Match the socket" }] };
  const snapshot = assetSnapshot(project, asset, base);
  expect(snapshot.references).toEqual([...project.references, ...asset.references, "mockups/accepted.png"]);
  expect(assetSnapshot(project, asset, snapshot).references).toEqual(snapshot.references);
});
