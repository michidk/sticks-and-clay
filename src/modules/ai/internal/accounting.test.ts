import { expect, test } from "bun:test";
import { imagePrice, imagePricingSnapshot, pricingSnapshot } from "./accounting.server";

test("pricing snapshots are selected by canonical model id", () => {
  expect(pricingSnapshot("openai/gpt-6-sol")).toMatchObject({
    input: 2, cached: 0.2, cacheWrite: 2.5, output: 10,
  });
  expect(pricingSnapshot("gpt-6-astra")).toMatchObject({
    input: 10, cached: 1, cacheWrite: 12.5, output: 50,
  });
  expect(pricingSnapshot("custom-model")).toMatchObject({ unavailable: true });
});

test("image pricing uses the provider's text and image token split", () => {
  const rates = imagePricingSnapshot("gpt-image-2");
  expect(imagePrice({
    input_tokens: 150,
    output_tokens: 20,
    input_tokens_details: { text_tokens: 100, image_tokens: 50 },
    output_tokens_details: { image_tokens: 20 },
  }, rates)).toBeCloseTo((100 * 5 + 50 * 8 + 20 * 30) / 1e6);
});
