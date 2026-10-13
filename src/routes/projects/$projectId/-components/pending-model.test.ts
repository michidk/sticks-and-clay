import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingModel } from "./pending-model";

test("a failed batch missing its model keeps a recovery card", () => {
  const html = renderToStaticMarkup(
    createElement(PendingModel, {
      batch: {
        id: "batch",
        count: 1,
        prompt: "Refine the car",
        status: "failed",
        error: "Planner returned 0 models",
      },
      index: 0,
      busy: false,
      onResume: () => {},
      assetType: "model",
    }),
  );
  expect(html).toContain("model-card");
  expect(html).toContain("Planner returned 0 models");
  expect(html).toContain("Resume batch");
});
