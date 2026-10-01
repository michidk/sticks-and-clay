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
import { Badge } from "@/components/ui/badge";
import {
  AgentStateBadge,
  agentStateFromStatus,
} from "@/components/agent-state";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useEffect, useState } from "react";
import { ChevronDown, Clock, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { request, money, costSummary, fileUrl } from "../../../../lib/client";
import { TextSkeleton } from "../../../../components/loading";
import { AssetImage } from "../../../../components/asset-image";
export function History({ runs, models }: { runs: any[]; models: any[] }) {
  const [assetFilter, setAssetFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null),
    [events, setEvents] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setEvents([]);
    setError("");
    const load = () =>
      request("runs/" + open)
        .then((result) => {
          if (active) setEvents(result);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open]);
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
      <div className="section-title">
        <h2>The process, in full</h2>
        <span>{runs.length} AI requests</span>
      </div>
      <p className="muted">
        Browse requests by asset. Costs include all attempts and are estimates.
        Bars show input (green) and output (gold) tokens.
      </p>
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
                    {role}
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
          Request history will appear when you use AI.
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
          {group.runs.map((r) => (
            <Collapsible
              key={r.id}
              open={open === r.id}
              onOpenChange={(isOpen) => setOpen(isOpen ? r.id : null)}
              asChild
            >
              <article className="run">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="bare" className="run-head">
                    <Avatar className={"role-icon " + r.role}>
                      <AvatarFallback>
                        {r.role.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="run-name">
                      <strong>
                        {r.role}{" "}
                        <span className="muted">
                          {r.modelId
                            ? `· ${models.find((m) => m.id === r.modelId)?.name || "model"} · round ${r.iteration + 1}`
                            : "· project"}
                        </span>
                      </strong>
                      <small>{new Date(r.createdAt).toLocaleString()}</small>
                    </span>
                    <span className="run-state-badges">
                      <AgentStateBadge state={agentStateFromStatus(r.status)} />
                      {["failed", "cancelled"].includes(r.status) && (
                        <Badge
                          variant="secondary"
                          className={"badge " + r.status}
                        >
                          {r.status}
                        </Badge>
                      )}
                    </span>
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
                        <ArrowDownLeft size={16} />{" "}
                        {r.inputTokens.toLocaleString()} input
                      </span>
                      <span>
                        <ArrowUpRight size={16} />{" "}
                        {r.outputTokens.toLocaleString()} output
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
                        {r.error}
                      </Alert>
                    )}
                    {(
                      r.result?.projectPhotography?.renders ||
                      r.result?.photography?.renders
                    )?.map((key: string) => (
                      <a
                        key={key}
                        href={fileUrl(key)}
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
                    <Accordion type="single" collapsible>
                      <AccordionItem value="content">
                        <AccordionTrigger>
                          Role instructions · revision {r.promptVersion}
                        </AccordionTrigger>
                        <AccordionContent>
                          <pre>{r.systemPrompt}</pre>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="content">
                        <AccordionTrigger>Agent input</AccordionTrigger>
                        <AccordionContent>
                          <pre>{r.input}</pre>
                          <div className="reference-strip">
                            {r.images.map((src: string) => (
                              <a
                                key={src}
                                href={fileUrl(src)}
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
                          {r.output ? (
                            <pre>{r.output}</pre>
                          ) : r.status === "running" ? (
                            <TextSkeleton label="Waiting for agent response" />
                          ) : (
                            <p className="muted">No response recorded.</p>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="content">
                        <AccordionTrigger>
                          Tool calls & events ({events.length})
                        </AccordionTrigger>
                        <AccordionContent>
                          {error && (
                            <Alert variant="destructive" className="error">
                              {error}
                            </Alert>
                          )}
                          {events.length ? (
                            <pre>{JSON.stringify(events, null, 2)}</pre>
                          ) : (
                            !error && (
                              <TextSkeleton
                                label="Loading agent events"
                                lines={3}
                              />
                            )
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                </CollapsibleContent>
              </article>
            </Collapsible>
          ))}
        </section>
      ))}
    </div>
  );
}
