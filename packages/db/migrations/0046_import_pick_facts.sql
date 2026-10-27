-- 3b Task 4 (the orchestrator's ruling of 2026-10-26; design, sections 6.1, 9.2 and 9.3): what reading an import needs
-- without opening a work file. import_jobs.images records once, at the creation, whether the import brings images (the
-- preview's media route and job.json read it); import_picks gains the picked line's month, marks (IMPORT_MARKS as four
-- bits) and the number of its images its source described (at most MEDIA_MAX_PER_POST), from which the picks' counts
-- of ImportView and ImportPickView are summed. Written by drizzle from the schema; nothing is written by hand but this
-- comment. No grant changes: 0043 granted the API role SELECT and INSERT on both tables as a whole, which covers the
-- new columns, and UPDATE only of named columns, which leaves these four unchangeable after the insert, as a line's
-- facts and an import's choice of images are. import_jobs_insert forces only the columns it names, so the insert's
-- `images` stands. No row of import_picks exists before this task's code writes one, so its NOT NULL columns need no
-- default for an upgrade.
ALTER TABLE "import_jobs" ADD COLUMN "images" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "import_picks" ADD COLUMN "month" text NOT NULL;--> statement-breakpoint
ALTER TABLE "import_picks" ADD COLUMN "marks" smallint NOT NULL;--> statement-breakpoint
ALTER TABLE "import_picks" ADD COLUMN "described" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_picks" ADD CONSTRAINT "import_picks_month" CHECK ("import_picks"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
ALTER TABLE "import_picks" ADD CONSTRAINT "import_picks_marks" CHECK ("import_picks"."marks" between 0 and 15);--> statement-breakpoint
ALTER TABLE "import_picks" ADD CONSTRAINT "import_picks_described" CHECK ("import_picks"."described" between 0 and 4);
