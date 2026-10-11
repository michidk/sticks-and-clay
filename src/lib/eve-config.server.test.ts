import { expect, test } from "bun:test";
import { evePassword } from "./eve-config.server";

test("Eve authentication requires a dedicated secret instead of a shared default", () => {
  for (const environment of [
    {},
    { EVE_PASSWORD: "" },
    { EVE_PASSWORD: "studio-local-agent" },
  ])
    expect(() => evePassword(environment)).toThrow("Set EVE_PASSWORD");
  const password = "test-only-secret-".repeat(3);
  expect(evePassword({ EVE_PASSWORD: password })).toBe(password);
});
