import { expect, test } from "bun:test";
import { blenderFailure } from "./index.server";

test("blender failures keep the last stderr lines without container noise", () => {
  expect(
    blenderFailure(
      "could not get a list of mounted file-systems\nRead blend\n\nTraceback\nKeyError: 'Cube'\n",
    ),
  ).toBe("Read blend\nTraceback\nKeyError: 'Cube'");
  expect(blenderFailure(undefined)).toBe("");
});
