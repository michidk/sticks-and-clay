import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  acceptInput, agentInput, assetBriefInput, branchInput, exportInput, ideaInput, ideaUpdateInput, readyInput, designInput, designUpdateInput,
  visualTargetDecisionInput, generationInput, materialAssignmentInput, materialInput, presentationInput,
} from "../../lib/api-inputs";
import { runtimeSettingsPatchSchema, runtimeSettingsSchema } from "../../lib/contracts";
import { workshopSchema } from "../../lib/workshop";
import { boardColumns } from "../../lib/board";
import { type McpScope } from "./catalog";
import { callApi, paginate, pageInput, toolOutput, workflow, result, type ApiRequest, type AppApi, type ToolData, type JsonValue } from "./api.server";
import { assetForm, assetUploadSchema, projectForm, projectSetupInput } from "./uploads";
import { registerArtifacts } from "./artifacts.server";
import type { OAuthStore } from "./auth/oauth-store.server";
import type { readStoredFile } from "../../lib/storage.server";

const uuid = z.string().uuid();
const projectId = z.object({ projectId: uuid });
const versionId = z.object({ versionId: uuid });
const jobId = z.object({ jobId: uuid });
const empty = z.object({});
const read: McpScope = "sticks-and-clay:read";
const write: McpScope = "sticks-and-clay:write";
const admin: McpScope = "sticks-and-clay:admin";
const projectSections = ["overview", "assets", "assetVersions", "ideas", "builds", "runs", "revisions", "batches", "photographs", "designUpdates", "board"] as const;

export function createStudioMcpServer(options: {
  scopes: readonly string[];
  api?: AppApi;
  publicUrl: URL;
  store?: Pick<OAuthStore, "listClients" | "revokeClient">;
  readFile?: typeof readStoredFile;
  /** Owner-disabled tools stay registered but are hidden from discovery and calls. */
  disabledTools?: ReadonlySet<string>;
}) {
  const scopes = new Set(options.scopes);
  const server = new McpServer({ name: "sticks-and-clay", version: "1.0.0" }, { instructions: workflow });
  const disabled = options.disabledTools;
  if (disabled?.size) {
    const registerTool = server.registerTool.bind(server) as (name: string, ...rest: unknown[]) => { disable(): void };
    server.registerTool = ((name: string, ...rest: unknown[]) => {
      const tool = registerTool(name, ...rest);
      if (disabled.has(name)) tool.disable();
      return tool;
    }) as typeof server.registerTool;
  }

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

  const createAssetsInput = projectId.extend({
    assets: z.array(ideaInput.omit({ count: true })).min(1).max(20),
  });
  if (scopes.has(write)) {
    server.registerTool("create_assets", {
      description: "Create several separate asset ideas in one request. Each array item becomes its own Asset with its own title and brief; use this for a collection, never to bundle unrelated models into one idea. Named parts are only for an inseparable assembly or intentionally grouped image set.",
      inputSchema: createAssetsInput.strict(),
      outputSchema: toolOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => {
      try {
        const input = createAssetsInput.parse(args);
        const created: JsonValue[] = [];
        for (const asset of input.assets) {
          const response = await callApi({ path: `projects/${input.projectId}/assets`, method: "POST", body: { ...asset, count: 1 } }, options.api);
          if (!response.ok) return result({ data: { created, error: response.data } }, true);
          created.push(response.data);
        }
        return result({ data: { assets: created } });
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
        const original = z.record(z.string(), z.json()).parse(data);
        const record = Object.fromEntries(Object.entries(original).map(([key, value]) => [key === "models" ? "assetVersions" : key === "versions" ? "builds" : key, value]));
        if (args.section === "overview") return {
          data: { project: record.project, counts: Object.fromEntries(Object.entries(record).flatMap(([key, value]) => Array.isArray(value) ? [[key, value.length]] : [])) },
        };
        if (args.section === "board") {
          const draftSchema = z.object({ id: z.string(), title: z.string().nullable().optional(), readyAt: z.string().nullable().optional(), input: z.json().optional() });
          const versionSchema = z.object({ id: z.string(), assetId: z.string().optional(), batchId: z.string().default(""), status: z.string().default("queued"), name: z.string().optional(), verdict: z.string().nullable().optional(), acceptedAt: z.string().nullable().optional(), parentModelId: z.string().nullable().optional(), branchKind: z.enum(["iterate", "fork"]).nullable().optional(), createdAt: z.string().optional() });
          const batchSchema = z.object({ id: z.string(), status: z.string(), count: z.number(), error: z.string().nullable().optional() });
          const assets = z.array(z.object({ id: z.string(), inIdea: z.boolean().optional() })).parse(record.assets ?? []);
          const draftIds = new Set(assets.filter((asset) => asset.inIdea).map((asset) => asset.id));
          const savedVersions = z.array(versionSchema).parse(record.assetVersions ?? []);
          const versions = savedVersions.filter((version) => !version.assetId || !draftIds.has(version.assetId));
          const batches = z.array(batchSchema).parse(record.batches ?? []).map((batch) => ({ ...batch, count: batch.count - savedVersions.filter((version) => version.batchId === batch.id && version.assetId && draftIds.has(version.assetId)).length }));
          const columns = boardColumns(z.array(draftSchema).parse(record.ideas ?? []), versions, batches);
          const board = Object.fromEntries(Object.entries(columns).map(([stage, cards]) => [stage, cards.map((card) =>
            card.kind === "idea" ? { kind: "idea", assetId: card.idea.id, title: card.idea.title, readyAt: card.idea.readyAt, input: card.idea.input }
            : card.kind === "pending" ? { kind: "pending", batchId: card.batch.id, status: card.batch.status, owed: card.owed, error: card.batch.error }
            : { kind: "asset", assetId: card.asset.assetId, versionId: card.asset.id, name: card.asset.name, status: card.asset.status, verdict: card.asset.verdict,
              acceptedAt: card.asset.acceptedAt, versions: card.attempts })]));
          // Round-trip drops undefined fields so the board stays valid JSON.
          return { data: z.json().parse(JSON.parse(JSON.stringify(board))) };
        }
        return paginate(record[args.section], args);
      },
    });
  register("get_board", "Read the global asset board with project labels, optionally filtered to one project. Each asset keeps the same identity across its versions.", read,
    z.object({ projectId: uuid.optional() }), ({ projectId }) => ({ path: projectId ? `board?projectId=${projectId}` : "board" }));
  register("draft_project_name", "Generate a name from a brief using paid AI. Returns a recoverable draft ID. Pass draftId to continue that draft.", write,
    z.object({ description: z.string().trim().min(1).max(12000), assetType: projectSetupInput.shape.assetType, draftId: projectSetupInput.shape.draftId }),
    async (input) => ({ path: "projects/name", method: "POST", body: await projectForm({ ...input, name: "Untitled project", images: [] }) }), { paid: true });
  register("draft_project_brief", "Draft or improve a project brief using paid AI and optional images. Returns draft ID and retained reference keys. Explicit references=[] removes old draft references.", write,
    projectSetupInput, async (input) => ({ path: "projects/brief", method: "POST", body: await projectForm(input) }), { paid: true });
  register("create_project", "Create a 3D, graphic, SVG or pixel-art project and queue paid design generation. Optional draftId finishes a saved draft. Poll get_project with returned id instead of repeating this tool.", write,
    projectSetupInput, async (input) => ({ path: "projects", method: "POST", body: await projectForm(input) }), { paid: true });
  register("draft_asset_brief", "Suggest a numbered list of distinct, one-deliverable asset ideas using the approved design and existing assets. Each item should have its own title and self-contained brief; do not combine unrelated models as named parts. Uses paid AI. The project must be ready.", write,
    assetBriefInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/model-brief`, method: "POST", body: input }), { paid: true });
  register("save_design", "Save a new design revision using the current version from get_project. approve=true approves it for generation. To restore history, save the selected old revision with the current version.", write,
    designInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/design`, method: "PUT", body: input }));
  register("update_workshop", "Save optional pixel-art or graphic resolution, the SVG intent (icon, logo or illustration), collection variation and 3D self-review effort using the current workshop version. Future batches snapshot them together with the notes on the project's reference images.", write,
    workshopSchema.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/workshop`, method: "PUT", body: input }));
  register("generate_asset", "Queue exactly one standalone deliverable from the approved design. Do not put multiple unrelated models in one prompt; create separate Assets for them. Returns an execution batch ID; poll the project instead of repeating it. Paid AI. judgeIterations controls review rounds. Visual targets require user approval unless visualTargetMode is skip.", write,
    generationInput.omit({ count: true }).extend({ ...projectId.shape, prompt: z.string().trim().min(1).max(12000) }),
    (input) => ({ path: `projects/${input.projectId}/generate`, method: "POST", body: { ...input, count: 1 } }), { paid: true });
  const assetId = projectId.extend({ assetId: uuid });
  register("list_starting_points", "List compatible completed versions in this project that can seed an idea. Does not start generation.", read,
    projectId, ({ projectId }) => ({ path: `projects/${projectId}/starting-points` }));
  register("set_asset_starting_point", "Attach an immutable starting point to an idea using uploaded bytes or a completed same-project sourceRunId. Omit both to remove it. Pass expectedSha256 from the current source, or empty when absent. CAD Python executes only when generation starts. No server paths or arbitrary execution.", write,
    assetId.extend({ file: assetUploadSchema.optional(), sourceRunId: uuid.optional(), expectedSha256: z.string().max(64).default(""), units: z.enum(["mm", "cm", "m", "in"]).default("mm") })
      .refine((input) => !(input.file && input.sourceRunId), "Choose a file or a saved version"), (input) => {
      const form = new FormData(); form.set("expected", input.expectedSha256); form.set("units", input.units);
      if (input.sourceRunId) form.set("sourceRunId", input.sourceRunId);
      if (input.file) form.set("file", new File([new Uint8Array(Buffer.from(input.file.base64, "base64"))], input.file.filename));
      return { path: `projects/${input.projectId}/assets/${input.assetId}/starting-point`, method: "POST", body: form };
    });
  register("create_asset", "Create one standalone asset idea in Ideas with an optional self-contained brief (empty follows the approved design), optional named parts and generation settings. For multiple unrelated deliverables, call this once per deliverable. Use named parts only for an inseparable assembly or intentionally grouped image set. Omit title for a small paid AI title request. The same asset keeps its identity through Ready, In progress, Review and Done.", write,
    ideaInput.extend(projectId.shape), (input) => ({ path: `projects/${input.projectId}/assets`, method: "POST", body: input }));
  register("update_asset", "Replace an asset's brief, title, parts and settings for future versions in any stage. An empty title uses a small paid AI request. Saved versions stay unchanged.", write,
    ideaUpdateInput.extend(assetId.shape), (input) => ({ path: `projects/${input.projectId}/assets/${input.assetId}`, method: "PUT", body: input }));
  register("discard_asset", "Discard an asset that has no saved versions. Generated history cannot be deleted through MCP.", write,
    assetId, ({ projectId, assetId }) => ({ path: `projects/${projectId}/assets/${assetId}`, method: "DELETE" }), { destructive: true });
  register("mark_asset_ready", "Mark a draft asset Ready or move it back to Ideas. This does not start paid generation.", write,
    readyInput.extend(assetId.shape), ({ projectId, assetId, ready }) => ({ path: `projects/${projectId}/assets/${assetId}/ready`, method: "POST", body: { ready } }));
  register("start_asset", "Queue a version of a draft asset using immutable design and reference snapshots. Requires the user's approved project design. Paid AI; repeating an already-started draft returns its existing execution ID.", write,
    assetId, ({ projectId, assetId }) => ({ path: `projects/${projectId}/assets/${assetId}/generate`, method: "POST" }), { paid: true });
  register("update_asset_references", "Replace an asset's references and notes for future versions. Supply its current references and notes in expected to prevent overwriting another edit. Retain only its existing reference keys; attach project mockups with attach_asset_mockup. Images accept public URLs or image bytes.", write,
    assetId.extend({
      references: projectSetupInput.shape.references.unwrap(), images: projectSetupInput.shape.images,
      referenceNotes: z.record(z.string(), z.string().max(1000)),
      expected: z.object({ references: z.array(z.string()), referenceNotes: z.record(z.string(), z.string()) }),
    }), async (input) => {
      const form = await projectForm({ name: "Asset references", description: "", assetType: "model", references: input.references, images: input.images });
      form.set("referenceNotes", JSON.stringify(input.referenceNotes));
      form.set("expected", JSON.stringify(input.expected));
      return { path: `projects/${input.projectId}/assets/${input.assetId}/references`, method: "POST", body: form };
    });
  register("attach_asset_mockup", "Attach a project mockup as an asset reference, with an optional note. It affects future versions and preserves saved snapshots.", write,
    assetId.extend({ mockupId: uuid, note: z.string().max(1000).default("") }),
    ({ projectId, assetId, mockupId, note }) => ({ path: `projects/${projectId}/assets/${assetId}/mockups/${mockupId}`, method: "POST", body: { note } }));
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
  register("branch_asset_version", "Iterate or fork a saved model/graphic sourceRunId. Describe selected repairs in prompt. Set variation=true to create a new 3D asset that copies the model prompt and uses its first saved render as a reference image; prompt is then optional variation context. Set useCurrentStyle to revise with the project's current reference-image notes. Fork requires name unless variation=true. Paid AI; source version history remains intact.", write,
    branchInput.extend(versionId.shape), (input) => ({ path: `asset-versions/${input.versionId}/branch`, method: "POST", body: input }), { paid: true });
  register("accept_asset_version", "Accept a finished asset after the user reviews it, moving it from Review to Done (accepted=false moves it back). A marker only; the AI verdict and files are unchanged. Iterating later creates a new unaccepted version.", write,
    acceptInput.extend(versionId.shape), ({ versionId, accepted }) => ({ path: `asset-versions/${versionId}/accept`, method: "POST", body: { accepted } }));
  register("reopen_asset_as_idea", "Create a new idea from an asset's brief, settings, title and references. The original asset, its versions and any running generation stay unchanged, so it works at any time. No AI charge. Provide one of its version IDs; returns the new idea's id and title.", write,
    versionId, ({ versionId }) => ({ path: `asset-versions/${versionId}/idea`, method: "POST", body: {} }));
  register("export_assets", "Zip every saved file of finished assets (GLB, Blender source, scripts, renders, LODs, sprites, images, visual targets) plus a manifest. Omit versionIds to export each asset's latest finished version; acceptedOnly limits it to Done items. Returns an artifact key for read_artifact.", write,
    exportInput.omit({ modelIds: true }).extend({ ...projectId.shape, versionIds: exportInput.shape.modelIds }), ({ projectId, versionIds, ...input }) => ({ path: `projects/${projectId}/export`, method: "POST", body: { ...input, modelIds: versionIds } }));
  register("update_design_from_asset", "Queue a draft design from a saved 3D render index. Paid AI. Choose replaceReference when the project already has six references. Approval is still required before generation.", write,
    designUpdateInput.extend(versionId.shape), (input) => ({ path: `asset-versions/${input.versionId}/design-update`, method: "POST", body: input }), { paid: true });
  register("approve_visual_target", "Approve the exact current visual target after the user reviews it, then queue the paid 3D build.", write,
    visualTargetDecisionInput.options[0].omit({ action: true }).extend(versionId.shape),
    ({ versionId, target }) => ({ path: `asset-versions/${versionId}/visual-target`, method: "POST", body: { action: "approve", target } }), { paid: true });
  register("revise_visual_target", "Request a paid revision of the current visual target. The new image awaits user approval before building.", write,
    visualTargetDecisionInput.options[1].omit({ action: true }).extend(versionId.shape),
    ({ versionId, target, prompt }) => ({ path: `asset-versions/${versionId}/visual-target`, method: "POST", body: { action: "revise", target, prompt } }), { paid: true });
  register("retry_asset_version", "Continue a failed asset with its original checkpoints and Eve session. Paid work may continue; existing attempts remain in history.", write,
    versionId, ({ versionId }) => ({ path: `asset-versions/${versionId}/retry`, method: "POST" }), { paid: true });
  register("list_animation_clips", "Read named animations from a saved GLB before selecting a sprite clip.", read,
    versionId.extend({ sourceRunId: uuid }), ({ versionId, sourceRunId }) => ({ path: `asset-versions/${versionId}/sprite-clips?sourceRunId=${sourceRunId}` }));
  register("render_asset", "Render saved GLB views or a transparent sprite sheet in local Blender. No AI charge. Returns a presentation job id; poll get_export_job. Supplying spriteOptions={} uses current pixel defaults.", write,
    presentationInput.extend(versionId.shape), (input) => ({ path: `asset-versions/${input.versionId}/presentation`, method: "POST", body: input }));
  register("list_asset_exports", "Read recent presentation/sprite exports for a model. Material assignment jobs are retrieved by their returned job id.", read,
    versionId.extend(pageInput.shape), ({ versionId }) => ({ path: `asset-versions/${versionId}/workshop-jobs` }), { map: paginate });
  register("get_export_job", "Poll a presentation, material or material-assignment job. Files become available when done. This does not retry the job.", read,
    jobId, ({ jobId }) => ({ path: `workshop-jobs/${jobId}` }));
  register("assign_material", "Apply a completed project material to an existing named model slot with UVs, creating an exported variant. Local Blender, no AI charge; returns a job id.", write,
    materialAssignmentInput.extend(versionId.shape), (input) => ({ path: `asset-versions/${input.versionId}/material-assignment`, method: "POST", body: input }));
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

export type StudioToolInfo = { name: string; title: string; description: string; scope: McpScope };

// Tools are registered per scope, so the first scope level that exposes a tool is its required scope.
export function studioToolCatalog(): StudioToolInfo[] {
  const catalog = new Map<string, StudioToolInfo>();
  const store = { listClients: async () => [], revokeClient: async () => {} };
  for (const scope of [read, write, admin]) {
    const server = createStudioMcpServer({
      scopes: [read, write, admin].slice(0, [read, write, admin].indexOf(scope) + 1),
      publicUrl: new URL("https://catalog.invalid"), store,
    });
    const tools = (server as unknown as { _registeredTools: Record<string, { description?: string }> })._registeredTools;
    for (const [name, tool] of Object.entries(tools))
      if (!catalog.has(name)) catalog.set(name, {
        name, scope, description: tool.description ?? "",
        title: name.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
      });
  }
  return [...catalog.values()];
}
