import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const execute = promisify(execFile);

/** Advisory only; no quality gate. Included in the persisted judge input. */
export async function analyzeModel(path: string) {
  let directory: string | undefined;
  let sha256: string | undefined;
  try {
    sha256 = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    directory = await mkdtemp(resolve(tmpdir(), "studio-analysis-"));
    const extracted = resolve(directory, "mesh.json");
    const report = resolve(directory, "report.json");
    await execute(
      process.env.BLENDER_BIN || "blender",
      [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        resolve("blender/analyze_extract.py"),
        "--",
        path,
        extracted,
      ],
      { timeout: 90_000, maxBuffer: 1024 * 1024 },
    );
    await execute(
      process.env.ANALYSIS_PYTHON || resolve(".venv/bin/python"),
      [resolve("blender/analyze_mesh.py"), extracted, report],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const findings = JSON.parse(await readFile(report, "utf8"));
    return { ...findings, sha256 };
  } catch (error) {
    // Do not turn infrastructure failure into a clean bill of health or a failed build.
    return {
      version: 1,
      sha256,
      findings: [],
      unavailable: [
        `Deterministic analysis unavailable (${(error as NodeJS.ErrnoException).code || "execution failed or timed out"})`,
      ],
    };
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
