import { runExportProcess } from "../asset-builds/index.server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { extractMeshes } from "./extract";
import { loadRuntimeSettings } from "../../lib/runtime-settings.server";
const execute = promisify(execFile);

/** Advisory only; partial reports survive expensive-check failures. Logged in judge input. */
export async function analyzeModel(path: string) {
  const settings = await loadRuntimeSettings();
  let directory: string | undefined;
  let sha256: string | undefined;
  let reportPath: string | undefined;
  const unavailable: string[] = [];
  try {
    const bytes = await readFile(path);
    sha256 = createHash("sha256").update(bytes).digest("hex");
    const extracted = await extractMeshes(bytes);
    unavailable.push(...extracted.unavailable);
    directory = await mkdtemp(resolve(tmpdir(), "studio-analysis-"));
    const raw = resolve(directory, "raw.json");
    const topology = resolve(directory, "topology.json");
    reportPath = resolve(directory, "report.json");
    await writeFile(
      raw,
      JSON.stringify(extracted.objects, (_key, value) =>
        typeof value === "number" && !Number.isFinite(value)
          ? String(value)
          : value,
      ),
    );
    let input = raw;
    try {
      await runExportProcess(
        process.env.BLENDER_BIN || "blender",
        [
          "--background",
          "--factory-startup",
          "--python-exit-code",
          "1",
          "--python",
          resolve("blender/analyze_extract.py"),
          "--",
          raw,
          topology,
        ],
        directory,
        settings.timeouts.analysisBlenderMs,
      );
      input = topology;
    } catch {
      unavailable.push(
        "BMesh topology unavailable; raw geometry and UV checks still run",
      );
    }
    await execute(
      process.env.ANALYSIS_PYTHON ||
        process.env.STUDIO_PYTHON ||
        resolve(
          process.platform === "win32"
            ? ".venv/Scripts/python.exe"
            : ".venv/bin/python",
        ),
      [resolve("blender/analyze_mesh.py"), input, reportPath],
      { timeout: settings.timeouts.analysisPythonMs, maxBuffer: 1024 * 1024 },
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    return {
      ...report,
      unavailable: [...unavailable, ...report.unavailable],
      sha256,
    };
  } catch (error) {
    unavailable.push(
      `Deterministic analysis incomplete (${(error as NodeJS.ErrnoException).code || "execution failed or timed out"})`,
    );
    const partial = reportPath
      ? await readFile(reportPath, "utf8")
          .then(JSON.parse)
          .catch(() => undefined)
      : undefined;
    return {
      version: 2,
      findings: [],
      ...partial,
      sha256,
      unavailable: [...unavailable, ...(partial?.unavailable || [])],
    };
  } finally {
    if (directory)
      await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
