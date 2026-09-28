CREATE TABLE "explore_items" (
	"generation" integer NOT NULL,
	"position" integer NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	CONSTRAINT "explore_items_generation_position_pk" PRIMARY KEY("generation","position")
);
--> statement-breakpoint
ALTER TABLE "explore_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "explore_runs" (
	"generation" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "explore_runs_generation_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"as_of" timestamp with time zone NOT NULL,
	"formula" smallint NOT NULL,
	"candidates" integer NOT NULL,
	"items" integer NOT NULL,
	"took_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explore_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_in_explore" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "explore_items" ADD CONSTRAINT "explore_items_generation_explore_runs_generation_fk" FOREIGN KEY ("generation") REFERENCES "public"."explore_runs"("generation") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_items" ADD CONSTRAINT "explore_items_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_items" ADD CONSTRAINT "explore_items_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "explore_items_generation_post_idx" ON "explore_items" USING btree ("generation","post_id");--> statement-breakpoint
CREATE INDEX "likes_created_brin" ON "likes" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX "reposts_created_brin" ON "reposts" USING brin ("created_at");--> statement-breakpoint
CREATE POLICY "explore_items_api_all" ON "explore_items" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "explore_runs_api_all" ON "explore_runs" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
