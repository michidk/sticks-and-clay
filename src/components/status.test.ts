import { expect, test } from "bun:test";
import { statusInfo } from "./status";

test("maps workflow statuses and verdicts to one tone and label", () => {
  expect(statusInfo("queued")).toEqual({ tone: "queued", label: "Queued" });
  expect(statusInfo("designing").tone).toBe("running");
  expect(statusInfo("running").tone).toBe("running");
  expect(statusInfo("done")).toEqual({ tone: "done", label: "Complete" });
  expect(statusInfo("done", "approved").label).toBe("Approved");
  expect(statusInfo("done", "limit_reached")).toEqual({
    tone: "warning",
    label: "Completed with issues",
  });
  expect(statusInfo("failed").tone).toBe("failed");
  expect(statusInfo("cancelled").tone).toBe("queued");
  expect(statusInfo("review").label).toBe("Review design");
});
