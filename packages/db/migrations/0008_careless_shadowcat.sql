DROP INDEX "blocks_to_idx";--> statement-breakpoint
DROP INDEX "follows_to_idx";--> statement-breakpoint
DROP INDEX "mutes_to_idx";--> statement-breakpoint
DROP INDEX "posts_reply_to_idx";--> statement-breakpoint
CREATE INDEX "blocks_to_created_idx" ON "blocks" USING btree ("blocked_id","created_at","blocker_id");--> statement-breakpoint
CREATE INDEX "blocks_from_created_idx" ON "blocks" USING btree ("blocker_id","created_at","blocked_id");--> statement-breakpoint
CREATE INDEX "follows_to_created_idx" ON "follows" USING btree ("followee_id","created_at","follower_id");--> statement-breakpoint
CREATE INDEX "follows_from_created_idx" ON "follows" USING btree ("follower_id","created_at","followee_id");--> statement-breakpoint
CREATE INDEX "mutes_to_created_idx" ON "mutes" USING btree ("muted_id","created_at","muter_id");--> statement-breakpoint
CREATE INDEX "mutes_from_created_idx" ON "mutes" USING btree ("muter_id","created_at","muted_id");--> statement-breakpoint
CREATE INDEX "posts_reply_to_created_idx" ON "posts" USING btree ("reply_to_id","created_at","id");--> statement-breakpoint
CREATE INDEX "posts_latest_idx" ON "posts" USING btree ("created_at","id") WHERE reply_to_id is null and state = 'visible';