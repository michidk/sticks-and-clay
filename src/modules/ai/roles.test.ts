import { expect, test } from "bun:test";
import { z } from "zod";
import { roles } from "./roles";

for (const [name, role] of Object.entries(roles)) {
  if (role.engine !== "tanstack") continue;
  test(`${name} structured output avoids unsupported oneOf alternatives`, () => {
    expect(JSON.stringify(z.toJSONSchema(role.schema))).not.toContain('"oneOf"');
  });
}
