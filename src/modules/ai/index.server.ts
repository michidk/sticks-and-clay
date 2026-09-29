import { agent } from "./internal/eve.server";
import { draftBrief } from "./internal/tanstack.server";
import { jobContext } from "../../lib/checkpoint.server";
import { prompt } from "../../lib/prompts.server";
import {
  executionPolicy,
  roles,
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

export function agentSettings() {
  return Object.entries(roles).map(([id, { schema, ...settings }]) => ({
    id,
    ...settings,
    resumable: settings.engine === "eve",
  }));
}
