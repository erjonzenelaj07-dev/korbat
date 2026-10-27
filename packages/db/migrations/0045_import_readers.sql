-- 3b (design, sections 6.2 and 6.7; Task 2): the readers' indexes, written by drizzle from the schema and kept apart
-- from 0044 so that their builds over a large posts table run in a migration of their own (the README's upgrade notes
-- name it as the slow one). posts_imported_idx serves the profile's Imported tab; posts_author_native_idx the author's
-- native posts (Following's own branch, the Posts and Replies tabs); posts_latest_idx is dropped and created again with
-- `and import_job_id is null` added to its predicate, so Latest never reads an imported post. Nothing here is written by
-- hand but this comment.
DROP INDEX "posts_latest_idx";--> statement-breakpoint
CREATE INDEX "posts_imported_idx" ON "posts" USING btree ("author_id","original_created_at","id") WHERE import_job_id is not null and reply_to_id is null;--> statement-breakpoint
CREATE INDEX "posts_author_native_idx" ON "posts" USING btree ("author_id","created_at","id") WHERE import_job_id is null;--> statement-breakpoint
CREATE INDEX "posts_latest_idx" ON "posts" USING btree ("created_at","id") WHERE reply_to_id is null and state = 'visible' and import_job_id is null;
