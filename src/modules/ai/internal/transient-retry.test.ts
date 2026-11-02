import { expect, test } from "bun:test";
import { isDnsFailure, isTransientTextFailure, retryTransient } from "./transient-retry";

test("DNS classification excludes ambiguous delivery and request timeouts", () => {
  expect(isDnsFailure(new TypeError("getaddrinfo ETIMEOUT omniroute"))).toBe(true);
  expect(isDnsFailure(Object.assign(new Error("lookup failed"), { code: "EAI_AGAIN" }))).toBe(true);
  for (const error of [new Error("fetch failed"), new Error("ETIMEDOUT"), new Error("socket closed"), new Error("HTTP 500")])
    expect(isDnsFailure(error)).toBe(false);
});

test("temporary text failures are distinguished from validation, auth and cancellation", () => {
  expect(isTransientTextFailure(new Error("Our servers are currently overloaded. Please try again later."))).toBe(true);
  expect(isTransientTextFailure(Object.assign(new Error("unavailable"), { status: 503 }))).toBe(true);
  for (const error of [new Error("invalid schema"), Object.assign(new Error("unauthorized"), { status: 401 }), new DOMException("cancelled", "AbortError")])
    expect(isTransientTextFailure(error)).toBe(false);
});

test("retry recovers, backs off and stops after three attempts", async () => {
  let calls = 0;
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  const failure = new Error("getaddrinfo ETIMEOUT omniroute");
  expect(await retryTransient(async () => {
    if (++calls < 3) throw failure;
    return "recovered";
  }, isDnsFailure, { wait })).toBe("recovered");
  expect(calls).toBe(3);
  expect(waits[0]).toBeGreaterThanOrEqual(1000);
  expect(waits[1]).toBeGreaterThanOrEqual(2000);
  calls = 0;
  await expect(retryTransient(async () => { calls++; throw failure; }, isDnsFailure, { wait })).rejects.toBe(failure);
  expect(calls).toBe(3);
});

test("permanent failures and cancellation do not trigger another call", async () => {
  let calls = 0;
  await expect(retryTransient(async () => { calls++; throw new Error("HTTP 500"); }, isDnsFailure)).rejects.toThrow("HTTP 500");
  expect(calls).toBe(1);
  const controller = new AbortController();
  await expect(retryTransient(async () => {
    calls++;
    throw new Error("getaddrinfo ETIMEOUT omniroute");
  }, isDnsFailure, { signal: controller.signal, wait: async () => { controller.abort(); } })).rejects.toThrow();
  expect(calls).toBe(2);
});
