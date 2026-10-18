declare const __STUDIO_DEMO_MODE__: boolean;

/** The read-only public demo edition; compiled in by `bun run build:demo`, never a runtime switch. */
export const DEMO_MODE = typeof __STUDIO_DEMO_MODE__ === "boolean" ? __STUDIO_DEMO_MODE__ : false;
