ALTER TABLE "assets" DROP CONSTRAINT "assets_batchId_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_batchId_batches_id_fk" FOREIGN KEY ("batchId") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;