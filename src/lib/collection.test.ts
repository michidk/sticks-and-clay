import { expect, test } from "bun:test";
import {
  COLLECTION_FRONT_AZIMUTH,
  photographyFrontAzimuth,
} from "./collection.server";

test("collection scenes reuse the photographer's chosen front azimuth", () => {
  expect(
    photographyFrontAzimuth({ settings: { frontAzimuth: 55 } }),
  ).toBe(55);
  expect(photographyFrontAzimuth({ settings: {} })).toBe(
    COLLECTION_FRONT_AZIMUTH,
  );
  expect(
    photographyFrontAzimuth({ settings: { frontAzimuth: "55" } }),
  ).toBe(COLLECTION_FRONT_AZIMUTH);
});
