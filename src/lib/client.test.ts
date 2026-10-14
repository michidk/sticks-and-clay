import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { request } from "./client";

const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

test("HTML gateway failures retain their HTTP status instead of throwing a JSON parse error", async () => {
  fetchSpy.mockResolvedValue(new Response("<!DOCTYPE html><title>Bad Gateway</title>", {
    status: 502, headers: { "Content-Type": "text/html" },
  }));
  await expect(request("projects/example")).rejects.toThrow("Request failed (HTTP 502)");
});

test("JSON API failures retain their actionable message", async () => {
  fetchSpy.mockResolvedValue(Response.json({ error: "Design changed. Reload." }, { status: 409 }));
  await expect(request("projects/example")).rejects.toThrow("Design changed. Reload.");
});

test("successful JSON responses are returned", async () => {
  fetchSpy.mockResolvedValue(Response.json({ projects: [] }));
  expect(await request<{ projects: unknown[] }>("projects")).toEqual({ projects: [] });
});
