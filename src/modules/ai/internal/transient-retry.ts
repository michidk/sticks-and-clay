import { setTimeout as delay } from "node:timers/promises";

/** DNS failures happen before a request can reach the provider. */
export function isDnsFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return ["EAI_AGAIN", "ENOTFOUND"].includes(code ?? "") ||
    /getaddrinfo\s+(?:ETIMEOUT|EAI_AGAIN|ENOTFOUND)\b/.test(error.message);
}

export function isTransientTextFailure(error: unknown): boolean {
  if (isDnsFailure(error)) return true;
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number; statusCode?: number }).status ??
    (error as Error & { statusCode?: number }).statusCode;
  return [429, 500, 502, 503, 504].includes(status ?? 0) ||
    /server_is_overloaded|servers are currently overloaded|\b(?:429|502|503|504)\b/.test(error.message);
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  retryable: (error: unknown) => boolean,
  options: { signal?: AbortSignal; wait?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<T> {
  const wait = options.wait ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try { return await operation(); }
    catch (error) {
      if (options.signal?.aborted || attempt >= 2 || !retryable(error)) throw error;
      await wait(1000 * 2 ** attempt + Math.floor(Math.random() * 500), options.signal);
    }
  }
}
