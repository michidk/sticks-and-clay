import { test, expect } from "bun:test";
import { recordedAnalysis } from "./report";
const prefix =
  "DESIGN REFERENCE\nuser notes\nDETERMINISTIC ANALYSIS (read-only, advisory)\n";
test("reads the exact saved judge report, including incomplete and legacy evidence", () => {
  const report = {
    version: 1,
    findings: [
      { object: "wall", code: "open_boundary", count: 4, polygons: [2] },
    ],
    unavailable: ["CGAL unavailable"],
    sha256: "a",
  };
  expect(
    recordedAnalysis(
      prefix +
        JSON.stringify(report) +
        "\nUse these findings alongside photos.",
    ),
  ).toMatchObject(report);
  expect(
    recordedAnalysis(
      prefix +
        JSON.stringify({ version: 2, findings: [], unavailable: ["timeout"] }),
    ),
  ).toMatchObject({ findings: [], unavailable: ["timeout"] });
});
test("missing or malformed evidence is not represented as a clean report", () => {
  for (const s of [
    "old judge input",
    prefix + "bad JSON",
    prefix + "{}",
    prefix + JSON.stringify({ version: 2, findings: [{}] }),
  ])
    expect(recordedAnalysis(s)).toBeUndefined();
});
