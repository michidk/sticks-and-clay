import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingModel } from "./pending-model";

test("a failed batch with existing models shows a recovery notice instead of a model card", () => {
  const props = {
    batch: {
      id: "batch",
      count: 1,
      prompt: "Refine the car",
      status: "failed",
      error: "Collection render timed out",
    },
    index: 1,
    busy: false,
    onResume: () => {},
    assetType: "model" as const,
  };
  const notice = renderToStaticMarkup(
    createElement(PendingModel, { ...props, placeholder: false }),
  );
  expect(notice).toContain('role="alert"');
  expect(notice).toContain("Collection processing needs attention");
  expect(notice).toContain("Collection render timed out");
  expect(notice).toContain("Resume processing");
  expect(notice).not.toContain("model-card");

  const missingModel = renderToStaticMarkup(
    createElement(PendingModel, { ...props, index: 0, placeholder: true }),
  );
  expect(missingModel).toContain("model-card");
  expect(missingModel).toContain("Resume batch");
});
