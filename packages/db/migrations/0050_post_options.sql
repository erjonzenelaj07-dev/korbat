ALTER TABLE "profiles" ADD COLUMN "share_previews" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "hide_counts" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Everything below is written by hand (2d design, sections 6.4 and 6.6; Task 1): the API role's UPDATE of the two new
-- columns, beside the column grants 0015 and 0044 gave on posts and 0020 on profiles. INSERT is a table privilege of both
-- tables, so a new post's hide_counts needs no grant of its own. hide_counts (decision 26) is set by the post's author in
-- the composer or from the post's More menu, share_previews (decision 21) by the person's switch on Settings, Privacy.
-- Neither has a trigger: what a suspended account may change (hide counts and turn previews off, never the reverse; 9.2)
-- is the writing statement's, under 3e's predicate. korbat_auth and korbat_notify hold nothing on either table.
GRANT UPDATE ("hide_counts") ON "public"."posts" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("share_previews") ON "public"."profiles" TO korbat_api;
