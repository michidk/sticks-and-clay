import { agent } from "./internal/eve.server";
import { draftBrief } from "./internal/tanstack.server";
import { jobContext } from "../../lib/checkpoint.server";
import { prompt } from "../../lib/prompts.server";
import { readFile } from "node:fs/promises";
import {
  executionPolicy,
  roles,
  imageRoles,
  immediateRoles,
  type Role,
  type RoleResult,
  type RunInput,
} from "./roles";
import { imageRoleProfile, textRoleProfile } from "./config.server";
export { roles, executionPolicy, immediateRoles } from "./roles";
export type { Role, RoleResult, RunInput } from "./roles";

export function roleInput(role: Role, values: Record<string, string | number>) {
  return prompt(roles[role].inputTemplate, values);
}

/** Both engines log runs. Only Eve has a resumable session. Never creates queue jobs. */
export async function runRole<R extends Role>(
  args: RunInput<R>,
): Promise<{ result: RoleResult<R>; runId: string }> {
  if (!jobContext.getStore() && !immediateRoles.includes(args.role))
    throw new Error("AI execution requires a queue job except for name and brief drafts");
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
    ...(await Promise.all(Object.keys(roles).map(async (id) => {
      const { schema, settings: _runtime, ...profile } = await textRoleProfile(id as Role);
      return { id, ...profile, resumable: profile.engine === "eve" };
    }))),
    ...(await Promise.all(Object.keys(imageRoles).map(async (id) => {
      const { settings: _runtime, ...profile } = await imageRoleProfile(id as keyof typeof imageRoles);
      return { id, ...profile, effort: profile.quality, resumable: false };
    }))),
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
