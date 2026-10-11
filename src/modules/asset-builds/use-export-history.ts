import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { request, json } from "../../lib/client";

/** Keep loaded content while polling; only active jobs schedule another read. */
export function useExportHistory<T extends { status: string }>(
  path: string,
  schema: z.ZodType<T>,
) {
  const [saved, setSaved] = useState<T[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await request<unknown>(path);
        if (!Array.isArray(value)) throw new Error("Invalid export history");
        const next = value.map((item) => schema.parse(item));
        if (active) {
          setSaved(next);
          setLoading(false);
          setError("");
          if (
            next.some(
              (job) => !["done", "failed", "cancelled"].includes(job.status),
            )
          )
            timer = setTimeout(load, 2500);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [path, schema, revision]);
  async function action(path: string) {
    await request(path, json({}));
    refresh();
  }
  return { saved, loading, error, refresh, action };
}
