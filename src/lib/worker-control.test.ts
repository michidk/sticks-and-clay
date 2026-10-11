import { expect, test } from "bun:test";
import { laneCanClaim } from "./worker-control.server";

test("pause and concurrency gate only future lane claims", () => {
  expect(laneCanClaim(0, { paused: true, concurrency: 4 })).toBe(false);
  expect(laneCanClaim(0, { paused: false, concurrency: 2 })).toBe(true);
  expect(laneCanClaim(1, { paused: false, concurrency: 2 })).toBe(true);
  expect(laneCanClaim(2, { paused: false, concurrency: 2 })).toBe(false);
});
