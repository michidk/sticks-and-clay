// Builds the read-only demo for Vercel (.vercel/output) from demo/fixtures.json and demo/files.
import { cp, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const client = await PGlite.create("memory://");
await migrate(drizzle(client), { migrationsFolder: resolve("drizzle") });
const tables: Record<string, unknown[]> = JSON.parse(await readFile(resolve("demo/fixtures.json"), "utf8"));
await client.exec("set session_replication_role = replica"); // rows arrive in table order, not foreign-key order
for (const [table, rows] of Object.entries(tables))
  await client.query(`insert into "${table}" select * from jsonb_populate_recordset(null::"${table}", $1::jsonb)`, [JSON.stringify(rows)]);
const snapshot = new Uint8Array(await (await client.dumpDataDir("gzip")).arrayBuffer());
await client.close();

const build = Bun.spawnSync(["bunx", "vite", "build"], {
  env: { ...process.env, STUDIO_EDITION: "demo" },
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode) process.exit(build.exitCode);

const fn = resolve(".vercel/output/functions/__server.func");
await mkdir(resolve(fn, "_libs"), { recursive: true });
await Bun.write(resolve(fn, "_libs/demo-db.tar.gz"), snapshot);
for (const file of ["pglite.data", "pglite.wasm"])
  await cp(resolve("node_modules/@electric-sql/pglite/dist", file), resolve(fn, "_libs", file));
// The function's working directory is its root, so this becomes the default data directory.
await cp(resolve("demo/files"), resolve(fn, "data"), { recursive: true });
