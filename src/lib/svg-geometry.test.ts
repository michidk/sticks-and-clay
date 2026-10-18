import { expect, test } from "bun:test";
import { analyzeSvg, validateSvg } from "./svg";

const analyze = (body: string) => analyzeSvg(validateSvg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`,
)).geometry!;

test("flags a lid/body near miss with actionable coordinates and inherited stroke settings", () => {
  const geometry = analyze('<path id="lid" d="M4 4H18"/><path id="body" d="M18.25 4L16 14H6Z"/>');
  // A closed body has no open endpoints; a separate capped side exposes the bad join.
  expect(geometry.openSubpaths).toBe(1);
  const open = analyze('<path id="lid" d="M4 4H18"/><path id="side" d="M18.25 4L16 14"/>');
  expect(open.endpointThreshold).toBe(0.5);
  expect(open.findings).toEqual([{
    kind: "near-endpoints",
    first: { element: "path[3]#lid", subpath: 1, at: [18, 4] },
    second: { element: "path[4]#side", subpath: 1, at: [18.25, 4] }, distance: 0.25,
  }]);
  expect(open.strokes).toEqual([
    { element: "path[3]#lid", width: "1", cap: "round", join: "round" },
    { element: "path[4]#side", width: "1", cap: "round", join: "round" },
  ]);
});

test("finds retraced shared edges after relative commands and nested transforms", () => {
  const geometry = analyze('<g transform="translate(2 3)"><path id="edge" transform="scale(2)" d="m1 1h4"/></g><line id="copy" x1="12" y1="5" x2="4" y2="5"/>');
  expect(geometry.findings).toContainEqual({ kind: "duplicate-segment", first: "path[4]#edge", second: "line[5]#copy", from: [12, 5], to: [4, 5] });
  expect(geometry.findings.filter(f => f.kind === "near-endpoints")).toHaveLength(2);
});

test("handles closed contours, implicit line commands, curves and deliberate open gaps", () => {
  expect(analyze('<path d="M2 2 10 2 10 10 2 10z"/>')).toMatchObject({ openSubpaths: 0, findings: [], skipped: 0 });
  expect(analyze('<path d="m2 2q2 0 2 2t2 2c1 1 2 1 3 0s2-1 3 0a2 2 0 0 1 2 2"/>')).toMatchObject({ openSubpaths: 1, findings: [], skipped: 0 });
  expect(analyze('<polyline points="2,2 8,2 8,8"/><polygon points="14,14 20,14 20,20"/>')).toMatchObject({ openSubpaths: 1, findings: [], skipped: 0 });
  const nearClosed = analyze('<path d="M2 2L8 2L8 8L2.2 2"/>');
  expect(nearClosed.findings).toContainEqual({ kind: "near-endpoints", first: { element: "path[3]", subpath: 1, at: [2, 2] }, second: { element: "path[3]", subpath: 1, at: [2.2, 2] }, distance: 0.2 });
});

test("reports reversed curves but not curves with different controls", () => {
  const geometry = analyze('<path d="M2 2Q4 8 8 2M8 2Q4 8 2 2M2 2Q4 9 8 2"/>');
  expect(geometry.findings.filter(f => f.kind === "duplicate-segment")).toEqual([
    { kind: "duplicate-segment", first: "path[3]", second: "path[3]", from: [8, 2], to: [2, 2] },
  ]);
});

test("ignores definitions, unpainted strokes and transparent groups; preserves overrides", () => {
  const geometry = analyze('<defs><path d="M2 2L8 2L2 2"/></defs><g opacity="0"><path d="M2 2L8 2L2 2"/></g><path stroke="none" d="M2 2L8 2L2 2"/><circle cx="12" cy="12" r="4" stroke-width="2" stroke-linecap="square" stroke-linejoin="bevel"/>');
  expect(geometry.findings).toEqual([]);
  expect(geometry.strokes).toEqual([{ element: "circle[6]", width: "2", cap: "square", join: "bevel" }]);
});

test("reports incomplete analysis instead of treating unsupported or excessive geometry as clean", () => {
  expect(analyze('<svg viewBox="0 0 10 10"><path d="M2 2L8 2L2 2"/></svg><path d="M nope"/>').skipped).toBe(2);
  const many = analyze('<path d="M2 2L8 2"/>'.repeat(1000));
  expect(many.truncated).toBe(true);
  expect(many.findings.length).toBeLessThanOrEqual(64);
  expect(many.strokes.length).toBeLessThanOrEqual(128);
});


test("flags mixed effective stroke settings without treating deliberate variation as failure", () => {
  const geometry = analyze('<path d="M2 2L8 2"/><g stroke-width="2" stroke-linecap="butt"><path stroke-linejoin="bevel" d="M12 12L18 18"/></g>');
  expect(geometry.mixedStrokeSettings).toEqual({ width: true, cap: true, join: true });
  expect(geometry.findings).toEqual([]);
});
