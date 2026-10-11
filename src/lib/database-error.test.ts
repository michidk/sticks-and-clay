import { test, expect } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { databaseErrorResponse } from "./database-error";

test("database failures return 503 without exposing SQL or parameters", () => {
  const error = new DrizzleQueryError(
    "select secret from projects",
    ["private-value"],
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:55439"), {
      code: "ECONNREFUSED",
    }),
  );
  const response = databaseErrorResponse(error)!;
  expect(response.status).toBe(503);
  expect(response.body.code).toBe("DATABASE_UNAVAILABLE");
  expect(JSON.stringify(response)).not.toMatch(
    /select|private-value|127\.0\.0\.1/,
  );
});
test("ordinary request errors keep their existing handling", () => {
  expect(
    databaseErrorResponse(new Error("Project name is required")),
  ).toBeNull();
});
