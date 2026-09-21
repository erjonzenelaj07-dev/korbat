CREATE TYPE "public"."media_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "status" "media_status" DEFAULT 'processing' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_media_owner_created_idx" ON "post_media" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "post_media_status_created_idx" ON "post_media" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_ready_has_dims" CHECK ("post_media"."status" <> 'ready' or ("post_media"."width" is not null and "post_media"."height" is not null and "post_media"."blurhash" is not null));--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_attached_is_complete" CHECK ("post_media"."post_id" is null or ("post_media"."status" = 'ready' and "post_media"."position" between 0 and 3 and "post_media"."alt_text" is not null));--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_alt_len" CHECK (char_length("post_media"."alt_text") <= 1000);