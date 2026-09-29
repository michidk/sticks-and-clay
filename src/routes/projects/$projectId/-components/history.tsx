import { useEffect, useState } from "react";
import { ChevronDown, Clock, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { request, money, fileUrl } from "../../../../lib/client";
export function History({ runs, models }: { runs: any[]; models: any[] }) {
  const [open, setOpen] = useState<string | null>(null),
    [events, setEvents] = useState<any[]>([]),
    [error, setError] = useState("");
  function expand(id: string) {
    setOpen(open === id ? null : id);
  }
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
        <div className="empty">
          Request history will appear when you use AI.
        </div>
      )}
      {runs.map((r) => (
        <article className="run" key={r.id}>
          <button
            className="run-head"
            onClick={() => expand(r.id)}
            aria-expanded={open === r.id}
          >
            <span className={"role-icon " + r.role}>
              {r.role.slice(0, 1).toUpperCase()}
            </span>
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
            <span className={"badge " + r.status}>{r.status}</span>
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
          </button>
          <div
            className="usage-bar"
            title={`${r.inputTokens} input, ${r.outputTokens} output`}
          >
            <i style={{ width: `${(r.inputTokens / max) * 100}%` }} />
            <b style={{ width: `${(r.outputTokens / max) * 100}%` }} />
          </div>
          {open === r.id && (
            <div className="run-detail">
              <div className="run-stats">
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
              </div>
              <p className="note">
                Cost estimate using ${r.rates.input} / M input, $
                {r.rates.cached} / M cached input, ${r.rates.output} / M output.{" "}
                {r.rates.source}.{" "}
                {["estimated", "mixed"].includes(r.usageSource)
                  ? "Usage unavailable: assumes 4 text characters per token and 1,000 tokens per image per step. Tool context is approximated; hidden reasoning may increase actual usage."
                  : ""}
              </p>
              {r.error && <p className="error">{r.error}</p>}
              <details>
                <summary>
                  Role instructions · revision {r.promptVersion}
                </summary>
                <pre>{r.systemPrompt}</pre>
              </details>
              <details>
                <summary>Agent input</summary>
                <pre>{r.input}</pre>
                <div className="reference-strip">
                  {r.images.map((src: string) => (
                    <a
                      key={src}
                      href={fileUrl(src)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img src={fileUrl(src)} alt="Agent image input" />
                    </a>
                  ))}
                </div>
              </details>
              <details open>
                <summary>Agent output</summary>
                <pre>{r.output || "Waiting for response…"}</pre>
              </details>
              <details>
                <summary>Tool calls & events ({events.length})</summary>
                {error && <p className="error">{error}</p>}
                <pre>{JSON.stringify(events, null, 2)}</pre>
              </details>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
