import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
// Vite can reload server modules many times; retain one pool per process.
const runtime = globalThis as typeof globalThis & {
  studioSql?: ReturnType<typeof postgres>;
};
export const sql = (runtime.studioSql ??= postgres(
  process.env.DATABASE_URL ||
    "postgres://studio:studio_local@127.0.0.1:55439/studio",
  { max: 8 },
));
export const db = drizzle(sql, { schema });
