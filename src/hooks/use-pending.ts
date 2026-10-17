import { useRef, useState } from "react";

/** Tracks in-flight actions by key, so each control disables only itself and the rest stay usable. */
export function usePending() {
  // The ref guards against a second click before React re-renders; the state drives disabling.
  const inFlight = useRef(new Set<string>());
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  async function run(key: string, task: () => Promise<unknown>) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setKeys(new Set(inFlight.current));
    try {
      await task();
    } finally {
      inFlight.current.delete(key);
      setKeys(new Set(inFlight.current));
    }
  }
  return { has: (key: string) => keys.has(key), run };
}
