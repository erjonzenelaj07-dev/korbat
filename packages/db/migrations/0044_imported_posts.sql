ALTER TABLE "post_media" ADD COLUMN "imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "import_job_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "import_job_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "import_source" "import_source";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "original_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "import_shortened" boolean;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "import_key" "bytea";--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_media_import_job_idx" ON "post_media" USING btree ("import_job_id","id") WHERE import_job_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_import_key_idx" ON "posts" USING btree ("author_id","import_key") WHERE import_key is not null;--> statement-breakpoint
CREATE INDEX "posts_import_job_idx" ON "posts" USING btree ("import_job_id","id") WHERE import_job_id is not null;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_import_link" CHECK ("post_media"."import_job_id" is null or "post_media"."imported");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_import_columns" CHECK (("posts"."import_job_id" is null) = ("posts"."import_source" is null) and ("posts"."import_job_id" is null) = ("posts"."original_created_at" is null) and ("posts"."import_job_id" is null) = ("posts"."import_shortened" is null) and ("posts"."import_job_id" is null) = ("posts"."import_key" is null));
--> statement-breakpoint
-- Everything below is written by hand (3b design, sections 6.2 to 6.4, 6.7 and 8.5; Task 2), in the conventions of 0043:
-- every function is owned by the migrator, pins its search path to public and pg_temp, names every object
-- schema-qualified and has EXECUTE taken from PUBLIC and given to nobody (each new one is a plain trigger function); a
-- guard's refusal is import_column under SQLSTATE 42501; each new trigger skips the migrator (current_user =
-- 'korbat_migrate'); enum values are compared as text.
--
-- The index on post_media.import_job_id above is not in the design's 6.3 (the orchestrator's ruling, an amendment): the
-- foreign key's set null when a job row goes, and Task 5's reads and deletes of an import's unattached rows by their job,
-- would each scan post_media without it.
--
-- 1. The grants (6.4). The API role gains UPDATE of the five import columns of posts (0015's column grants named seven);
-- posts_import_guard decides what an update may do with them, which is only to clear them. It still holds no DELETE on
-- posts. post_media's two new columns are named by its INSERT, a table privilege, and by no UPDATE grant, so neither
-- changes after the insert; the foreign key's set null runs as the table's owner.
GRANT UPDATE ("import_job_id", "import_source", "original_created_at", "import_shortened", "import_key") ON "public"."posts" TO korbat_api;--> statement-breakpoint

-- 2. posts_import_guard, plain, BEFORE INSERT OR UPDATE OF the five import columns, for every role but the migrator
-- (6.2). Only a statement that names one of the five meets it, so a counter's update (every like, repost and reply) never
-- runs it; an insert always does.
--   - An insert with import_job_id set must name a job whose owner is the post's author, whose state is publishing and
--     whose source is the post's import_source; the post's original_created_at lies between IMPORT_RULES.earliestDate at
--     UTC midnight and IMPORT_RULES.futureDays after the job's created_at; it quotes nothing; and a reply answers a post of
--     the same job. The job's row is taken FOR SHARE and read again in a statement of its own (the publisher holds it FOR
--     UPDATE already, 6.5, so this costs it nothing). A parent written by the same multi-row insert is seen when its row
--     comes first: a row-level BEFORE trigger's queries see the rows its statement wrote before. A native insert names
--     none of the five; posts_import_columns refuses one that names some.
--   - An update may change the five only to null, all at once, and only on a row whose state the statement makes, or
--     leaves, deleted_by_author (the author's deletion, the undo, the purge): no update ever sets them.
-- By name it runs after posts_guard_insert on an insert, and after posts_guard_update on an update.
CREATE FUNCTION "public"."posts_import_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  job public.import_jobs;
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.import_job_id IS NULL THEN
      RETURN NEW;
    END IF;
    PERFORM 1 FROM public.import_jobs j WHERE j.id = NEW.import_job_id FOR SHARE;
    SELECT j.* INTO job FROM public.import_jobs j WHERE j.id = NEW.import_job_id;
    IF job.id IS NULL OR job.owner_id IS DISTINCT FROM NEW.author_id OR job.status::text <> 'publishing'
       OR job.source::text IS DISTINCT FROM NEW.import_source::text
       OR NEW.original_created_at < timestamptz '2006-03-21 00:00:00+00'
       OR NEW.original_created_at > job.created_at + make_interval(days => 1)
       OR NEW.quote_of_id IS NOT NULL
       OR (NEW.reply_to_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.id = NEW.reply_to_id AND p.import_job_id = NEW.import_job_id)) THEN
      RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.import_job_id IS NOT DISTINCT FROM OLD.import_job_id AND NEW.import_source::text IS NOT DISTINCT FROM OLD.import_source::text
     AND NEW.original_created_at IS NOT DISTINCT FROM OLD.original_created_at AND NEW.import_shortened IS NOT DISTINCT FROM OLD.import_shortened
     AND NEW.import_key IS NOT DISTINCT FROM OLD.import_key THEN
    RETURN NEW;
  END IF;
  IF NEW.import_job_id IS NOT NULL OR NEW.import_source IS NOT NULL OR NEW.original_created_at IS NOT NULL OR NEW.import_shortened IS NOT NULL
     OR NEW.import_key IS NOT NULL OR NEW.state::text <> 'deleted_by_author' THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."posts_import_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "posts_import_guard" BEFORE INSERT OR UPDATE OF "import_job_id", "import_source", "original_created_at", "import_shortened", "import_key" ON "public"."posts"
  FOR EACH ROW EXECUTE FUNCTION "public"."posts_import_guard"();--> statement-breakpoint

-- 3. post_media_import_insert, plain, BEFORE INSERT, for every role but the migrator (6.3): an imported upload names a
-- job whose owner is the row's owner and whose state is preparing (the feeder's, 7.4), taken FOR SHARE and read again in
-- a statement of its own, so an insert that meets a stop in flight waits for it and is then refused; a native upload names
-- no job (post_media_import_link holds the same for the migrator). By name it runs before post_media_insert, which forces
-- the moderation columns and refuses a row that names a post.
CREATE FUNCTION "public"."post_media_import_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  job_owner uuid;
  job_status text;
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.imported IS NOT TRUE THEN
    IF NEW.import_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.import_jobs j WHERE j.id = NEW.import_job_id FOR SHARE;
  SELECT j.owner_id, j.status::text INTO job_owner, job_status FROM public.import_jobs j WHERE j.id = NEW.import_job_id;
  IF job_owner IS DISTINCT FROM NEW.owner_id OR job_status IS DISTINCT FROM 'preparing' THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_import_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_import_insert" BEFORE INSERT ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_import_insert"();--> statement-breakpoint

-- 4. post_media_import_attach, plain, BEFORE UPDATE OF post_id, for every role but the migrator (6.3): an imported image
-- is attached only to a post whose import_job_id is its own. One whose job row went (its import_job_id set null) is
-- attached to no post. A native image is left to the rules it had: post_media_guard (its owner's post) and
-- post_media_attached_is_complete (a description), which hold for imported ones as well.
CREATE FUNCTION "public"."post_media_import_attach"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.imported AND NEW.post_id IS NOT NULL AND NEW.post_id IS DISTINCT FROM OLD.post_id
     AND (NEW.import_job_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.id = NEW.post_id AND p.import_job_id = NEW.import_job_id)) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_import_attach"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_import_attach" BEFORE UPDATE OF "post_id" ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_import_attach"();--> statement-breakpoint

-- 5. decision_actions_check, replaced (0032). Everything 0016, 0021, 0025, 0028 and 0032 say of it stands, stated again
-- in full, with one change in the basis flood (3b design, section 8.5): the count of the subject's posts in the last
-- flood_minutes, the floor under an admin's finding of a spam flood, counts only posts with import_job_id null. An import
-- is published at once by design (decision 9) and reaches no feed, so it is no flood. The text is 0032's, from its line
-- 27 to its line 484, byte for byte, but for that one clause (import-schema.test.ts holds it so). The API's own count,
-- standing.flood in apps/api/src/moderation/standing-repo.ts, gains the same clause in Task 6. CREATE OR REPLACE keeps
-- the function's owner and its grants.
CREATE OR REPLACE FUNCTION "public"."decision_actions_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  c public.cases;
  subject uuid;
  is_measure boolean;
  lifted public.action_kind[];
  target uuid;
  target_decision public.decisions;
  decider_role text;
  post_state public.post_state;
  post_level public.moderation_level;
  image_state public.media_moderation_state;
  profile public.profiles;
  rules record;
  max_days integer;
  basis_decision uuid;
  earlier_decision uuid;
  ladder_count integer;
  ladder_decisions uuid[];
  newest_strike_at timestamptz;
  newest_rule text;
  last_ladder_at timestamptz;
  rungs_used integer;
  ladder_holds boolean := false;
  reports_sent integer;
  reports_marked integer;
  warning_decision uuid;
  warning_told timestamptz;
  -- 3f: the order a disable_by_order gives effect to, and whether a notice about the case's post is held.
  ord public.legal_orders;
  held boolean;
BEGIN
  -- 1.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  IF NOT FOUND OR d.xact IS DISTINCT FROM pg_current_xact_id() OR d.decided_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A measure or a reversal is added only in the transaction of its own decision.';
  END IF;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;

  -- 2.
  NEW.subject_account_id := NULL;
  NEW.post_id := NULL;
  NEW.reverses_action_id := NULL;
  NEW.no_effect := NULL;
  NEW.created_at := now();
  NEW.basis := NULL;
  NEW.rests_on := NULL;
  NEW.starts_at := NULL;
  NEW.ends_at := NULL;
  IF NEW.kind NOT IN ('suspend', 'restrict_reporting') THEN
    NEW.days := NULL;
  END IF;
  IF NEW.kind NOT IN ('suspend', 'terminate', 'restrict_reporting') THEN
    NEW.announced := NULL;
  END IF;
  NEW.replaced := CASE WHEN NEW.kind = 'lift_suspension' THEN coalesce(NEW.replaced, false) END;
  -- 3f: the withholding is forced below for a disable_by_order alone, and only a reinstatement names its ground.
  NEW.withhold_author := NULL;
  IF NEW.kind <> 'reinstate_by_order' THEN
    NEW.order_ground := NULL;
  END IF;
  IF NEW.kind IN ('seal_media', 'unseal_media') THEN
    NEW.media_id := NULL;
  END IF;
  IF c.target_type = 'post' THEN
    SELECT p.author_id INTO subject FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    subject := c.target_id;
  END IF;
  IF subject IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case''s target does not exist.';
  END IF;
  NEW.subject_account_id := subject;
  IF NEW.kind IN ('withhold', 'remove', 'restore', 'withhold_media', 'remove_media', 'restore_media', 'disable_by_order', 'reinstate_by_order') THEN
    NEW.post_id := c.target_id;
  END IF;
  is_measure := NEW.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                             'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order');

  -- 3.
  IF (NEW.post_id IS NOT NULL AND c.target_type <> 'post')
     OR (NEW.kind IN ('reset_display_name', 'reset_bio', 'restore_display_name', 'restore_bio') AND c.target_type <> 'account') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Post and image measures belong to a post case, field measures to an account case.';
  END IF;
  IF (NEW.kind IN ('strike', 'overrule') AND c.target_type <> 'post')
     OR (NEW.kind IN ('suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'lift_suspension', 'unretire_handle', 'lift_reporting') AND c.target_type <> 'account') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A strike and its overruling belong to a post case, the account measures and their reversals to an account case.';
  END IF;
  IF NOT (CASE d.kind
            WHEN 'interim' THEN NEW.kind IN ('withhold', 'withhold_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media')
            WHEN 'final' THEN NEW.kind IN ('remove', 'remove_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media',
                                           'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting')
            -- 3f: an order decision holds disable_by_order and nothing else, and no other decision holds it.
            WHEN 'order' THEN NEW.kind = 'disable_by_order'
            ELSE NOT is_measure END) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision of this kind does not hold this measure or reversal.';
  END IF;
  IF NEW.kind = 'disable_by_order' AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision holds exactly one disable_by_order.';
  END IF;
  IF NEW.kind = 'reinstate_by_order' AND (NEW.order_ground IS NULL OR d.kind <> 'correction') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A reinstatement after an order is a correction and names its ground.';
  END IF;
  IF NEW.kind = 'overrule' AND d.outcome <> 'reversed' THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A strike falls only with its whole finding: it is overruled only by a review or a correction that reverses the decision.';
  END IF;
  IF NEW.kind = 'retire_handle' AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The retirement of a handle is its decision''s first measure.';
  END IF;
  IF (NEW.kind = 'suspend' AND (NEW.days IS NULL OR NEW.announced IS NULL))
     OR (NEW.kind = 'terminate' AND NEW.announced IS NULL)
     OR (NEW.kind = 'restrict_reporting' AND (NEW.days IS NULL OR NEW.announced IS DISTINCT FROM false)) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A suspension names its days and whether it is announced, a termination whether it is announced, a restriction of reporting its days and that it is not announced.';
  END IF;
  IF (NEW.kind IN ('suspend', 'terminate') AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'seal_media'))
     OR (NEW.kind = 'seal_media' AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind IN ('suspend', 'terminate'))) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision that seals holds no suspension or termination: each has a decision, a statement and an appeal of its own.';
  END IF;
  IF NEW.kind IN ('withhold', 'remove') AND EXISTS (
       SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind IN ('withhold', 'remove')) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision holds at most one post measure.';
  END IF;
  IF NEW.kind IN ('withhold_media', 'remove_media', 'restore_media') THEN
    IF NEW.media_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = NEW.media_id AND m.post_id = c.target_id) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An image measure names an image of the case''s post.';
    END IF;
  ELSIF NEW.media_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Only an image measure names an image.';
  END IF;

  -- 4.
  IF c.target_type = 'post' THEN
    PERFORM 1 FROM public.posts p WHERE p.id = c.target_id FOR UPDATE;
  END IF;

  -- 5.
  IF d.kind = 'interim' AND NEW.kind IN ('withhold', 'withhold_media') AND EXISTS (
       SELECT 1 FROM public.measures_in_force m
        WHERE m.case_id = c.id AND m.decision_kind = 'interim' AND m.kind = NEW.kind AND m.media_id IS NOT DISTINCT FROM NEW.media_id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case already holds this interim measure in force.';
  END IF;

  -- 6.
  IF NOT is_measure THEN
    lifted := CASE NEW.kind
                WHEN 'restore' THEN ARRAY['withhold', 'remove']
                WHEN 'unseal_media' THEN ARRAY['seal_media']
                WHEN 'restore_media' THEN ARRAY['withhold_media', 'remove_media']
                WHEN 'restore_display_name' THEN ARRAY['reset_display_name']
                WHEN 'overrule' THEN ARRAY['strike']
                WHEN 'lift_suspension' THEN ARRAY['suspend', 'terminate']
                WHEN 'unretire_handle' THEN ARRAY['retire_handle']
                WHEN 'lift_reporting' THEN ARRAY['warn_reporting', 'restrict_reporting']
                WHEN 'reinstate_by_order' THEN ARRAY['disable_by_order']
                ELSE ARRAY['reset_bio'] END::public.action_kind[];
    IF d.kind IN ('review', 'correction') THEN
      SELECT a.id INTO target FROM public.decision_actions a
       WHERE a.decision_id = d.reviews_decision_id AND a.kind = ANY(lifted) AND a.media_id IS NOT DISTINCT FROM NEW.media_id;
    ELSE
      SELECT m.id INTO target FROM public.measures_in_force m
       WHERE m.case_id = c.id AND m.decision_kind = 'interim' AND m.media_id IS NOT DISTINCT FROM NEW.media_id
         AND m.kind = CASE NEW.kind WHEN 'restore' THEN 'withhold' ELSE 'withhold_media' END::public.action_kind;
    END IF;
    IF target IS NULL OR NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = target) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A reversal lifts a measure that is in force.';
    END IF;
    NEW.reverses_action_id := target;
  END IF;

  -- 7.
  IF NEW.kind = 'seal_media' AND NOT (d.suspect AND (d.rule_id IS NOT DISTINCT FROM 'R2' OR d.category = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS')) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A seal needs a decision that rests on a suspect item, under R2 or in the category Protection of minors.';
  END IF;

  -- 8. The subject's row is held FOR SHARE since decisions_record, so the lock order holds. 3f (row 13): an order about a
  -- staff member's post is given effect like any other.
  IF is_measure AND public.account_is_staff(subject) AND d.kind NOT IN ('interim', 'order') THEN
    RAISE EXCEPTION 'staff_target';
  END IF;

  -- 9. The deciding account's row is held FOR SHARE since decisions_record; this reads the same row again.
  IF NEW.kind IN ('unseal_media', 'reinstate_by_order') THEN
    UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;
    SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = d.decided_by FOR SHARE;
    IF decider_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
  END IF;

  -- 3f: a disable_by_order withholds from the author exactly when its order does (the order's row is held FOR SHARE
  -- since decisions_record), so signed params can never show a held notice's post to its author.
  IF NEW.kind = 'disable_by_order' THEN
    SELECT x.* INTO ord FROM public.legal_orders x JOIN public.legal_order_items i ON i.order_id = x.id WHERE i.id = d.order_item_id;
    NEW.withhold_author := ord.withhold_from_author;
  END IF;

  -- 9a. A standing measure.
  IF NEW.kind IN ('suspend', 'terminate') THEN
    SELECT k.* INTO rules FROM public.standing_rules() k;
    -- 9a.1. Free when the API holds the row FOR UPDATE, as it does for these decisions.
    PERFORM 1 FROM public.profiles p WHERE p.id = subject FOR UPDATE;
    -- 9a.2. A statement of its own after the lock: one standing measure at a time, one with no start yet included.
    IF EXISTS (SELECT 1 FROM public.standing_live s WHERE s.account_id = subject) THEN
      RAISE EXCEPTION 'standing_conflict';
    END IF;
    -- 9a.3 and 9a.4. The basis: the first row of the table that fits the decision's own columns.
    IF d.rule_id IS NOT DISTINCT FROM 'R2' THEN
      -- A seal for good of the subject's images (a seal of a final decision about the account or one of its posts) in
      -- force, at most basis_age_days old, on which no protective suspension, standing or lifted, has rested yet.
      IF NEW.kind = 'suspend' AND NOT NEW.announced THEN
        SELECT m.decision_id INTO basis_decision
          FROM public.measures_in_force m JOIN public.decisions x ON x.id = m.decision_id
         WHERE m.kind = 'seal_media' AND m.decision_kind = 'final' AND m.subject_account_id = subject
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND x.informed_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions p WHERE p.kind = 'suspend' AND p.basis = 'protective' AND m.decision_id = ANY(p.rests_on))
         ORDER BY x.decided_at DESC, x.id DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'protective';
          NEW.rests_on := ARRAY[basis_decision];
          max_days := rules.protective_days;
        END IF;
      END IF;
      IF NEW.basis IS NULL THEN
        IF NEW.kind = 'terminate' THEN
          RAISE EXCEPTION 'ground_not_established';
        END IF;
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'basis: under R2 only a protective suspension at once is open, on a seal for good no protective suspension rested on.';
      END IF;
    ELSIF d.ground IS NOT DISTINCT FROM 'illegal' THEN
      IF NEW.kind = 'suspend' AND NOT NEW.announced AND d.category_keyword IS NOT DISTINCT FROM 'KEYWORD_TERRORIST_CONTENT' THEN
        SELECT x.id INTO basis_decision
          FROM public.decisions x JOIN public.cases xc ON xc.id = x.case_id AND xc.target_type = 'post'
          JOIN public.posts xp ON xp.id = xc.target_id AND xp.author_id = subject
         WHERE x.kind = 'final' AND x.outcome = 'restricted' AND x.ground = 'illegal' AND x.category_keyword = 'KEYWORD_TERRORIST_CONTENT'
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND x.informed_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = x.id)
         ORDER BY x.decided_at DESC, x.id DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'terrorist';
          NEW.rests_on := ARRAY[basis_decision];
          max_days := rules.terrorist_days;
        END IF;
      END IF;
      IF NEW.basis IS NULL THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'basis: on the law only a suspension at once on terrorist content is open, on a final decision that found it in a post of the account.';
      END IF;
    ELSE
      IF d.rule_id = 'R5' AND NEW.kind = 'suspend' AND NOT NEW.announced THEN
        SELECT x.id INTO basis_decision
          FROM public.decisions x JOIN public.cases xc ON xc.id = x.case_id AND xc.target_type = 'post'
          JOIN public.posts xp ON xp.id = xc.target_id AND xp.author_id = subject
         WHERE x.kind = 'final' AND x.outcome = 'restricted' AND x.rule_id = 'R5'
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND x.informed_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = x.id)
         ORDER BY x.decided_at DESC, x.id DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'threat';
          NEW.rests_on := ARRAY[basis_decision];
          max_days := rules.threat_days;
        END IF;
      ELSIF d.rule_id = 'R5' AND NEW.kind = 'terminate' AND NOT NEW.announced THEN
        -- A suspension of the subject on the basis threat that stands, whose basis holds and that was decided within
        -- ladder_memory_days, and a final R5 decision as above about a post made after that suspension's decision was told.
        SELECT a.rests_on[1], x.id INTO earlier_decision, basis_decision
          FROM public.decision_actions a
          JOIN public.decisions ad ON ad.id = a.decision_id
          JOIN public.posts xp ON xp.author_id = subject AND xp.created_at > ad.informed_at
          JOIN public.cases xc ON xc.target_type = 'post' AND xc.target_id = xp.id
          JOIN public.decisions x ON x.case_id = xc.id
         WHERE a.subject_account_id = subject AND a.kind = 'suspend' AND a.basis = 'threat'
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
           AND public.standing_basis_broken_at(a.id) IS NULL
           AND ad.decided_at >= now() - make_interval(days => rules.ladder_memory_days)
           AND x.kind = 'final' AND x.outcome = 'restricted' AND x.rule_id = 'R5'
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND x.informed_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = x.id)
         ORDER BY x.decided_at DESC, x.id DESC, ad.decided_at DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'threat_repeat';
          NEW.rests_on := ARRAY[earlier_decision, basis_decision];
        END IF;
      ELSIF d.rule_id = 'R6' AND NEW.kind = 'suspend' AND NOT NEW.announced THEN
        -- The count is a floor under the admin's finding, which the decision's facts state, and never the finding.
        IF (SELECT count(*) FROM public.posts p WHERE p.author_id = subject AND p.created_at > now() - make_interval(mins => rules.flood_minutes) AND p.import_job_id IS NULL) >= rules.flood_posts THEN
          NEW.basis := 'flood';
          max_days := rules.flood_days;
        END IF;
      END IF;
      IF NEW.basis IS NULL AND NEW.announced THEN
        -- The ladder. The subject's active strikes, oldest first, and the rule of the newest.
        SELECT count(*), coalesce(array_agg(s.decision_id ORDER BY s.created_at, s.action_id), '{}'::uuid[]), max(s.created_at)
          INTO ladder_count, ladder_decisions, newest_strike_at
          FROM public.active_strikes s WHERE s.account_id = subject;
        SELECT x.rule_id INTO newest_rule
          FROM public.active_strikes s JOIN public.decisions x ON x.id = s.decision_id
         WHERE s.account_id = subject ORDER BY s.created_at DESC, s.action_id DESC LIMIT 1;
        SELECT max(a.created_at) INTO last_ladder_at FROM public.decision_actions a
         WHERE a.subject_account_id = subject AND a.kind IN ('suspend', 'terminate') AND a.basis IN ('strikes', 'ladder_end')
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id);
        SELECT count(*) INTO rungs_used FROM public.decision_actions a JOIN public.decisions ad ON ad.id = a.decision_id
         WHERE a.subject_account_id = subject AND a.kind = 'suspend' AND a.basis = 'strikes'
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
           AND public.standing_basis_broken_at(a.id) IS NULL
           AND ad.decided_at >= now() - make_interval(days => rules.ladder_memory_days);
        ladder_holds := ladder_count >= rules.ladder_strikes
                        AND (last_ladder_at IS NULL OR newest_strike_at > last_ladder_at)
                        AND d.rule_id IS NOT DISTINCT FROM newest_rule;
        IF ladder_holds AND NEW.kind = 'suspend' THEN
          NEW.basis := 'strikes';
          NEW.rests_on := ladder_decisions;
          max_days := rules.ladder_days[least(rungs_used + 1, cardinality(rules.ladder_days))];
        ELSIF ladder_holds AND NEW.kind = 'terminate' AND rungs_used >= cardinality(rules.ladder_days) THEN
          NEW.basis := 'ladder_end';
          NEW.rests_on := ladder_decisions;
        END IF;
      END IF;
      IF NEW.basis IS NULL THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'basis: none fits. A measure at once needs its ground (R5 threat or second threat, R6 flood); an announced one the ladder.';
      END IF;
    END IF;
    -- 9a.5.
    IF NEW.kind = 'suspend' AND NEW.days > max_days THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = format('days: at most %s on the basis %s.', max_days, NEW.basis);
    END IF;
    -- 9a.6.
    NEW.starts_at := CASE WHEN NEW.announced THEN now() + make_interval(hours => rules.reply_window_hours) ELSE now() END;
    -- 9a.7. The deciding account's row is held FOR SHARE since decisions_record; this reads the same row again.
    IF NOT NEW.announced OR NEW.kind = 'terminate' THEN
      UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;
      SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = d.decided_by FOR SHARE;
      IF decider_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'admin_required';
      END IF;
    END IF;
    -- 9a.8. Findings only: such a measure judges nothing a report in this case named.
    IF NEW.basis IN ('strikes', 'protective', 'ladder_end') AND EXISTS (
         SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id WHERE i.answered_by = d.id AND n.kind = 'user') THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'open_reports';
    END IF;
  END IF;

  -- 9b. A strike.
  IF NEW.kind = 'strike' THEN
    SELECT k.* INTO rules FROM public.standing_rules() k;
    PERFORM 1 FROM public.profiles p WHERE p.id = subject FOR NO KEY UPDATE;
    NEW.ends_at := now() + make_interval(days => rules.strike_days);
  END IF;

  -- 9c. A warning and a restriction of reporting (3e design, section 6.3). The counts are of reports (intakes): a report
  -- is marked when one of its items holds a mark that counts, which is a mark whose report was sent on a UTC day within
  -- report_frame_days, that no correction withdrew, and whose item no re-examination ended in a restriction. The view
  -- reporting_record is the reporting counts' migration's: PL/pgSQL resolves it only when this branch runs, which no
  -- route allows before that migration exists. The refusal open_reports comes first, before any count is read.
  IF NEW.kind IN ('warn_reporting', 'restrict_reporting') THEN
    SELECT k.* INTO rules FROM public.standing_rules() k;
    IF d.rule_id IS DISTINCT FROM 'R6' THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A warning or a restriction of reporting cites R6.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id WHERE i.answered_by = d.id AND n.kind = 'user') THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'open_reports';
    END IF;
    IF NEW.kind = 'warn_reporting' THEN
      SELECT r.reports, r.unfounded INTO reports_sent, reports_marked FROM public.reporting_record r WHERE r.account_id = subject;
      IF coalesce(reports_marked, 0) < rules.report_warn_marks OR coalesce(reports_marked, 0) < rules.report_warn_share * coalesce(reports_sent, 0) THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'warning: the account''s marked reports are below the threshold.';
      END IF;
      IF EXISTS (SELECT 1 FROM public.decision_actions w WHERE w.subject_account_id = subject AND w.kind = 'warn_reporting' AND w.ends_at > now()
                    AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = w.id)) THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'warning: a warning of the account still counts.';
      END IF;
      NEW.basis := 'reports';
      NEW.ends_at := now() + make_interval(days => rules.report_frame_days);
    ELSE
      SELECT w.decision_id, wd.informed_at INTO warning_decision, warning_told
        FROM public.decision_actions w JOIN public.decisions wd ON wd.id = w.decision_id
       WHERE w.subject_account_id = subject AND w.kind = 'warn_reporting' AND w.ends_at > now()
         AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = w.id)
       ORDER BY w.created_at DESC, w.id DESC LIMIT 1;
      IF warning_decision IS NULL THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restriction: the account has no warning that still counts.';
      END IF;
      -- Reports the person sent after korbat told them of the warning, never reports sent before it and decided after.
      SELECT count(DISTINCT m.intake_id) INTO reports_marked
        FROM public.unfounded_marks m
       WHERE m.account_id = subject AND m.reported_at > warning_told AND m.withdrawn_by IS NULL
         AND EXISTS (SELECT 1 FROM public.intake_items o WHERE o.id = m.item_id AND o.outcome_sent_at IS NOT NULL)
         AND (m.reported_at AT TIME ZONE 'UTC')::date > (now() AT TIME ZONE 'UTC')::date - rules.report_frame_days
         AND NOT EXISTS (SELECT 1 FROM public.intake_items x WHERE x.reexamines_item_id = m.item_id AND x.outcome IN ('restricted_rule', 'restricted_legal'));
      IF reports_marked < rules.report_restrict_marks THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restriction: too few marked reports sent since the warning.';
      END IF;
      IF NEW.days > rules.report_restrict_days THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = format('days: at most %s for a restriction of reporting.', rules.report_restrict_days);
      END IF;
      IF EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.subject_account_id = subject AND x.kind = 'restrict_reporting'
                    AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = x.id)
                    AND public.standing_basis_broken_at(x.id) IS NULL AND x.starts_at + make_interval(days => x.days) > now()) THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restriction: a restriction of the account''s reports still runs.';
      END IF;
      NEW.basis := 'reports';
      NEW.rests_on := ARRAY[warning_decision];
      NEW.starts_at := now();
    END IF;
  END IF;

  -- 10.
  IF is_measure AND NEW.kind NOT IN ('seal_media', 'strike') THEN
    IF c.target_type = 'post' THEN
      SELECT p.state, p.moderation_level INTO post_state, post_level FROM public.posts p WHERE p.id = c.target_id;
      IF post_state = 'deleted_by_author' THEN
        NEW.no_effect := 'deleted';
      ELSIF NEW.kind = 'withhold' THEN
        NEW.no_effect := CASE WHEN post_level <> 'visible' THEN 'already' END;
      ELSIF NEW.kind = 'remove' THEN
        NEW.no_effect := CASE WHEN post_level IN ('removed', 'disabled') THEN 'already' END;
      ELSIF NEW.kind = 'disable_by_order' THEN
        NEW.no_effect := CASE WHEN post_level = 'disabled' OR (post_level = 'removed' AND NOT NEW.withhold_author) THEN 'already' END;
      ELSE
        SELECT m.moderation_state INTO image_state FROM public.post_media m WHERE m.id = NEW.media_id;
        NEW.no_effect := CASE WHEN post_level <> 'visible'
                                OR (NEW.kind = 'withhold_media' AND image_state <> 'visible')
                                OR (NEW.kind = 'remove_media' AND image_state IN ('removed', 'sealed')) THEN 'already' END;
      END IF;
    ELSE
      SELECT p.* INTO profile FROM public.profiles p WHERE p.id = subject;
      IF profile.deleted_at IS NOT NULL THEN
        NEW.no_effect := 'deleted';
      ELSIF (NEW.kind = 'reset_display_name' AND profile.display_name = profile.handle) OR (NEW.kind = 'reset_bio' AND profile.bio = '') THEN
        NEW.no_effect := 'already';
      ELSIF NEW.kind = 'retire_handle' AND EXISTS (
              SELECT 1 FROM public.evidence_snapshots s JOIN public.handle_history h ON h.handle_lower = lower(s.handle)
               WHERE s.id = d.snapshot_id AND h.retired_at IS NOT NULL) THEN
        NEW.no_effect := 'already';
      END IF;
    END IF;
  END IF;

  -- 11.
  IF target IS NOT NULL THEN
    SELECT x.* INTO target_decision FROM public.decisions x JOIN public.decision_actions a ON a.decision_id = x.id WHERE a.id = target;
    IF target_decision.kind = 'interim' AND target_decision.author_mail <> 'none' THEN
      -- 3f: a statement of its own; on a post whose order's notice is held the telling this makes owed is held too.
      held := c.target_type = 'post' AND public.order_notice_held(c.target_id);
      UPDATE public.decisions x
         SET ended_interim = true,
             author_mail = CASE WHEN x.author_mail = 'none' AND NOT held THEN 'pending'::public.delivery_state ELSE x.author_mail END,
             informed_at = CASE WHEN x.author_mail = 'none' AND held THEN NULL ELSE x.informed_at END
       WHERE x.id = d.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
