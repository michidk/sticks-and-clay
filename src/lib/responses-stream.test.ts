import { describe, expect, test } from "bun:test";
import { dropProgressEvents } from "./responses-stream";

describe("dropProgressEvents", () => {
  test("drops gateway keepalives and keeps every other event across chunk splits", async () => {
    const created =
      'event: response.created\ndata: {"type":"response.created","response":{"id":"r1","created_at":1,"model":"m"}}\n\n';
    const keepalive =
      'data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_keepalive","status":"in_progress"}}\n\n';
    const delta =
      'data: {"type":"response.output_text.delta","item_id":"i","delta":"hi"}\r\n\r\n';
    const done = "data: [DONE]\n\n";
    const text = created + keepalive + delta + done;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < text.length; i += 7) {
          controller.enqueue(encoder.encode(text.slice(i, i + 7)));
        }
        controller.close();
      },
    });
    const output = await new Response(dropProgressEvents(body)).text();
    expect(output).toBe(
      `${created}data: {"type":"response.output_text.delta","item_id":"i","delta":"hi"}\n\n${done}`,
    );
  });
});
