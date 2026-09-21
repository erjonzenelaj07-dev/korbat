ALTER TABLE "post_media" ALTER COLUMN "post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "position" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "width" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "height" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ALTER COLUMN "blurhash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" DROP COLUMN "path";