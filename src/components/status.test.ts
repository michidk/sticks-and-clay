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

test("asset versions read as waiting for review until the owner accepts them", () => {
  expect(statusInfo("done", null, false)).toEqual({ tone: "warning", label: "Ready for review" });
  expect(statusInfo("done", "approved", false)).toEqual({ tone: "done", label: "Approved" });
  expect(statusInfo("done", "limit_reached", false).label).toBe("Completed with issues");
  expect(statusInfo("done", "limit_reached", true)).toEqual({ tone: "done", label: "Done" });
  expect(statusInfo("running", null, false).tone).toBe("running");
});
