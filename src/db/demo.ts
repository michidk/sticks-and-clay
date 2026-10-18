// Replaces ./client in the demo edition: an in-memory PGlite restored from the build-time snapshot.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

const client = await PGlite.create({
  dataDir: "memory://",
  loadDataDir: new Blob([await readFile(new URL(/* @vite-ignore */ "../_libs/demo-db.tar.gz", import.meta.url))]),
});
export const sql = client.sql.bind(client);
export const db = drizzle(client, { schema });
