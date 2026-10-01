import { expect, test } from "bun:test";
import { runtimeSettingsDefaults } from "../../../lib/runtime-settings";
import { pricingSnapshot } from "./accounting.server";

test("pricing snapshots use the effective model tier without mutating defaults", () => {
  const settings = runtimeSettingsDefaults();
  settings.pricing.defaultText = {
    input: 3,
    cached: 0.3,
    output: 12,
    source: "Admin assumption",
  };
  settings.pricing.astra = {
    input: 11,
    cached: 1.1,
    output: 55,
    source: "Admin Astra assumption",
  };
  expect(pricingSnapshot("custom-model", settings)).toEqual(settings.pricing.defaultText);
  expect(pricingSnapshot("gpt-6-astra", settings)).toEqual(settings.pricing.astra);
});
