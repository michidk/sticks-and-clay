import { test, expect } from "bun:test";
import viewRender from "../../eve/agent/tools/view_render";
test("render pixels are a vision file part, never base64 text", () => {
  const output = viewRender.toModelOutput!({
    view: "front",
    image: "YWJj",
  }) as any;
  expect(output.type).toBe("content");
  expect(output.value[1].type).toBe("file");
  expect(output.value[1].mediaType).toBe("image/png");
  expect(output.value[0].text).not.toContain("YWJj");
});
