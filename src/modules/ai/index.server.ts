import { agent } from "./internal/eve.server";
import { draftBrief } from "./internal/tanstack.server";
import { jobContext } from "../../lib/checkpoint.server";
import { prompt } from "../../lib/prompts.server";
import { readFile } from "node:fs/promises";
import {
  executionPolicy,
  roles,
  imageRoles,
  type Role,
  type RoleResult,
  type RunInput,
} from "./roles";
export { roles, executionPolicy } from "./roles";
export type { Role, RoleResult, RunInput } from "./roles";

export function roleInput(role: Role, values: Record<string, string | number>) {
  return prompt(roles[role].inputTemplate, values);
}

/** Both engines log runs. Only Eve has a resumable session. Never creates queue jobs. */
export async function runRole<R extends Role>(
  args: RunInput<R>,
): Promise<{ result: RoleResult<R>; runId: string }> {
  const legacyDesigner = Boolean(
    jobContext.getStore()?.checkpoint["agent:designer:0"],
  );
  const policy = executionPolicy(args.role, legacyDesigner);
  if (policy.engine === "eve") {
    if (!jobContext.getStore())
      throw new Error("Eve execution requires a durable job context");
    return agent<RoleResult<R>>({ ...args, schema: roles[args.role].schema });
  }
  const { runId, ...result } = await draftBrief(args);
  return {
    result: roles[args.role].schema.parse(result) as RoleResult<R>,
    runId,
  };
}

async function promptFiles(
  instructions: string,
  inputTemplate: string,
  references: readonly string[] = [],
) {
  const files = [
    { kind: "Instructions", name: instructions },
    ...references.map((name) => ({ kind: "Reference", name })),
    { kind: "Input template", name: inputTemplate },
  ].filter(
    (file, index, all) =>
      all.findIndex((candidate) => candidate.name === file.name) === index,
  );
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      path: `prompts/${file.name}.md`,
      content: await readFile(`prompts/${file.name}.md`, "utf8"),
    })),
  );
}

export async function agentSettings() {
  const settings = [
    ...Object.entries(roles).map(([id, { schema, ...settings }]) => ({
      id,
      ...settings,
      resumable: settings.engine === "eve",
    })),
    ...Object.entries(imageRoles).map(([id, settings]) => ({
      id,
      ...settings,
      effort: settings.quality,
      resumable: false,
    })),
  ];
  return Promise.all(
    settings.map(async (agent) => ({
      ...agent,
      promptFiles: await promptFiles(
        agent.prompt,
        agent.inputTemplate,
        "references" in agent ? agent.references : [],
      ),
    })),
  );
}

/** Logged one-shot image requests share the imagegen adapter and usage accounting. */
export { imageRequest as runImageRole } from "./internal/image.server";
