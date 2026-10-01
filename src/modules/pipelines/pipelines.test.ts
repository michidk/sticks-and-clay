import { expect, test } from "bun:test";
import { modelReviewPipeline, runPipeline } from "./index";
import { executionPolicy, roles } from "../ai/roles";

test("role registry selects one-shot or resumable execution, including legacy designer", () => {
  for (const role of [
    "project-name",
    "project-brief",
    "model-brief",
    "designer",
  ] as const)
    expect(executionPolicy(role)).toEqual({
      engine: "tanstack",
      resumable: false,
    });
  for (const role of ["builder", "photographer", "judge", "planner"] as const)
    expect(executionPolicy(role)).toEqual({ engine: "eve", resumable: true });
  expect(executionPolicy("designer", true).engine).toBe("eve");
  expect(roles.judge.schema.safeParse({ passed: true }).success).toBe(false);
});

test("review composition: zero, early pass, exhaustion, feedback ordering", async () => {
  for (const [rounds, passAt, expected] of [
    [0, -1, ["builder:0"]],
    [3, 0, ["builder:0", "judge:0"]],
    [2, -1, ["builder:0", "judge:0", "builder:1", "judge:1"]],
  ] as const) {
    const seen: string[] = [];
    let feedback = -1;
    await runPipeline(modelReviewPipeline(rounds), {
      builder: async (node) => {
        expect(feedback).toBe(node.iteration - 1);
        seen.push(node.id);
      },
      judge: async (node) => {
        feedback = node.iteration;
        seen.push(node.id);
        return { passed: node.iteration === passAt };
      },
    });
    expect(seen).toEqual([...expected]);
  }
});

test("invalid graphs and cancellation cannot start downstream work", async () => {
  let calls = 0;
  const handlers = {
    builder: async () => {
      calls++;
    },
    judge: async () => {},
  };
  await expect(
    runPipeline(
      {
        id: "bad",
        version: 1,
        nodes: [{ id: "a", task: "builder", iteration: 0, next: "a" }],
      },
      handlers,
    ),
  ).rejects.toThrow("cycle");
  expect(calls).toBe(0);
  await expect(
    runPipeline(modelReviewPipeline(2), handlers, async () => {
      throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(calls).toBe(0);
  expect(() => modelReviewPipeline(-1)).toThrow();
});

test("quality pipeline gates surface work, permits early geometry pass, and retains zero-review semantics", async () => {
  const { qualityPipeline } = await import("./index");
  for (const [rounds, geometryPass, expected] of [
    [0, false, ["builder:0"]],
    [2, false, ["builder:0", "judge:0", "builder:1", "judge:1"]],
    [2, true, ["builder:0", "judge:0", "builder:2", "judge:2"]],
  ] as const) {
    const seen: string[] = [];
    await runPipeline(qualityPipeline(rounds), {
      builder: async (node) => {
        seen.push(node.id);
      },
      judge: async (node) => {
        seen.push(node.id);
        return { passed: node.stage === "surface" || geometryPass };
      },
    });
    expect(seen).toEqual([...expected]);
  }
});

test("photography precedes every judge and completes unreviewed builds; failures stop downstream work", async () => {
  const { photographyPipeline } = await import("./index");
  for (const rounds of [0, 2]) {
    const seen: string[] = [];
    await runPipeline(photographyPipeline(rounds), {
      builder: async (n) => {
        seen.push(n.id);
      },
      photographer: async (n) => {
        seen.push(n.id);
      },
      judge: async (n) => {
        seen.push(n.id);
        return { passed: true };
      },
    });
    expect(seen).toEqual(
      rounds === 0
        ? ["builder:0", "photographer:0"]
        : [
            "builder:0",
            "photographer:0",
            "judge:0",
            "builder:2",
            "photographer:2",
            "judge:2",
          ],
    );
  }
  const seen: string[] = [];
  await expect(
    runPipeline(photographyPipeline(2), {
      builder: async (n) => {
        seen.push(n.id);
      },
      photographer: async () => {
        throw new Error("render failed");
      },
      judge: async (n) => {
        seen.push(n.id);
      },
    }),
  ).rejects.toThrow("render failed");
  expect(seen).toEqual(["builder:0"]);
});

test("v4 cannot approve before separate refinement and polish; zero rounds still develops the asset", async () => {
  const { refinementPipeline } = await import("./index");
  for (const rounds of [0, 1, 3]) {
    const seen: string[] = [];
    const builds: string[] = [];
    await runPipeline(refinementPipeline(rounds), {
      builder: async (n) => { seen.push(n.id); builds.push(n.workPass!); },
      photographer: async (n) => { seen.push(n.id); },
      judge: async (n) => {
        expect(seen.at(-1)).toBe(`photographer:${n.iteration}`);
        expect(["refinement", "polish"]).toContain(n.workPass!);
        seen.push(n.id);
        return { passed: true };
      },
    });
    expect(builds).toEqual(["blockout", "refinement", "materials", "polish"]);
    expect(seen.filter((id) => id.startsWith("judge:"))).toHaveLength(rounds ? 2 : 0);
    expect(seen.filter((id) => id.startsWith("photographer:"))).toHaveLength(4);
  }
});

test("v4 bounds revisions and blocks materials when geometry reviews are exhausted", async () => {
  const { refinementPipeline } = await import("./index");
  for (const geometryPass of [false, true]) {
    const builds: string[] = [], judges: string[] = [];
    await runPipeline(refinementPipeline(2), {
      builder: async (n) => { builds.push(n.workPass!); },
      photographer: async () => {},
      judge: async (n) => {
        judges.push(n.stage!);
        return { passed: n.stage === "geometry" && geometryPass };
      },
    });
    expect(builds).toEqual(geometryPass
      ? ["blockout", "refinement", "materials", "polish", "polish"]
      : ["blockout", "refinement", "refinement"]);
    expect(judges).toEqual(geometryPass ? ["geometry", "surface", "surface"] : ["geometry", "geometry"]);
  }
});

test("v4 replay uses stable step identities and failed photography prevents refinement", async () => {
  const { refinementPipeline } = await import("./index");
  const completed = new Set<string>();
  let fail = true;
  const executed: string[] = [];
  const build = async (n: { id: string }) => {
    if (!completed.has(n.id)) { executed.push(n.id); completed.add(n.id); }
  };
  const handlers = {
    builder: build,
    photographer: async (n: { id: string }) => {
      if (fail) throw new Error("photo interrupted");
      await build(n);
    },
    judge: async () => ({ passed: true }),
  };
  await expect(runPipeline(refinementPipeline(1), handlers)).rejects.toThrow("photo interrupted");
  expect(executed).toEqual(["builder:0"]);
  fail = false;
  await runPipeline(refinementPipeline(1), handlers);
  expect(executed).toEqual(["builder:0", "photographer:0", "builder:1", "photographer:1",
    "builder:2", "photographer:2", "builder:3", "photographer:3"]);
});
