/**
 * Removes `response.in_progress` events from a Responses API SSE stream.
 * Some OpenAI-compatible gateways emit them as keepalives with only `id` and
 * `status`, which the AI SDK's chunk schema rejects, failing the whole step.
 * The SDK takes response metadata from `response.created`, so nothing it uses
 * is lost.
 */
export function dropProgressEvents(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const keep = (event: string) =>
    !/^data:\s*\{.*"type"\s*:\s*"response\.in_progress"/m.test(event);
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder
          .decode(chunk, { stream: true })
          .replace(/\r\n/g, "\n");
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          if (keep(event)) controller.enqueue(encoder.encode(`${event}\n\n`));
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer && keep(buffer)) controller.enqueue(encoder.encode(buffer));
      },
    }),
  );
}

/**
 * `fetch` for the model provider that filters event streams through
 * `dropProgressEvents`. Asserted because Bun's `fetch` type also carries
 * `preconnect`, which a request wrapper does not need.
 */
export const responsesFetch = (async (input, init) => {
  const response = await fetch(input, init);
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    return response;
  }
  return new Response(dropProgressEvents(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}) as typeof fetch;
