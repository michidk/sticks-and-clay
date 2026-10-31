import { expect, test } from "bun:test";
import { chat } from "@tanstack/ai";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { roles } from "./roles";

function checkObjects(value: unknown, path = "schema") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkObjects(entry, `${path}[${index}]`));
    return;
  }
  if ("type" in value && (value.type === "object" || (Array.isArray(value.type) && value.type.includes("object")))) {
    expect(value, path).toHaveProperty("additionalProperties", false);
    if ("properties" in value && value.properties && typeof value.properties === "object") {
      expect(value, path).toHaveProperty("required", expect.arrayContaining(Object.keys(value.properties)));
    }
  }
  Object.entries(value).forEach(([key, entry]) => checkObjects(entry, `${path}.${key}`));
}

for (const [name, role] of Object.entries(roles)) {
  if (role.engine !== "tanstack") continue;
  test(`${name} provider request closes every object and requires every property`, async () => {
    let captured: unknown;
    const adapter = createOpenaiChat("gpt-5", "fixture", {
      fetch: async (_url, init) => {
        captured = JSON.parse(String(init?.body));
        throw new Error("Captured provider request");
      },
      maxRetries: 0,
    });
    await expect(chat({ adapter, messages: [{ role: "user", content: "Draw a pickaxe" }], outputSchema: role.schema, stream: false })).rejects.toThrow();
    expect(captured).toHaveProperty("text.format.schema.type", "object");
    checkObjects(captured);
  });
}
