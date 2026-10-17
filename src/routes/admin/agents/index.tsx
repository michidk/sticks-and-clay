import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, Check, Copy, FileText, ImageIcon, Workflow } from "lucide-react";
import { json, request } from "../../../lib/client";
import { imageModelOptions, textModelOptions } from "../../../lib/contracts";
import { CardsSkeleton } from "../../../components/loading";

type PromptFile = {
  kind: string;
  path: string;
  content: string;
};

type AgentSettings = {
  id: string;
  engine: "eve" | "imagegen" | "tanstack";
  model: string;
  effort: "low" | "medium" | "high";
  prompt: string;
  inputTemplate: string;
  promptFiles: PromptFile[];
};

const roleDescriptions: Record<string, string> = {
  "project-name": "Creates a concise collection name from the project brief.",
  "project-brief": "Turns a project name, notes, and references into an editable creative brief.",
  "model-brief": "Develops a focused brief for a specific model before production begins.",
  designer: "Defines the collection-wide visual language, materials, and construction rules.",
  planner: "Breaks an approved direction into a useful, coherent set of individual assets.",
  builder: "Creates and revises production-ready Blender assets through a resumable session.",
  photographer: "Renders consistent review views from archived model exports.",
  judge: "Reviews geometry and surfaces against the approved brief and visual evidence.",
  "visual-target": "Generates the visual benchmark used to guide modeling and review.",
  texture: "Produces image textures for builders through the image generation adapter.",
};

const displayName = (id: string) =>
  id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const efforts = ["low", "medium", "high"] as const;
const choices = (agent: AgentSettings) => {
  const known = agent.engine === "imagegen" ? imageModelOptions : textModelOptions;
  return known.includes(agent.model) ? known : [agent.model, ...known];
};

export const Route = createFileRoute("/admin/agents/")({
  component: AgentsPage,
});
function AgentsPage() {
  const [agents, setAgents] = useState<AgentSettings[] | null>(null);
  // Last saved values, to tell which rows have unsaved edits.
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState("");
  const [savingId, setSavingId] = useState("");
  const [bulkModel, setBulkModel] = useState("");
  const [bulkEffort, setBulkEffort] = useState("");
  const load = (list: AgentSettings[]) => {
    setAgents(list);
    setSaved(Object.fromEntries(list.map((a) => [a.id, `${a.model}|${a.effort}`])));
  };
  useEffect(() => {
    request("agents")
      .then((r) => load(r.agents))
      .catch((e) => setError(e.message));
  }, []);
  const textAgents = agents?.filter((agent) => agent.engine !== "imagegen") ?? [];
  const imageAgents = agents?.filter((agent) => agent.engine === "imagegen") ?? [];
  const dirty = (agent: AgentSettings) => saved[agent.id] !== `${agent.model}|${agent.effort}`;

  async function copyPrompt(key: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopiedPrompt(key);
    window.setTimeout(() => setCopiedPrompt(""), 1800);
  }

  function updateAgent(id: string, patch: Partial<AgentSettings>) {
    setAgents((current) => current?.map((agent) => agent.id === id ? { ...agent, ...patch } : agent) ?? null);
  }

  async function save(id: string, changes: AgentSettings[]) {
    setSavingId(id);
    setError("");
    try {
      const response = await request<{ agents: AgentSettings[] }>("agents", json({
        agents: changes.map(({ id, engine, model, effort }) => ({ id, engine, model, effort })),
      }, "PATCH"));
      load(response.agents);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingId("");
    }
  }

  const applyToAll = () =>
    save("all", textAgents.map((agent) => ({
      ...agent,
      model: bulkModel || agent.model,
      effort: (bulkEffort || agent.effort) as AgentSettings["effort"],
    })));

  return (
    <div className="admin-page agents-page">
      <section className="page-heading">
        <div>
          <h1>Agents & AI roles</h1>
          <p className="lede">
            Tune models and reasoning for new requests. Existing sessions retain
            their saved configuration.
          </p>
        </div>
      </section>
      <Card className="agent-overview">
        <div>
          <strong>{agents?.length ?? "—"}</strong>
          <span>Configured roles</span>
        </div>
        <div>
          <strong>{agents ? new Set(agents.map((agent) => agent.engine)).size : "—"}</strong>
          <span>Execution engines</span>
        </div>
        <div className="agent-overview-note">
          <FileText aria-hidden="true" />
          <span>
            Models are configurable. Authored prompts from <code>prompts/</code>
            remain read-only and repository-managed.
          </span>
        </div>
      </Card>
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!agents && !error && (
        <CardsSkeleton label="Loading agent settings" covers={false} />
      )}
      {agents && (
        <Card className="agent-bulk" aria-label="Change all text roles">
          <div>
            <h2>Quick edit</h2>
            <p>Set one model and/or effort for all {textAgents.length} text roles at once. Image roles are edited individually below. Saved choices take precedence over the model preset in Settings.</p>
          </div>
          <div className="agent-controls">
            <Label>
              Model
              <Select value={bulkModel} disabled={Boolean(savingId)} onValueChange={setBulkModel}>
                <SelectTrigger><SelectValue placeholder="Keep each role's model" /></SelectTrigger>
                <SelectContent>
                  {textModelOptions.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                </SelectContent>
              </Select>
            </Label>
            <Label>
              Effort
              <Select value={bulkEffort} disabled={Boolean(savingId)} onValueChange={setBulkEffort}>
                <SelectTrigger><SelectValue placeholder="Keep each role's effort" /></SelectTrigger>
                <SelectContent>
                  {efforts.map((effort) => <SelectItem key={effort} value={effort} className="capitalize">{effort}</SelectItem>)}
                </SelectContent>
              </Select>
            </Label>
            <Button onClick={applyToAll} disabled={Boolean(savingId) || (!bulkModel && !bulkEffort)}>
              {savingId === "all" ? "Applying…" : `Apply to ${textAgents.length} roles`}
            </Button>
          </div>
        </Card>
      )}
      <div className="agents-list">
        {[...textAgents, ...imageAgents].map((agent) => (
          <Card className="agent-row" key={agent.id}>
            <div className="agent-row-main">
            <div className="agent-card-header">
              <div className="agent-identity">
                <span className="agent-icon" data-engine={agent.engine}>
                  {agent.engine === "imagegen" ? (
                    <ImageIcon aria-hidden="true" />
                  ) : agent.engine === "eve" ? (
                    <Workflow aria-hidden="true" />
                  ) : (
                    <Bot aria-hidden="true" />
                  )}
                </span>
                <div>
                  <h2>{displayName(agent.id)}</h2>
                  <code>{agent.id}</code>
                </div>
              </div>
              <Badge variant="secondary" className="badge">
                {agent.engine === "eve"
                  ? "Eve · resumable"
                  : agent.engine === "imagegen"
                    ? "Imagegen · one-shot"
                    : "TanStack AI · one-shot"}
              </Badge>
            </div>
            {roleDescriptions[agent.id] && <p className="agent-description">{roleDescriptions[agent.id]}</p>}
            </div>
            <div className="agent-controls">
              <Label>
                Model
                <Select value={agent.model} disabled={Boolean(savingId)}
                  onValueChange={(model) => updateAgent(agent.id, { model })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {choices(agent).map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Label>
              <Label>
                {agent.engine === "imagegen" ? "Quality" : "Effort"}
                <Select value={agent.effort} disabled={Boolean(savingId)}
                  onValueChange={(effort: AgentSettings["effort"]) => updateAgent(agent.id, { effort })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {efforts.map((effort) => <SelectItem key={effort} value={effort} className="capitalize">{effort}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Label>
              <Button size="sm" variant={dirty(agent) ? "default" : "outline"}
                onClick={() => save(agent.id, [agent])} disabled={Boolean(savingId) || !dirty(agent)}>
                {savingId === agent.id ? "Saving…" : dirty(agent) ? "Save" : "Saved"}
              </Button>
            </div>
            <Accordion type="single" collapsible className="agent-prompts">
              <AccordionItem value="prompts">
                <AccordionTrigger>
                  <span className="prompt-label">
                    Authored prompts · {agent.promptFiles.length} {agent.promptFiles.length === 1 ? "file" : "files"}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
              <Accordion type="multiple">
                {agent.promptFiles.map((file) => (
                  <AccordionItem value={file.path} key={file.path}>
                    <AccordionTrigger>
                      <span className="prompt-label">
                        <FileText aria-hidden="true" />
                        <span>
                          <span className="prompt-kind">{file.kind}</span>
                          <span className="prompt-path">{file.path}</span>
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="prompt-toolbar">
                        <span>{file.content.length.toLocaleString()} characters</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyPrompt(`${agent.id}:${file.path}`, file.content)
                          }
                        >
                          {copiedPrompt === `${agent.id}:${file.path}` ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Copy aria-hidden="true" />
                          )}
                          {copiedPrompt === `${agent.id}:${file.path}`
                            ? "Copied"
                            : "Copy prompt"}
                        </Button>
                      </div>
                      <pre className="prompt-content">{file.content}</pre>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>
        ))}
      </div>
      <Card className="agent-capability-note">
        <ImageIcon aria-hidden="true" />
        <div>
          <h2>Texture generation</h2>
          <p>
            Builders can call the Codex imagegen skill through generate_texture.
            Generated and derived texture images are retained with each model
            version. Image requests have separate history and usage records.
          </p>
        </div>
      </Card>
    </div>
  );
}
