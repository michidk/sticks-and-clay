import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
export const sql = postgres(
  process.env.DATABASE_URL ||
    "postgres://studio:studio_local@127.0.0.1:55439/studio",
  { max: 8 },
);
export const db = drizzle(sql, { schema });
