import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
const handle = async ({ request }: { request: Request }) =>
  (await import("../../lib/api.server")).api(request);
export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: handle, POST: handle, PUT: handle } },
});
