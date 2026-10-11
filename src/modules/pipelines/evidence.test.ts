import { expect, test } from "bun:test";
import { reviewEvidence } from "./evidence";

test("judge labels preserve current, previous and reference transport order", () => {
  const evidence = reviewEvidence({
    buildId: "final-2",
    current: [{ path: "final.png", label: "albedo", sha256: "abc" }],
    previous: [{ path: "old.png", label: "previous review" }],
    references: [{ path: "example.png", label: "style example" }],
    parameters: { size: 1024 }, technical: {}, findings: [],
  });
  expect(evidence.images).toEqual(["final.png", "old.png", "example.png"]);
  expect(evidence.labels).toContain("Image 1: albedo (current output); sha256=abc");
  expect(evidence.labels).toContain("Image 2: previous review (previous output)");
  expect(evidence.labels).toContain("Image 3: style example (reference only)");
});
