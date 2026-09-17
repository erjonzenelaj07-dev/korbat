ALTER TABLE "profiles" ADD COLUMN "follower_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "following_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "post_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "repost_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reply_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "quote_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "bookmarks_user_created_idx" ON "bookmarks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "likes_user_created_idx" ON "likes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_quote_of_idx" ON "posts" USING btree ("quote_of_id");--> statement-breakpoint
CREATE INDEX "reposts_user_created_idx" ON "reposts" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_counts_nonnegative" CHECK ("profiles"."follower_count" >= 0 and "profiles"."following_count" >= 0 and "profiles"."post_count" >= 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_counts_nonnegative" CHECK ("posts"."like_count" >= 0 and "posts"."repost_count" >= 0 and "posts"."reply_count" >= 0 and "posts"."quote_count" >= 0);