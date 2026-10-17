import { expect, test } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration("asset migration preserves identities, multi-result work, forks, queued planners and checkpoints", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  const admin = postgres(url.toString(), { max: 1 });
  const database = `asset_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  const directory = await mkdtemp(join(tmpdir(), "asset-migration-"));
  let client: ReturnType<typeof postgres> | undefined;
  try {
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    client = postgres(url.toString(), { max: 1 });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 23);
    await mkdir(join(directory, "meta"));
    await writeFile(join(directory, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    await migrate(drizzle(client), { migrationsFolder: directory });
    await client.unsafe(`
      INSERT INTO projects(id,name,description) VALUES ('p','Migration fixture','test');
      INSERT INTO batches(id,"projectId",prompt,count,"judgeIterations",design,"designVersion",status) VALUES
        ('b','p','Two lamps',2,0,'Original design',1,'done'), ('iteration','p','Taller',1,0,'Original design',1,'done'),
        ('fork','p','Another lamp',1,0,'Original design',1,'done'), ('queued','p','Three chairs',3,2,'Original design',1,'planning');
      INSERT INTO model_ideas(id,"projectId",title,input,"batchId") VALUES
        ('idea','p','My lamps','{"prompt":"Two lamps","count":2,"judgeIterations":0,"imageSize":"1024x1024"}','b'),
        ('pending','p','My chairs','{"prompt":"Three chairs","count":3,"judgeIterations":2,"imageSize":"1024x1024"}','queued'),
        ('draft','p','Draft','{"prompt":"Two switches","count":2,"judgeIterations":0,"imageSize":"1024x1024"}',NULL);
      INSERT INTO models(id,"projectId","batchId",name,prompt,status,created_at) VALUES
        ('root1','p','b','Lamp one','First lamp','done','2026-01-01'),('root2','p','b','Lamp two','Second lamp','done','2026-01-02');
      INSERT INTO models(id,"projectId","batchId",name,prompt,parent_model_id,branch_kind,status) VALUES
        ('child','p','iteration','Lamp taller','Taller','root1','iterate','done'),('forked','p','fork','Lamp cousin','Different','root1','fork','done');
      INSERT INTO jobs(id,kind,"targetId",checkpoint,status) VALUES ('job','plan','queued','{"agent:planner":"run-original","planner-references":"[\\"references/original.png\\"]"}','failed');
    `);
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    const versions = await client`SELECT id, asset_id FROM asset_versions ORDER BY id`;
    expect(versions.map((row) => row.id)).toEqual(["child", "forked", "root1", "root2"]);
    expect(versions.find((row) => row.id === "root1")?.asset_id).toBe("idea");
    expect(versions.find((row) => row.id === "child")?.asset_id).toBe("idea");
    expect(versions.find((row) => row.id === "root2")?.asset_id).toBe("root2");
    expect(versions.find((row) => row.id === "forked")?.asset_id).toBe("forked");
    expect((await client`SELECT count(*)::int AS count FROM assets WHERE "batchId"='queued'`)[0].count).toBe(3);
    expect((await client`SELECT count(*)::int AS count FROM assets WHERE in_idea`)[0].count).toBe(2);
    expect((await client`SELECT checkpoint FROM jobs WHERE id='job'`)[0].checkpoint).toEqual({ "agent:planner": "run-original", "planner-references": '["references/original.png"]' });
    await client`INSERT INTO asset_versions(id,"projectId","batchId",name,prompt,parent_model_id,branch_kind) VALUES ('next','p','iteration','Next','Next','child','iterate')`;
    expect((await client`SELECT asset_id FROM asset_versions WHERE id='next'`)[0].asset_id).toBe("idea");
    expect((await client`SELECT count(*)::int AS count FROM asset_versions WHERE asset_id IS NULL`)[0].count).toBe(0);
  } finally {
    await client?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
