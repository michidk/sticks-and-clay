import { expect, test } from "bun:test";
import { Bash } from "just-bash";

test("sandbox rejects oversized floating-point precision without losing the session", async () => {
  const bash = new Bash();
  for (const type of ["e", "f", "g"]) {
    const result = await bash.exec(`awk 'BEGIN { printf "%.1000${type}", 1 }'`);
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("precision limit exceeded");
  }
  expect(await bash.exec("echo healthy")).toMatchObject({
    exitCode: 0,
    stdout: "healthy\n",
  });
});
