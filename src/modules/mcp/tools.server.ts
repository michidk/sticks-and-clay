import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  agentInput, assetBriefInput, branchInput, designInput, designUpdateInput,
  visualTargetDecisionInput, generationInput, materialAssignmentInput, materialInput, presentationInput,
} from "../../lib/api-inputs";
import { runtimeSettingsPatchSchema, runtimeSettingsSchema } from "../../lib/contracts";
import { workshopSchema } from "../../lib/workshop";
import { type McpScope } from "./catalog";
import { callApi, paginate, pageInput, toolOutput, workflow, result, type ApiRequest, type AppApi, type ToolData, type JsonValue } from "./api.server";
import { assetForm, assetUploadSchema, projectForm, projectSetupInput } from "./uploads";
import { registerArtifacts } from "./artifacts.server";
import type { OAuthStore } from "./auth/oauth-store.server";
import type { readStoredFile } from "../../lib/storage.server";

const uuid = z.string().uuid();
const projectId = z.object({ projectId: uuid });
const modelId = z.object({ modelId: uuid });
const jobId = z.object({ jobId: uuid });
const empty = z.object({});
const read: McpScope = "sticks-and-clay:read";
const write: McpScope = "sticks-and-clay:write";
const admin: McpScope = "sticks-and-clay:admin";
const projectSections = ["overview", "models", "ideas", "versions", "runs", "revisions", "batches", "photographs", "designUpdates"] as const;

export function createStudioMcpServer(options: {
  scopes: readonly string[];
  api?: AppApi;
  publicUrl: URL;
  store?: Pick<OAuthStore, "listClients" | "revokeClient">;
  readFile?: typeof readStoredFile;
}) {
  const scopes = new Set(options.scopes);
  const server = new McpServer({ name: "sticks-and-clay", version: "1.0.0" }, { instructions: workflow });

  function register<S extends z.ZodObject>(
    name: string, description: string, scope: McpScope, input: S,
    request: (args: z.output<S>) => ApiRequest | Promise<ApiRequest>,
    hints: {
      paid?: boolean; destructive?: boolean; readOnly?: boolean;
      map?: (data: JsonValue, args: z.output<S>) => ToolData;
    } = {},
  ) {
    if (!scopes.has(scope)) return;
    const readOnly = hints.readOnly ?? scope === read;
    server.registerTool(name, {
      description,
      inputSchema: input.strict(),
      outputSchema: toolOutput,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: hints.destructive ?? false,
        idempotentHint: readOnly,
        openWorldHint: hints.paid ?? false,
      },
    }, async (args) => {
      try {
        const inputArgs = input.parse(args);
        const response = await callApi(await request(inputArgs), options.api);
        return result(response.ok && hints.map ? hints.map(response.data, inputArgs) : { data: response.data }, !response.ok);
      } catch {
        return result({ data: { error: "The operation could not be completed. Check diagnostics before retrying paid work." } }, true);
      }
    });
  }

  register("list_projects", "List projects with progress, thumbnails and cost estimates. Follow nextOffset for the next page.", read, pageInput,
    () => ({ path: "projects" }), { map: (data, args) => paginate(data, args, "projects") });
  register("get_project", "Read a project and one page of a selected history section. Overview returns project state and record counts; use sections to read all saved history.", read,
    projectId.extend({ ...pageInput.shape, section: z.enum(projectSections).default("overview") }),
    ({ projectId }) => ({ path: `projects/${projectId}` }), {
      map(data, args) {
        const record = z.record(z.string(), z.json()).parse(data);
        if (args.section === "overview") return {
          data: { project: record.project, counts: Object.fromEntries(Object.entries(record).flatMap(([key, value]) => Array.isArray(value) ? [[key, value.length]] : [])) },
        };
        return paginate(record[args.section], args);
      },
    });
  register("draft_project_name", "Generate a name from a brief using paid AI. Returns a recoverable draft ID. Pass draftId to continue that draft.", write,
    z.object({ description: z.string().trim().min(1).max(12000), assetType: projectSetupInput.shape.assetType, draftId: projectSetupInput.shape.draftId }),
    async (input) => ({ path: "projects/name", method: "POST", body: await projectForm({ ...input, name: "Untitled project", images: [] }) }), { paid: true });
  register("draft_project_brief", "Draft or improve a project brief using paid AI and optional images. Returns draft ID and retained reference keys. Explicit references=[] removes old draft references.", write,
    projectSetupInput, async (input) => ({ path: "projects/brief", method: "POST", body: await projectForm(input) }), { paid: true });
  register("create_project", "Create a 3D, graphic or SVG project and queue paid design generation. Optional draftId finishes a saved draft. Poll get_project with returned id instead of repeating this tool.", write,
    projectSetupInput, async (input) => ({ path: "projects", method: "POST", body: await projectForm(input) }), { paid: true });
  register("draft_asset_brief", "Suggest the next assets using the approved design and existing assets. Uses paid AI. The project must be ready.", write,
    assetBriefInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/model-brief`, method: "POST", body: input }), { paid: true });
  register("save_design", "Save a new design revision using the current version from get_project. approve=true approves it for generation. To restore history, save the selected old revision with the current version.", write,
    designInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/design`, method: "PUT", body: input }));
  register("update_workshop", "Save collection memory, style, variation and completed examples using its current workshop version. Future batches snapshot this guidance.", write,
    workshopSchema.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/workshop`, method: "PUT", body: input }));
  register("generate_assets", "Queue a batch from the approved design. Returns batch id, not a completed asset. Paid AI. Graphics require judgeIterations=0; 3D supports spriteTarget and uses square imageSize. Visual targets require user approval unless visualTargetMode is skip.", write,
    generationInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/generate`, method: "POST", body: input }), { paid: true });
  const ideaId = projectId.extend({ ideaId: uuid });
  register("save_idea", "Save generation settings as an idea for later, like Save idea in the UI. No AI charge; the design need not be approved yet. Returns the idea id; list ideas with get_project section ideas.", write,
    generationInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/ideas`, method: "POST", body: input }));
  register("update_idea", "Replace the settings of an unstarted idea. No AI charge.", write,
    generationInput.extend(ideaId.shape), (input) => ({ path: `projects/${input.projectId}/ideas/${input.ideaId}`, method: "PUT", body: input }));
  register("discard_idea", "Discard an unstarted idea. Started ideas remain as their batch.", write,
    ideaId, ({ projectId, ideaId }) => ({ path: `projects/${projectId}/ideas/${ideaId}`, method: "DELETE" }), { destructive: true });
  register("start_idea", "Queue paid generation from a saved idea using the approved design. Returns the batch id; repeating it returns the same batch.", write,
    ideaId, ({ projectId, ideaId }) => ({ path: `projects/${projectId}/ideas/${ideaId}/generate`, method: "POST" }), { paid: true });
  register("retry_project_design", "Continue a failed project setup using its checkpoints. Only failed setup is eligible; paid work may continue.", write,
    projectId, ({ projectId }) => ({ path: `projects/${projectId}/retry-design`, method: "POST" }), { paid: true });
  register("photograph_project", "Queue a collection cover using photographer AI and Blender. Reuses active or failed photograph work and returns the job id.", write,
    projectId, ({ projectId }) => ({ path: `projects/${projectId}/photograph`, method: "POST" }), { paid: true });
  register("import_asset", "Import GLB or Blender bytes up to 200 MiB into an approved 3D project as an editable baseline. Queues paid generation. Server filesystem paths are not accepted.", write,
    projectId.extend({ name: z.string().trim().min(1).max(100), prompt: z.string().trim().min(3).max(12000), file: assetUploadSchema }),
    async (input) => ({ path: `projects/${input.projectId}/import`, method: "POST", body: await assetForm(input) }), { paid: true });
  register("list_materials", "Read saved material jobs and their maps, source bundles and review outcomes. The app retains the latest 40 in this view.", read,
    projectId.extend(pageInput.shape), ({ projectId }) => ({ path: `projects/${projectId}/materials` }), { map: paginate });
  register("generate_material", "Create a material version. An empty prompt uses local procedural rendering; a prompt enables paid AI review. parentId and examples must be completed materials from this project.", write,
    materialInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/materials`, method: "POST", body: input }), { paid: true });
  register("branch_asset", "Iterate or fork a saved model/graphic sourceRunId. Describe selected repairs in prompt. Set useCurrentStyle to revise with collection style. Fork requires name; graphics require zero judge rounds. Paid AI; source history remains intact.", write,
    branchInput.extend(modelId.shape), (input) => ({ path: `models/${input.modelId}/branch`, method: "POST", body: input }), { paid: true });
  register("update_design_from_asset", "Queue a draft design from a saved 3D render index. Paid AI. Choose replaceReference when the project already has six references. Approval is still required before generation.", write,
    designUpdateInput.extend(modelId.shape), (input) => ({ path: `models/${input.modelId}/design-update`, method: "POST", body: input }), { paid: true });
  register("approve_visual_target", "Approve the exact current visual target after the user reviews it, then queue the paid 3D build.", write,
    visualTargetDecisionInput.options[0].omit({ action: true }).extend(modelId.shape),
    ({ modelId, target }) => ({ path: `models/${modelId}/visual-target`, method: "POST", body: { action: "approve", target } }), { paid: true });
  register("revise_visual_target", "Request a paid revision of the current visual target. The new image awaits user approval before building.", write,
    visualTargetDecisionInput.options[1].omit({ action: true }).extend(modelId.shape),
    ({ modelId, target, prompt }) => ({ path: `models/${modelId}/visual-target`, method: "POST", body: { action: "revise", target, prompt } }), { paid: true });
  register("retry_asset", "Continue a failed asset with its original checkpoints and Eve session. Paid work may continue; existing attempts remain in history.", write,
    modelId, ({ modelId }) => ({ path: `models/${modelId}/retry`, method: "POST" }), { paid: true });
  register("list_animation_clips", "Read named animations from a saved GLB before selecting a sprite clip.", read,
    modelId.extend({ sourceRunId: uuid }), ({ modelId, sourceRunId }) => ({ path: `models/${modelId}/sprite-clips?sourceRunId=${sourceRunId}` }));
  register("render_asset", "Render saved GLB views or a transparent sprite sheet in local Blender. No AI charge. Returns a presentation job id; poll get_export_job. Supplying spriteOptions={} uses current pixel defaults.", write,
    presentationInput.extend(modelId.shape), (input) => ({ path: `models/${input.modelId}/presentation`, method: "POST", body: input }));
  register("list_asset_exports", "Read recent presentation/sprite exports for a model. Material assignment jobs are retrieved by their returned job id.", read,
    modelId.extend(pageInput.shape), ({ modelId }) => ({ path: `models/${modelId}/workshop-jobs` }), { map: paginate });
  register("get_export_job", "Poll a presentation, material or material-assignment job. Files become available when done. This does not retry the job.", read,
    jobId, ({ jobId }) => ({ path: `workshop-jobs/${jobId}` }));
  register("assign_material", "Apply a completed project material to an existing named model slot with UVs, creating an exported variant. Local Blender, no AI charge; returns a job id.", write,
    materialAssignmentInput.extend(modelId.shape), (input) => ({ path: `models/${input.modelId}/material-assignment`, method: "POST", body: input }));
  register("get_queue", "Read worker control and a page of visible generation/export jobs. Use get_project for design setup and design-update jobs.", read,
    pageInput, () => ({ path: "queue" }), { map: (data, args) => paginate(data, args, "jobs") });
  register("cancel_job", "Request cancellation of a queued or running job. Running jobs may return cancelling until stopped. Prior history and already incurred provider costs remain.", write,
    jobId, ({ jobId }) => ({ path: `queue/${jobId}/cancel`, method: "POST" }), { destructive: true });
  register("cancel_pending_jobs", "Cancel all queued generation, planning, collection, photography, presentation and material jobs. This affects the whole workshop.", write,
    empty, () => ({ path: "queue/cancel-pending", method: "POST" }), { destructive: true });
  register("resume_export_job", "Resume a failed photograph, presentation or material job using the same checkpoint. Paid work may continue; other job kinds use asset/project/batch recovery tools.", write,
    jobId, ({ jobId }) => ({ path: `queue/${jobId}/resume`, method: "POST" }), { paid: true });
  register("resume_batch", "Resume failed planning or collection rendering for a batch using its existing checkpoint. Paid work may continue.", write,
    z.object({ batchId: uuid }), ({ batchId }) => ({ path: `batches/${batchId}/resume`, method: "POST" }), { paid: true });
  register("get_run_events", "Read a page of an agent run's events, including tool calls and responses. Run prompts, outputs and costs are in get_project's runs section.", read,
    pageInput.extend({ runId: uuid }), ({ runId }) => ({ path: `runs/${runId}` }), { map: paginate });
  register("get_agents", "Read authored agent roles, prompts and effective model settings.", admin, empty,
    () => ({ path: "agents" }), { readOnly: true });
  register("update_agent", "Change a registered role's model and effort for future runs. Existing run snapshots and sessions remain intact.", admin, agentInput,
    (input) => ({ path: "agents", method: "PATCH", body: input }));
  register("get_settings", "Read current timeouts, queue state, model overrides and generation defaults.", admin, empty,
    () => ({ path: "settings" }), { readOnly: true });
  register("update_settings", "Patch runtime settings, pause/resume future queue claims, or change concurrency. Null model overrides restore role defaults. Changes apply to new work.", admin, runtimeSettingsPatchSchema,
    (input) => ({ path: "settings", method: "PATCH", body: input }));
  register("replace_settings", "Replace the complete runtime configuration. Include every field from get_settings; omitted overrides are removed.", admin, runtimeSettingsSchema,
    (input) => ({ path: "settings", method: "PUT", body: input }), { destructive: true });
  register("get_diagnostics", "Probe database, worker, Eve, Blender and storage health. Responses omit endpoints, credentials and internal paths.", admin, empty,
    () => ({ path: "diagnostics" }), { readOnly: true });

  registerArtifacts(server, options);
  if (scopes.has(read)) {
    server.registerResource("workflow", "sticks-and-clay://workflow", { mimeType: "text/plain", description: "Project, generation, review and recovery workflow." },
      () => ({ contents: [{ uri: "sticks-and-clay://workflow", text: workflow, mimeType: "text/plain" }] }));
    server.registerPrompt("create_collection", {
      description: "Guide an agent through references, design approval, generation and review.",
      argsSchema: z.object({ goal: z.string().min(1).max(12000) }),
    }, ({ goal }) => ({ messages: [{ role: "user", content: { type: "text", text: `${workflow}\n\nThe user's goal:\n${goal}` } }] }));
  }
  if (scopes.has(admin) && options.store) {
    const store = options.store;
    server.registerTool("list_mcp_clients", { description: "List registered OAuth clients and revocation state. Never returns secrets.", inputSchema: empty, outputSchema: toolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      async () => result({ data: z.json().parse(JSON.parse(JSON.stringify(await store.listClients()))) }));
    server.registerTool("revoke_mcp_client", { description: "Revoke a connected client's tokens immediately. Revoking your own client ends future access.", inputSchema: z.object({ clientId: z.string().min(1).max(200) }).strict(), outputSchema: toolOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
      async ({ clientId }) => { await store.revokeClient(clientId); return result({ data: { ok: true } }); });
  }
  return server;
}
