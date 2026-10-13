import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "../src/db/client";
await migrate(db, { migrationsFolder: "./drizzle" });
await sql.end();
