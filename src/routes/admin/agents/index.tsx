import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, Check, Copy, FileText, ImageIcon, Workflow } from "lucide-react";
import { request } from "../../../lib/client";
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
  effort: string;
  prompt: string;
  inputTemplate: string;
  promptFiles: PromptFile[];
};

const roleDescriptions: Record<string, string> = {
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

export const Route = createFileRoute("/admin/agents/")({
  component: AgentsPage,
});
function AgentsPage() {
  const [agents, setAgents] = useState<AgentSettings[] | null>(null);
  const [error, setError] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState("");
  useEffect(() => {
    request("agents")
      .then((r) => setAgents(r.agents))
      .catch((e) => setError(e.message));
  }, []);

  async function copyPrompt(key: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopiedPrompt(key);
    window.setTimeout(() => setCopiedPrompt(""), 1800);
  }

  return (
    <div className="admin-page agents-page">
      <section className="page-heading">
        <div>
          <h1>Agents & AI roles</h1>
          <p className="lede">
            Execution settings for new requests. Existing sessions retain their
            saved settings.
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
            Live authored prompts from <code>prompts/</code>. Settings are
            read-only.
          </span>
        </div>
      </Card>
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          {error}
        </Alert>
      )}
      {!agents && !error && (
        <CardsSkeleton label="Loading agent settings" covers={false} />
      )}
      <div className="agents-grid">
        {agents?.map((agent) => (
          <Card className="agent-card" key={agent.id}>
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
            <p className="agent-description">{roleDescriptions[agent.id]}</p>
            <dl className="role-settings">
              <div>
                <dt>Model</dt>
                <dd>{agent.model}</dd>
              </div>
              <div>
                <dt>{agent.engine === "imagegen" ? "Quality" : "Effort"}</dt>
                <dd>{agent.effort}</dd>
              </div>
              <div>
                <dt>Prompt files</dt>
                <dd>{agent.promptFiles.length}</dd>
              </div>
            </dl>
            <div className="agent-prompts">
              <div className="agent-prompts-heading">
                <h3>Authored prompts</h3>
                <span>Open a file to inspect its exact contents</span>
              </div>
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
            </div>
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
