import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { request, money, fileUrl } from "../../../../lib/client";
import { TextSkeleton } from "../../../../components/loading";
import { AssetImage } from "../../../../components/asset-image";
export function History({ runs, models }: { runs: any[]; models: any[] }) {
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
  const max = Math.max(1, ...runs.map((r) => r.inputTokens + r.outputTokens));
  return (
    <div className="history">
      <div className="section-title">
        <h2>The process, in full</h2>
        <span>{runs.length} AI requests</span>
      </div>
      <p className="muted">
        Every brief, response, visual review, and token accounted for. Bars:
        green = input, gold = output.
      </p>
      {!runs.length && (
        <Empty className="empty">
          Request history will appear when you use AI.
        </Empty>
      )}
      {runs.map((r) => (
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
                </span>
                <Badge variant="secondary" className={"badge " + r.status}>
                  {r.status}
                </Badge>
                <span className="run-cost">
                  {r.estimatedCost === null
                    ? r.finishedAt
                      ? "Unavailable"
                      : "Pending"
                    : money(r.estimatedCost)}
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
                <Card className="run-stats">
                  <span>
                    <ArrowDownLeft size={16} /> {r.inputTokens.toLocaleString()}{" "}
                    input
                  </span>
                  <span>
                    <ArrowUpRight size={16} /> {r.outputTokens.toLocaleString()}{" "}
                    output
                  </span>
                  <span>{r.cachedTokens.toLocaleString()} cached</span>
                  <span>
                    <Clock size={16} />{" "}
                    {r.finishedAt
                      ? Math.round(
                          (+new Date(r.finishedAt) - +new Date(r.createdAt)) /
                            1000,
                        ) + "s"
                      : "Running"}
                  </span>
                </Card>
                <p className="note">
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
    </div>
  );
}
