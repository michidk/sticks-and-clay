import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useEffect, useState } from "react";
import {
  Bot,
  Boxes,
  Camera,
  ChevronDown,
  Clock,
  Image as ImageIcon,
  ListChecks,
  PenLine,
  Grid3x3,
  ScanEye,
} from "lucide-react";
import { roleLabel } from "@/lib/queue-view";
import { request, money, costSummary, fileUrl, previewUrl } from "../../../../lib/client";
import { TextSkeleton } from "../../../../components/loading";
import { AssetImage } from "../../../../components/asset-image";
import type { runs as agentRuns } from "@/db/schema";
type RunContent = Pick<typeof agentRuns.$inferSelect, "status" | "id" | "systemPrompt" | "input" | "output" | "images">;
const roleIcons: Record<string, typeof Bot> = {
  "visual-target": ImageIcon,
  graphic: ImageIcon,
  svg: PenLine,
  "svg-designer": PenLine,
  "svg-design-update": PenLine,
  "svg-planner": ListChecks,
  pixel: Grid3x3,
  "pixel-designer": Grid3x3,
  "pixel-design-update": Grid3x3,
  "pixel-planner": ListChecks,
  texture: ImageIcon,
  builder: Boxes,
  "material-builder": Boxes,
  photographer: Camera,
  judge: ScanEye,
  "material-judge": ScanEye,
  designer: PenLine,
  "graphic-designer": PenLine,
  planner: ListChecks,
  "graphic-planner": ListChecks,
  "material-planner": ListChecks,
};
export function History({ runs, models }: { runs: any[]; models: any[] }) {
  const [assetFilter, setAssetFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null),
    [content, setContent] = useState<RunContent | null>(null),
    [events, setEvents] = useState<unknown[]>([]),
    [error, setError] = useState("");
  const [eventsOpen, setEventsOpen] = useState(false);
  useEffect(() => { setEventsOpen(false); }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let running = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setEvents([]);
    setContent(null);
    setError("");
    const load = () =>
      request<{ run: RunContent; events: unknown[] }>(`runs/${open}/details?events=${eventsOpen}`, { signal: controller.signal })
        .then((result) => {
          if (active) {
            running = result.run.status === "running";
            setEvents(result.events);
            setContent(result.run);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        })
        .finally(() => {
          if (active && running) timer = setTimeout(load, 3000);
        });
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, eventsOpen]);
  const filtered = runs.filter(
    (r) =>
      (assetFilter === "all" || (r.modelId || "project") === assetFilter) &&
      (roleFilter === "all" || r.role === roleFilter) &&
      (statusFilter === "all" || r.status === statusFilter),
  );
  const groups = [...new Set(filtered.map((r) => r.modelId || "project"))].map(
    (id) => ({
      id,
      name:
        id === "project"
          ? "Project setup & presentation"
          : models.find((m) => m.id === id)?.name.replaceAll("_", " ") ||
            "Asset",
      runs: filtered.filter((r) => (r.modelId || "project") === id),
    }),
  );
  const max = Math.max(1, ...runs.map((r) => r.inputTokens + r.outputTokens));
  return (
    <div className="history">
      <div className="stage-head">
        <div>
          <h2>Activity</h2>
          <p className="muted">Every AI request with its outcome and estimated cost, including failed attempts.</p>
        </div>
      </div>
      {!!runs.length && (
        <div className="history-filters">
          <Label>
            Asset
            <Select value={assetFilter} onValueChange={setAssetFilter}>
              <SelectTrigger aria-label="Filter activity by asset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assets</SelectItem>
                <SelectItem value="project">Project</SelectItem>
                {models.map((m) => (
                  <SelectItem value={m.id} key={m.id}>
                    {m.name.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label>
            Action
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger aria-label="Filter activity by action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {[...new Set(runs.map((r) => r.role))].map((role) => (
                  <SelectItem value={role} key={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label>
            Outcome
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter activity by outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                {[...new Set(runs.map((r) => r.status))].map((status) => (
                  <SelectItem value={status} key={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        </div>
      )}
      {!!runs.length && !filtered.length && (
        <Empty>
          <h3>No matching requests</h3>
          <Button
            variant="outline"
            onClick={() => {
              setAssetFilter("all");
              setRoleFilter("all");
              setStatusFilter("all");
            }}
          >
            Clear filters
          </Button>
        </Empty>
      )}
      {!runs.length && (
        <Empty className="empty">
          No AI requests yet.
        </Empty>
      )}
      {groups.map((group) => (
        <section
          className="history-group"
          key={group.id}
          aria-label={group.name}
        >
          <div className="history-group-heading">
            <h3>{group.name}</h3>
            <span>
              {group.runs.length} requests · Est.{" "}
              {costSummary(
                group.runs.reduce(
                  (total, r) => total + (r.estimatedCost || 0),
                  0,
                ),
              )}
              {group.runs.some((r) => r.estimatedCost === null)
                ? ` · ${group.runs.filter((r) => r.estimatedCost === null).length} not yet priced`
                : ""}
            </span>
          </div>
          {group.runs.map((r) => {
            const Icon = roleIcons[r.role] || Bot;
            return (
            <Collapsible
              key={r.id}
              open={open === r.id}
              onOpenChange={(isOpen) => setOpen(isOpen ? r.id : null)}
              asChild
            >
              <article className="run">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="bare" className="run-head">
                    <span className={"role-icon " + r.role} aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="run-name">
                      <strong>
                        {roleLabel(r.role)}{" "}
                        <span className="muted">
                          {r.modelId
                            ? `· ${models.find((m) => m.id === r.modelId)?.name || "model"} · round ${r.iteration + 1}`
                            : "· project"}
                        </span>
                      </strong>
                      <small>{new Date(r.createdAt).toLocaleString()}</small>
                    </span>
                    <StatusBadge status={r.status} />
                    <span className="run-cost">
                      {r.estimatedCost === null
                        ? r.finishedAt
                          ? "Unavailable"
                          : "Pending"
                        : `Est. ${costSummary(r.estimatedCost)}`}{" "}
                      <small>
                        {["estimated", "mixed"].includes(r.usageSource)
                          ? "Estimated tokens"
                          : `${(r.inputTokens + r.outputTokens).toLocaleString()} tokens`}
                      </small>
                    </span>
                    <ChevronDown size={16} />
                  </Button>
                </CollapsibleTrigger>
                <div
                  className="usage-bar"
                  title={`${r.inputTokens} input, ${r.outputTokens} output`}
                >
                  <i style={{ width: `${(r.inputTokens / max) * 100}%` }} />
                  <b style={{ width: `${(r.outputTokens / max) * 100}%` }} />
                </div>
                <CollapsibleContent asChild>
                  <div className="run-detail">
                    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                    {content?.id !== r.id && !error && <TextSkeleton label="Loading agent details" />}
                    <p className="run-engine">
                      {" "}
                      <small>
                        {r.engine === "imagegen"
                          ? "Imagegen"
                          : r.engine === "tanstack"
                            ? "TanStack AI"
                            : "Eve"}{" "}
                        · {r.model}
                        {r.effort ? ` · ${r.effort} effort` : ""} ·{" "}
                        {new Date(r.createdAt).toLocaleString()}
                      </small>
                    </p>
                    <Card className="run-stats">
                      <span>
                        <i className="usage-swatch is-input" aria-hidden="true" />
                        {r.inputTokens.toLocaleString()} input tokens
                      </span>
                      <span>
                        <i className="usage-swatch is-output" aria-hidden="true" />
                        {r.outputTokens.toLocaleString()} output tokens
                      </span>
                      <span>{r.cachedTokens.toLocaleString()} cached</span>
                      <span>
                        <Clock size={16} />{" "}
                        {r.finishedAt
                          ? Math.round(
                              (+new Date(r.finishedAt) -
                                +new Date(r.createdAt)) /
                                1000,
                            ) + "s"
                          : "Running"}
                      </span>
                    </Card>
                    <p className="note">
                      {r.estimatedCost === null
                        ? "Cost not yet priced."
                        : `Exact estimate: ${money(r.estimatedCost)}.`}{" "}
                      Cost estimate using ${r.rates.input} / M input, $
                      {r.rates.cached} / M cached input, ${r.rates.output} / M
                      output. {r.rates.source}.{" "}
                      {["estimated", "mixed"].includes(r.usageSource)
                        ? "Usage unavailable: assumes 4 text characters per token and 1,000 tokens per image per step. Tool context is approximated; hidden reasoning may increase actual usage."
                        : ""}
                    </p>
                    {r.error && (
                      <Alert variant="destructive" className="error">
                        <AlertDescription>{r.error}</AlertDescription>
                      </Alert>
                    )}
                    {(
                      r.result?.projectPhotography?.renders ||
                      r.result?.photography?.renders
                    )?.map((key: string) => (
                      <a
                        key={key}
                        href={previewUrl(key)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <AssetImage
                          src={fileUrl(key)}
                          alt="Photographer render"
                          style={{ maxHeight: 280, objectFit: "contain" }}
                        />
                      </a>
                    ))}
                    {content && content.id === r.id && <>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="content">
                        <AccordionTrigger>
                          Role instructions · revision {r.promptVersion}
                        </AccordionTrigger>
                        <AccordionContent>
                          <pre>{content.systemPrompt}</pre>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="content">
                        <AccordionTrigger>Agent input</AccordionTrigger>
                        <AccordionContent>
                          <pre>{content.input}</pre>
                          <div className="reference-strip">
                            {content.images.map((src) => (
                              <a
                                key={src}
                                href={previewUrl(src)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <AssetImage
                                  src={fileUrl(src)}
                                  alt="Agent image input"
                                />
                              </a>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                    <Accordion type="single" collapsible defaultValue="content">
                      <AccordionItem value="content">
                        <AccordionTrigger>Agent output</AccordionTrigger>
                        <AccordionContent>
                          {content.output ? (
                            <pre>{content.output}</pre>
                          ) : r.status === "running" ? (
                            <TextSkeleton label="Waiting for agent response" />
                          ) : (
                            <p className="muted">No response recorded.</p>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                    <Accordion type="single" collapsible value={eventsOpen ? "content" : ""} onValueChange={(value) => setEventsOpen(value === "content")}>
                      <AccordionItem value="content">
                        <AccordionTrigger>
                          Tool calls & events{eventsOpen ? ` (${events.length})` : ""}
                        </AccordionTrigger>
                        <AccordionContent>
                          {eventsOpen && (events.length ? (
                            <pre>{JSON.stringify(events, null, 2)}</pre>
                          ) : (
                            !error && (
                              <p className="muted">No events recorded.</p>
                            )
                          ))}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                    </>}
                  </div>
                </CollapsibleContent>
              </article>
            </Collapsible>
            );
          })}
        </section>
      ))}
    </div>
  );
}
