import { Badge } from "@/components/ui/badge";
import { fileUrl } from "@/lib/client";
import type { Artifacts, Build } from "../-lib/model";

const labels: Record<string, string> = {
  "weld-exact-vertices": "Merged identical vertices",
  "dedup-accessors": "Deduplicated geometry data",
  "prune-unused-resources": "Removed unused resources",
  "reorder-indices": "Optimized index order",
};
export function ModelChecks({
  artifacts,
  judges = [],
}: {
  artifacts?: Artifacts;
  judges?: Build["judges"];
}) {
  const receipt = artifacts?.handover,
    cleanup = receipt?.cleanup;
  const reports = judges.filter((j) => j.analysis);
  return (
    <section
      className="space-y-6 min-w-0"
      aria-label="Analysis and cleanup results"
    >
      {artifacts?.metrics.readiness && (
        <div>
          <h3>Source readiness · {artifacts.metrics.readiness.status}</h3>
          <p className="muted">
            Technical findings are separate from visual approval.
          </p>
          <ul className="list-disc pl-5">
            {artifacts.metrics.readiness.findings.map((f, i) => (
              <li key={i}>
                <strong>{f.object}</strong>: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!artifacts?.metrics.styleReview?.warnings.length && (
        <div>
          <h3>Collection style</h3>
          <ul className="list-disc pl-5">
            {artifacts.metrics.styleReview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3>GLB cleanup</h3>
        {!cleanup ? (
          <p className="muted">
            {artifacts
              ? "No cleanup result recorded for this version."
              : "Available after a model is exported."}
          </p>
        ) : (
          <>
            <Badge variant="outline">
              {cleanup.status === "applied" ? "Applied" : "Skipped"}
            </Badge>
            {cleanup.reason && <p className="break-words">{cleanup.reason}</p>}
            {!!cleanup.steps?.length && (
              <ul className="list-disc pl-5">
                {cleanup.steps.map((s) => (
                  <li key={s}>{labels[s] || s.replaceAll("-", " ")}</li>
                ))}
              </ul>
            )}
            {receipt && (
              <p className="muted">
                File size: {(receipt.inputBytes / 1024).toFixed(1)} KB →{" "}
                {(receipt.outputBytes / 1024).toFixed(1)} KB
              </p>
            )}
          </>
        )}
        {receipt?.manifest && (
          <a
            className="underline"
            href={fileUrl(receipt.manifest)}
            target="_blank"
            rel="noreferrer"
          >
            View cleanup receipt (JSON)
          </a>
        )}
      </div>
      <div>
        <h3>Geometry analysis</h3>
        <p className="muted">
          Read-only findings for the AI judge. Findings may be intentional;
          these checks do not repair the model or decide approval.
        </p>
        {!reports.length && (
          <p>
            No analysis report recorded for this build yet. Analysis runs
            before judging.
          </p>
        )}
        {reports.map((j) => {
          const report = j.analysis!;
          const mismatch =
            report.sha256 &&
            receipt?.outputSha256 &&
            report.sha256 !== receipt.outputSha256;
          return (
            <div
              key={j.id}
              className="mt-4 space-y-3 rounded-lg border p-4 min-w-0"
            >
              <Badge variant="outline">
                {mismatch
                  ? "File mismatch"
                  : report.unavailable.length || report.truncated
                    ? "Partial analysis"
                    : "Analysis complete"}
              </Badge>
              {mismatch && (
                <p>
                  This report identifies a different GLB. Do not apply its face
                  references to this export.
                </p>
              )}
              <p>
                {report.findings.length
                  ? `${report.findings.length} finding groups`
                  : report.unavailable.length
                    ? "No findings returned by the available checks."
                    : "No issues detected by the checks performed."}
              </p>
              {report.findings.map((f, i) => (
                <div key={i} className="border-t pt-3 break-words">
                  <strong>{f.code.replaceAll("_", " ")}</strong>
                  <p>
                    {f.object} · {f.countIsLowerBound ? "at least " : ""}
                    {f.count} · {f.confidence || "unspecified"} confidence
                  </p>
                  {f.slot && (
                    <p>
                      Material {f.material} · {f.slot} · UV set {f.texCoord}
                    </p>
                  )}
                  <details>
                    <summary className="cursor-pointer">
                      Affected geometry
                    </summary>
                    <p>
                      Node {f.node ?? "—"} · Mesh {f.mesh ?? "—"}
                    </p>
                    <p>
                      {f.faces?.length
                        ? f.faces
                            .map(
                              (r) =>
                                `Primitive ${r.primitive}, triangle ${r.triangle}`,
                            )
                            .join("; ")
                        : f.triangles?.length
                          ? `Triangles: ${f.triangles.join(", ")}`
                          : "No face references recorded."}
                    </p>
                    {!!f.polygons?.length && (
                      <p>Polygons: {f.polygons.join(", ")}</p>
                    )}
                  </details>
                </div>
              ))}
              {report.truncated && (
                <p>Report truncated; additional findings may exist.</p>
              )}
              {!!report.unavailable.length && (
                <div>
                  <h4>Unavailable checks</h4>
                  <ul className="list-disc pl-5 break-words">
                    {report.unavailable.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              <details>
                <summary className="cursor-pointer">
                  Coverage and raw report
                </summary>
                <p>{report.faceSpace}</p>
                <ul className="list-disc pl-5">
                  {report.limitations.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(report, null, 2)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}
