import { expect, test } from "bun:test";
import { imageRoles, roles } from "./roles";
import { price } from "../../lib/contracts";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import eveAgent from "../../../eve/agent/agent";

test("Eve chooses the persisted model and effort, not a new registry default", async () => {
  expect(eveAgent.limits?.sessionTimeoutMs).toBe(false);
  expect(roles.builder.model).toBe("gpt-6-astra");
  expect(roles.builder.effort).toBe("high");
  expect(roles.judge.effort).toBe("high");
  const dir = resolve("/tmp", "studio-model-test-" + crypto.randomUUID());
  const previous = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  try {
    await mkdir(resolve(dir, "session-config"), { recursive: true });
    await writeFile(
      resolve(dir, "session-config/test.json"),
      JSON.stringify({ model: "gpt-6-astra", effort: "medium" }),
    );
    expect((eveAgent.model as any).events["turn.started"]).toBeUndefined();
    const resolver = (eveAgent.model as any).events["step.started"];
    const selected = await resolver({}, { session: { id: "test" } });
    expect(selected.model.modelId).toBe("gpt-6-astra");
    expect(selected.modelOptions.providerOptions.openai.reasoningEffort).toBe(
      "medium",
    );
    await writeFile(
      resolve(dir, "session-config/test.json"),
      JSON.stringify({ model: "gpt-6-sol", effort: "low" }),
    );
    const retained = await resolver({}, { session: { id: "test" } });
    expect(retained.model.modelId).toBe("gpt-6-sol");
    expect(retained.modelOptions.providerOptions.openai.reasoningEffort).toBe(
      "low",
    );
    await writeFile(
      resolve(dir, "session-config/test.json"),
      JSON.stringify({ model: "openai/gpt-6-astra", effort: "medium" }),
    );
    const recovered = await resolver({}, { session: { id: "test" } });
    expect(recovered.model.modelId).toBe("gpt-6-astra");
    expect(recovered.modelContextWindowTokens).toBe(1050000);
  } finally {
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("graphics use the Codex-configured image API role", () => {
  expect(roles["graphic-designer"].engine).toBe("tanstack");
  expect(roles["graphic-planner"].engine).toBe("eve");
  expect(imageRoles.graphic).toMatchObject({
    engine: "imagegen",
    model: "gpt-image-2",
    quality: "high",
  });
});

test("Astra long context tier applies per model call", () => {
  const rates = {
    input: 10,
    cached: 1,
    cacheWrite: 12.5,
    output: 50,
    longContextThreshold: 272000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  };
  expect(price(300000, 1000, 100000, rates)!).toBeCloseTo(4.275);
  expect(
    price(200000, 1000, 0, rates)! + price(200000, 1000, 0, rates)!,
  ).toBeCloseTo(4.1);
  expect(price(1000, 0, 0, rates, 1000)!).toBeCloseTo(0.0125);
});
