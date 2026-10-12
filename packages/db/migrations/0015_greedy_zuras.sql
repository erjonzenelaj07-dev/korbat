CREATE TYPE "public"."media_moderation_state" AS ENUM('visible', 'withheld', 'removed', 'sealed');--> statement-breakpoint
CREATE TYPE "public"."moderation_level" AS ENUM('visible', 'withheld', 'removed');--> statement-breakpoint
CREATE TYPE "public"."access_kind" AS ENUM('case_opened', 'image_viewed', 'identity_revealed');--> statement-breakpoint
CREATE TYPE "public"."action_kind" AS ENUM('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio', 'restore', 'unseal_media', 'restore_media', 'restore_display_name', 'restore_bio');--> statement-breakpoint
CREATE TYPE "public"."appeal_result" AS ENUM('kept', 'partly_reversed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."decision_ground" AS ENUM('incompatible', 'illegal');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('interim', 'final', 'review', 'correction');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('restricted', 'no_violation', 'not_evident', 'kept', 'partly_reversed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."decision_source" AS ENUM('notice', 'report', 'own_initiative');--> statement-breakpoint
CREATE TYPE "public"."delivery_state" AS ENUM('pending', 'sent', 'folded', 'suppressed', 'no_address', 'none', 'failed');--> statement-breakpoint
CREATE TYPE "public"."intake_channel" AS ENUM('signed_in', 'signed_out', 'staff');--> statement-breakpoint
CREATE TYPE "public"."intake_kind" AS ENUM('user', 'finding');--> statement-breakpoint
CREATE TYPE "public"."item_outcome" AS ENUM('restricted_rule', 'restricted_legal', 'no_violation', 'not_evident', 'not_available', 'partly_reversed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."moderation_target" AS ENUM('post', 'account');--> statement-breakpoint
CREATE TYPE "public"."staff_text_kind" AS ENUM('facts', 'reason', 'legal_reference', 'review_reason', 'reveal_reason', 'note', 'seal_declined');--> statement-breakpoint
CREATE TABLE "auth"."notifier_confirmations" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."notifier_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."notifier_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_enc" text,
	"email_enc" text,
	"email_hash" text,
	"mail_token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forget_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."notifier_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."notifier_suppressions" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."notifier_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."staff_personal_accounts" (
	"staff_user_id" uuid NOT NULL,
	"personal_user_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_personal_accounts_staff_user_id_personal_user_id_pk" PRIMARY KEY("staff_user_id","personal_user_id"),
	CONSTRAINT "staff_personal_accounts_differ" CHECK ("auth"."staff_personal_accounts"."staff_user_id" <> "auth"."staff_personal_accounts"."personal_user_id")
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_personal_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"appellant_account_id" uuid NOT NULL,
	"statement" text,
	"statement_salt" text,
	"statement_digest" text,
	"filed_at" timestamp with time zone NOT NULL,
	"answered_by" uuid,
	"result" "appeal_result",
	"answered_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "appeals_statement_len" CHECK (char_length("appeals"."statement") <= 2000),
	CONSTRAINT "appeals_statement" CHECK (("appeals"."statement" is null) = ("appeals"."statement_salt" is null) and ("appeals"."statement" is null or ("appeals"."erased_at" is null and "appeals"."statement_salt" ~ '^[0-9a-f]{64}$' and "appeals"."statement_digest" is not null and "appeals"."statement_digest" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode("appeals"."statement_salt", 'hex') || convert_to("appeals"."statement", 'UTF8')), 'hex'))) and ("appeals"."statement" is not null or "appeals"."statement_digest" is null or "appeals"."erased_at" is not null) and ("appeals"."statement_digest" is null or "appeals"."statement_digest" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "appeals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "case_access_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_access_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "access_kind" NOT NULL,
	"media_id" uuid,
	"intake_item_id" uuid,
	"text_id" uuid,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"lane" smallint DEFAULT 2 NOT NULL,
	"intake_seq" integer DEFAULT 0 NOT NULL,
	"answered_seq" integer DEFAULT 0 NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"oldest_open_at" timestamp with time zone,
	"last_decided_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "cases_lane" CHECK ("cases"."lane" between 0 and 2),
	CONSTRAINT "cases_seq_order" CHECK ("cases"."answered_seq" <= "cases"."intake_seq"),
	CONSTRAINT "cases_closed_answered" CHECK ("cases"."closed_at" is null or "cases"."answered_seq" = "cases"."intake_seq")
);
--> statement-breakpoint
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decision_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"kind" "action_kind" NOT NULL,
	"media_id" uuid,
	"subject_account_id" uuid NOT NULL,
	"post_id" uuid,
	"reverses_action_id" uuid,
	"no_effect" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decision_actions_once" UNIQUE NULLS NOT DISTINCT("decision_id","kind","media_id"),
	CONSTRAINT "decision_actions_no_effect" CHECK ("decision_actions"."no_effect" in ('already', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "decision_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "decision_kind" NOT NULL,
	"reviews_decision_id" uuid,
	"appeal_id" uuid,
	"seen_state_version" integer NOT NULL,
	"through_seq" integer DEFAULT 0 NOT NULL,
	"answers_from_seq" integer,
	"outcome" "decision_outcome" NOT NULL,
	"ground" "decision_ground",
	"rule_id" text,
	"rules_version" smallint NOT NULL,
	"redress_version" smallint NOT NULL,
	"category" text NOT NULL,
	"category_keyword" text,
	"source" "decision_source" NOT NULL,
	"automated_detection" boolean DEFAULT false NOT NULL,
	"automated_decision" text DEFAULT 'not_automated' NOT NULL,
	"territorial_scope" text DEFAULT 'worldwide' NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_digest" text NOT NULL,
	"facts_digest" text,
	"reason_digest" text,
	"legal_reference_digest" text,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"xact" "xid8" NOT NULL,
	"puid" text NOT NULL,
	"informed_at" timestamp with time zone NOT NULL,
	"suspect" boolean NOT NULL,
	"unseen" boolean DEFAULT false NOT NULL,
	"needs_admin" boolean NOT NULL,
	"ended_interim" boolean NOT NULL,
	"author_mail" "delivery_state" DEFAULT 'none' NOT NULL,
	"author_mail_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "decisions_puid_unique" UNIQUE("puid"),
	CONSTRAINT "decisions_rule_id" CHECK ("decisions"."rule_id" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')),
	CONSTRAINT "decisions_category" CHECK ("decisions"."category" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')),
	CONSTRAINT "decisions_category_keyword" CHECK ("decisions"."category_keyword" in ('KEYWORD_TERRORIST_CONTENT')),
	CONSTRAINT "decisions_automated_decision" CHECK ("decisions"."automated_decision" in ('fully', 'partially', 'not_automated')),
	CONSTRAINT "decisions_territorial_scope" CHECK ("decisions"."territorial_scope" = 'worldwide'),
	CONSTRAINT "decisions_review_target" CHECK (("decisions"."kind" in ('review', 'correction')) = ("decisions"."reviews_decision_id" is not null) and ("decisions"."kind" = 'review') = ("decisions"."appeal_id" is not null)),
	CONSTRAINT "decisions_interim" CHECK ("decisions"."kind" <> 'interim' or "decisions"."through_seq" = 0),
	CONSTRAINT "decisions_ground_rule" CHECK ("decisions"."ground" is distinct from 'incompatible' or "decisions"."rule_id" is not null),
	CONSTRAINT "decisions_ground_law" CHECK ("decisions"."ground" is distinct from 'illegal' or "decisions"."legal_reference_digest" is not null),
	CONSTRAINT "decisions_restricted" CHECK ("decisions"."outcome" <> 'restricted' or ("decisions"."ground" is not null and "decisions"."facts_digest" is not null and "decisions"."reason_digest" is not null)),
	CONSTRAINT "decisions_digests" CHECK (("decisions"."facts_digest" is null or "decisions"."facts_digest" ~ '^[0-9a-f]{64}$') and ("decisions"."reason_digest" is null or "decisions"."reason_digest" ~ '^[0-9a-f]{64}$') and ("decisions"."legal_reference_digest" is null or "decisions"."legal_reference_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "decisions_keyword" CHECK ("decisions"."category_keyword" is null or "decisions"."ground" is not distinct from 'illegal'),
	CONSTRAINT "decisions_law_no_rule" CHECK ("decisions"."ground" is distinct from 'illegal' or "decisions"."rule_id" is null),
	CONSTRAINT "decisions_reversal_plain" CHECK ("decisions"."kind" not in ('review', 'correction') or ("decisions"."ground" is null and "decisions"."rule_id" is null and "decisions"."category_keyword" is null and "decisions"."facts_digest" is null and "decisions"."legal_reference_digest" is null))
);
--> statement-breakpoint
ALTER TABLE "decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"author_handle" text NOT NULL,
	"post_state" "post_state",
	"post_created_at" timestamp with time zone,
	"reply_to_id" uuid,
	"quote_of_id" uuid,
	"body" text,
	"media" jsonb,
	"display_name" text,
	"bio" text,
	"handle" text,
	"salt" text,
	"digest" text NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "evidence_erased" CHECK ("evidence_snapshots"."erased_at" is null or ("evidence_snapshots"."body" is null and "evidence_snapshots"."media" is null and "evidence_snapshots"."display_name" is null and "evidence_snapshots"."bio" is null and "evidence_snapshots"."salt" is null))
);
--> statement-breakpoint
ALTER TABLE "evidence_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intake_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"media_id" uuid,
	"named_handle" text,
	"case_id" uuid,
	"seq" integer,
	"lane" smallint NOT NULL,
	"reporter_account_id" uuid,
	"alleges_illegal" boolean DEFAULT false NOT NULL,
	"suspect" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"outcome" "item_outcome",
	"answered_by" uuid,
	"outcome_sent_at" timestamp with time zone,
	"shown_outcome" "item_outcome",
	"revision_pending_at" timestamp with time zone,
	"revised_sent_at" timestamp with time zone,
	"outcome_mail" "delivery_state" DEFAULT 'none' NOT NULL,
	"reexamines_item_id" uuid,
	"statement" text,
	"statement_salt" text,
	"statement_digest" text,
	"erased_at" timestamp with time zone,
	CONSTRAINT "intake_items_position" CHECK ("intake_items"."position" between 1 and 20),
	CONSTRAINT "intake_items_lane" CHECK ("intake_items"."lane" between 0 and 2),
	CONSTRAINT "intake_items_case" CHECK (("intake_items"."case_id" is null) = ("intake_items"."seq" is null) and ("intake_items"."case_id" is not null or "intake_items"."outcome" is not distinct from 'not_available')),
	CONSTRAINT "intake_items_shown" CHECK ("intake_items"."shown_outcome" is null or "intake_items"."outcome_sent_at" is not null),
	CONSTRAINT "intake_items_named_handle" CHECK (("intake_items"."target_type" = 'account') = ("intake_items"."named_handle" is not null)),
	CONSTRAINT "intake_items_statement_len" CHECK (char_length("intake_items"."statement") <= 2000),
	CONSTRAINT "intake_items_statement" CHECK (("intake_items"."statement_digest" is null or "intake_items"."reexamines_item_id" is not null) and ("intake_items"."statement" is null) = ("intake_items"."statement_salt" is null) and ("intake_items"."statement" is null or ("intake_items"."erased_at" is null and "intake_items"."statement_salt" ~ '^[0-9a-f]{64}$' and "intake_items"."statement_digest" is not null and "intake_items"."statement_digest" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode("intake_items"."statement_salt", 'hex') || convert_to("intake_items"."statement", 'UTF8')), 'hex'))) and ("intake_items"."statement" is not null or "intake_items"."statement_digest" is null or "intake_items"."erased_at" is not null) and ("intake_items"."statement_digest" is null or "intake_items"."statement_digest" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "intake_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "intake_kind" NOT NULL,
	"ref" text NOT NULL,
	"lookup_hash" text,
	"channel" "intake_channel" NOT NULL,
	"reporter_id" uuid,
	"finding_by" uuid,
	"contact_id" uuid,
	"rule_id" text,
	"alleges_illegal" boolean DEFAULT false NOT NULL,
	"csam" boolean DEFAULT false NOT NULL,
	"category" text NOT NULL,
	"category_keyword" text,
	"cited_law" text,
	"explanation" text,
	"bona_fide" boolean DEFAULT false NOT NULL,
	"automated_processing" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"receipt" "delivery_state" DEFAULT 'none' NOT NULL,
	"receipt_sent_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "intakes_ref_unique" UNIQUE("ref"),
	CONSTRAINT "intakes_lookup_hash_unique" UNIQUE("lookup_hash"),
	CONSTRAINT "intakes_ref" CHECK ("intakes"."ref" ~ '^N-[A-Z2-7]{10}$'),
	CONSTRAINT "intakes_rule_id" CHECK ("intakes"."rule_id" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')),
	CONSTRAINT "intakes_category" CHECK ("intakes"."category" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')),
	CONSTRAINT "intakes_category_keyword" CHECK ("intakes"."category_keyword" in ('KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL', 'KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE', 'KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS')),
	CONSTRAINT "intakes_cited_law_len" CHECK (char_length("intakes"."cited_law") <= 300),
	CONSTRAINT "intakes_explanation_len" CHECK (char_length("intakes"."explanation") <= 2000),
	CONSTRAINT "intakes_has_ground" CHECK ("intakes"."rule_id" is not null or "intakes"."alleges_illegal" or "intakes"."csam"),
	CONSTRAINT "intakes_illegal_elements" CHECK ("intakes"."kind" <> 'user' or not "intakes"."alleges_illegal" or "intakes"."csam" or ("intakes"."bona_fide" and ("intakes"."explanation" is not null or "intakes"."erased_at" is not null))),
	CONSTRAINT "intakes_finding_legal" CHECK ("intakes"."kind" <> 'finding' or not "intakes"."alleges_illegal"),
	CONSTRAINT "intakes_illegal_not_tc" CHECK (not "intakes"."alleges_illegal" or "intakes"."category" <> 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC'),
	CONSTRAINT "intakes_csam" CHECK (not "intakes"."csam" or ("intakes"."category" = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' and "intakes"."reporter_id" is null and "intakes"."contact_id" is null)),
	CONSTRAINT "intakes_contact_signed_out" CHECK ("intakes"."contact_id" is null or "intakes"."channel" = 'signed_out'),
	CONSTRAINT "intakes_reporter_signed_in" CHECK ("intakes"."reporter_id" is null or "intakes"."channel" = 'signed_in'),
	CONSTRAINT "intakes_finding" CHECK (("intakes"."kind" = 'finding') = ("intakes"."finding_by" is not null) and ("intakes"."kind" = 'finding') = ("intakes"."channel" = 'staff')),
	CONSTRAINT "intakes_lookup" CHECK (("intakes"."lookup_hash" is not null) = ("intakes"."channel" = 'signed_out' or "intakes"."csam")),
	CONSTRAINT "intakes_erased" CHECK ("intakes"."erased_at" is null or ("intakes"."explanation" is null and "intakes"."cited_law" is null)),
	CONSTRAINT "intakes_r2_finding_only" CHECK ("intakes"."rule_id" is distinct from 'R2' or "intakes"."kind" = 'finding')
);
--> statement-breakpoint
ALTER TABLE "intakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media_holds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "media_holds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"media_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"until" timestamp with time zone,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "media_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "moderation_limits" (
	"id" smallint PRIMARY KEY NOT NULL,
	"decisions_per_hour" integer NOT NULL,
	"decisions_per_day" integer NOT NULL,
	"case_opens_per_day" integer NOT NULL,
	"findings_per_day" integer NOT NULL,
	"reveals_per_day" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "moderation_limits_single_row" CHECK ("moderation_limits"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "moderation_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seal_posts" (
	"action_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"images" smallint NOT NULL,
	CONSTRAINT "seal_posts_action_id_post_id_pk" PRIMARY KEY("action_id","post_id"),
	CONSTRAINT "seal_posts_images" CHECK ("seal_posts"."images" > 0)
);
--> statement-breakpoint
ALTER TABLE "seal_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "staff_text_kind" NOT NULL,
	"text" text,
	"salt" text,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decision_id" uuid,
	"confirmed_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "staff_texts_digest_unique" UNIQUE("digest"),
	CONSTRAINT "staff_texts_text_len" CHECK (char_length("staff_texts"."text") <= 5000),
	CONSTRAINT "staff_texts_digest" CHECK (("staff_texts"."text" is null) = ("staff_texts"."salt" is null) and ("staff_texts"."text" is null) = ("staff_texts"."erased_at" is not null) and ("staff_texts"."text" is null or ("staff_texts"."salt" ~ '^[0-9a-f]{64}$' and "staff_texts"."digest" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode("staff_texts"."salt", 'hex') || convert_to("staff_texts"."text", 'UTF8')), 'hex'))))
);
--> statement-breakpoint
ALTER TABLE "staff_texts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "moderation_state" "media_moderation_state" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderation_level" "moderation_level" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."staff_personal_accounts" ADD CONSTRAINT "staff_personal_accounts_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_personal_accounts" ADD CONSTRAINT "staff_personal_accounts_personal_user_id_users_id_fk" FOREIGN KEY ("personal_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_answered_by_decisions_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_log" ADD CONSTRAINT "case_access_log_staff_id_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_log" ADD CONSTRAINT "case_access_log_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_reverses_action_id_decision_actions_id_fk" FOREIGN KEY ("reverses_action_id") REFERENCES "public"."decision_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_reviews_decision_id_decisions_id_fk" FOREIGN KEY ("reviews_decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_appeal_id_appeals_id_fk" FOREIGN KEY ("appeal_id") REFERENCES "public"."appeals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_snapshot_id_evidence_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."evidence_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_snapshots" ADD CONSTRAINT "evidence_snapshots_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_answered_by_decisions_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_reexamines_item_id_intake_items_id_fk" FOREIGN KEY ("reexamines_item_id") REFERENCES "public"."intake_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_reporter_id_profiles_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_finding_by_profiles_id_fk" FOREIGN KEY ("finding_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_holds" ADD CONSTRAINT "media_holds_media_id_post_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."post_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_holds" ADD CONSTRAINT "media_holds_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_posts" ADD CONSTRAINT "seal_posts_action_id_decision_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."decision_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_texts" ADD CONSTRAINT "staff_texts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_texts" ADD CONSTRAINT "staff_texts_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_texts" ADD CONSTRAINT "staff_texts_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_once" ON "appeals" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "appeals_pending_idx" ON "appeals" USING btree ("decision_id") WHERE answered_by is null;--> statement-breakpoint
CREATE INDEX "appeals_statement_idx" ON "appeals" USING btree ("decision_id") WHERE statement is not null;--> statement-breakpoint
CREATE INDEX "case_access_log_staff_idx" ON "case_access_log" USING btree ("staff_id","at");--> statement-breakpoint
CREATE INDEX "case_access_log_case_idx" ON "case_access_log" USING btree ("case_id","at");--> statement-breakpoint
CREATE INDEX "case_access_log_reveals_idx" ON "case_access_log" USING btree ("at") WHERE kind = 'identity_revealed';--> statement-breakpoint
CREATE UNIQUE INDEX "cases_one_open_per_target" ON "cases" USING btree ("target_type","target_id") WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX "cases_queue_idx" ON "cases" USING btree ("lane","oldest_open_at") WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX "cases_target_idx" ON "cases" USING btree ("target_type","target_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_actions_reversed_once" ON "decision_actions" USING btree ("reverses_action_id") WHERE reverses_action_id is not null;--> statement-breakpoint
CREATE INDEX "decision_actions_post_kind_idx" ON "decision_actions" USING btree ("post_id","kind");--> statement-breakpoint
CREATE INDEX "decision_actions_subject_kind_idx" ON "decision_actions" USING btree ("subject_account_id","kind");--> statement-breakpoint
CREATE INDEX "decisions_case_decided_idx" ON "decisions" USING btree ("case_id","decided_at");--> statement-breakpoint
CREATE INDEX "decisions_decided_by_idx" ON "decisions" USING btree ("decided_by","decided_at");--> statement-breakpoint
CREATE INDEX "decisions_reviews_idx" ON "decisions" USING btree ("reviews_decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_appeal_once" ON "decisions" USING btree ("appeal_id") WHERE appeal_id is not null;--> statement-breakpoint
CREATE INDEX "evidence_snapshots_case_taken_idx" ON "evidence_snapshots" USING btree ("case_id","taken_at");--> statement-breakpoint
CREATE INDEX "evidence_snapshots_target_idx" ON "evidence_snapshots" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "evidence_snapshots_unerased_idx" ON "evidence_snapshots" USING btree ("case_id") WHERE erased_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_target_once" ON "intake_items" USING btree ("intake_id","target_type","target_id") WHERE reexamines_item_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_reexamines_once" ON "intake_items" USING btree ("reexamines_item_id") WHERE reexamines_item_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_case_seq_idx" ON "intake_items" USING btree ("case_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_reporter_once" ON "intake_items" USING btree ("case_id","reporter_account_id","alleges_illegal") WHERE reexamines_item_id is null;--> statement-breakpoint
CREATE INDEX "intake_items_answered_by_idx" ON "intake_items" USING btree ("answered_by");--> statement-breakpoint
CREATE INDEX "intake_items_suspect_open_idx" ON "intake_items" USING btree ("case_id") WHERE suspect and answered_by is null;--> statement-breakpoint
CREATE INDEX "intake_items_revision_idx" ON "intake_items" USING btree ("revision_pending_at") WHERE revision_pending_at is not null;--> statement-breakpoint
CREATE INDEX "intakes_reporter_idx" ON "intakes" USING btree ("reporter_id","received_at");--> statement-breakpoint
CREATE INDEX "intakes_finding_idx" ON "intakes" USING btree ("finding_by","received_at");--> statement-breakpoint
CREATE INDEX "intakes_unerased_idx" ON "intakes" USING btree ("received_at") WHERE erased_at is null;--> statement-breakpoint
CREATE INDEX "media_holds_media_idx" ON "media_holds" USING btree ("media_id") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "media_holds_case_idx" ON "media_holds" USING btree ("case_id") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "seal_posts_post_idx" ON "seal_posts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "staff_texts_open_idx" ON "staff_texts" USING btree ("case_id","author_id") WHERE confirmed_at is null and erased_at is null;--> statement-breakpoint
CREATE POLICY "notifier_confirmations_auth_all" ON "auth"."notifier_confirmations" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "notifier_contacts_auth_all" ON "auth"."notifier_contacts" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "notifier_suppressions_auth_all" ON "auth"."notifier_suppressions" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_personal_accounts_auth_none" ON "auth"."staff_personal_accounts" AS PERMISSIVE FOR SELECT TO "korbat_auth" USING (false);--> statement-breakpoint
CREATE POLICY "appeals_api_all" ON "appeals" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "case_access_log_api_all" ON "case_access_log" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "cases_api_all" ON "cases" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "decision_actions_api_all" ON "decision_actions" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "decisions_api_all" ON "decisions" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "evidence_snapshots_api_all" ON "evidence_snapshots" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "intake_items_api_all" ON "intake_items" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "intakes_api_all" ON "intakes" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "media_holds_api_all" ON "media_holds" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "moderation_limits_api_select" ON "moderation_limits" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (true);--> statement-breakpoint
CREATE POLICY "seal_posts_api_all" ON "seal_posts" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_texts_api_all" ON "staff_texts" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Everything below is written by hand (3c design, section 6.1), in the order the design gives. drizzle's migrator runs every
-- pending migration in one transaction, so a failure anywhere leaves no moderation table behind. Every function is owned by
-- the migrator, pins its search path, names every object schema-qualified and has EXECUTE taken from PUBLIC: a trigger
-- function fires for every role all the same, and the few that a role calls directly are granted to that role alone.
-- Errors carry their code as the message under SQLSTATE P0001 unless a SQLSTATE is named.
--
-- 1. The grants. 0001's default privileges gave the API role SELECT, INSERT, UPDATE and DELETE on every new public table
-- (never TRUNCATE, which each revoke names all the same). The moderation tables are append-only for it: it inserts and
-- reads, and the derived columns move only through migrator-owned triggers and functions.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."cases", "public"."intakes", "public"."intake_items", "public"."decisions", "public"."decision_actions", "public"."appeals", "public"."staff_texts", "public"."evidence_snapshots", "public"."case_access_log", "public"."media_holds" FROM korbat_api;--> statement-breakpoint
-- A seal's list is written only by a trigger, from the image rows it locked: the API role reads it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."seal_posts" FROM korbat_api;--> statement-breakpoint
-- The limits on staff are raised only by `staff.js limits`, as the migrator.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."moderation_limits" FROM korbat_api;--> statement-breakpoint
-- What the API role may still change: the state of the three kinds of mail it sends.
GRANT UPDATE ("receipt", "receipt_sent_at") ON "public"."intakes" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("outcome_mail") ON "public"."intake_items" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("author_mail", "author_mail_at") ON "public"."decisions" TO korbat_api;--> statement-breakpoint
-- post_media: the API role loses the table's UPDATE and gets back every column but the three that migrator-owned functions
-- write (moderation_state, hold_until, erased_at). Its updates name only the columns they set, so they keep working.
REVOKE UPDATE ON "public"."post_media" FROM korbat_api;--> statement-breakpoint
GRANT UPDATE ("status", "error", "post_id", "position", "width", "height", "blurhash", "alt_text", "nsfw_score") ON "public"."post_media" TO korbat_api;--> statement-breakpoint
-- posts: the same, for the seven columns the API writes; never moderation_level or erased_at.
REVOKE UPDATE ON "public"."posts" FROM korbat_api;--> statement-breakpoint
GRANT UPDATE ("body", "state", "deleted_at", "like_count", "repost_count", "reply_count", "quote_count") ON "public"."posts" TO korbat_api;--> statement-breakpoint
-- No code deletes a post or a profile, and now the API role cannot: a cascade into image rows is only ever the migrator's
-- or the superuser's, and the keep trigger below refuses one that meets a retained row.
REVOKE DELETE ON "public"."posts", "public"."profiles" FROM korbat_api;--> statement-breakpoint
-- 2. The forced-field triggers. Each is plain and writes only the row being inserted: whatever an insert supplied for a
-- forced column, the row gets the database's value, so the API role can neither choose nor forge it.
--
-- A case starts open and empty, in the least urgent lane: every column but id and the target is forced.
CREATE FUNCTION "public"."cases_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.opened_at := now();
  NEW.lane := 2;
  NEW.intake_seq := 0;
  NEW.answered_seq := 0;
  NEW.state_version := 0;
  NEW.oldest_open_at := NULL;
  NEW.last_decided_at := NULL;
  NEW.closed_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cases_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "cases_insert" BEFORE INSERT ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."cases_insert"();--> statement-breakpoint
-- An intake is received now and not erased; its receipt is pending when there is someone to mail (a notifier's contact, or
-- a signed-in reporter who alleged illegality) and none otherwise.
CREATE FUNCTION "public"."intakes_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.received_at := now();
  NEW.erased_at := NULL;
  NEW.receipt_sent_at := NULL;
  NEW.receipt := CASE WHEN NEW.contact_id IS NOT NULL OR (NEW.reporter_id IS NOT NULL AND NEW.alleges_illegal)
                      THEN 'pending'::public.delivery_state ELSE 'none'::public.delivery_state END;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."intakes_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "intakes_insert" BEFORE INSERT ON "public"."intakes" FOR EACH ROW EXECUTE FUNCTION "public"."intakes_insert"();--> statement-breakpoint
-- A staff text is saved unconfirmed: only a confirmed decision, or a confirmed reveal, names it afterwards.
CREATE FUNCTION "public"."staff_texts_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_at := now();
  NEW.decision_id := NULL;
  NEW.confirmed_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."staff_texts_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "staff_texts_insert" BEFORE INSERT ON "public"."staff_texts" FOR EACH ROW EXECUTE FUNCTION "public"."staff_texts_insert"();--> statement-breakpoint
-- A snapshot is taken at its transaction's start, to the millisecond, as JavaScript reads times: the API reads the same
-- value in the same transaction before it computes the digest, which covers the time.
CREATE FUNCTION "public"."evidence_snapshots_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.taken_at := date_trunc('milliseconds', now());
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."evidence_snapshots_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "evidence_snapshots_insert" BEFORE INSERT ON "public"."evidence_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."evidence_snapshots_insert"();--> statement-breakpoint
CREATE FUNCTION "public"."case_access_log_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."case_access_log_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "case_access_log_insert" BEFORE INSERT ON "public"."case_access_log" FOR EACH ROW EXECUTE FUNCTION "public"."case_access_log_insert"();--> statement-breakpoint
-- An image row is born on no post, visible, unheld and unerased. INSERT stays a table privilege (an insert names every
-- column), so this trigger is what keeps the three columns out of the API role's hands at insert, as the column grants do
-- at update. A row that names a post is refused (moderation_column), for every role, the migrator included: an image is
-- put on a post only by attach's update, which post_media_guard below checks against the post's author, so no insert
-- can place one on a post its owner did not write.
CREATE FUNCTION "public"."post_media_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  NEW.moderation_state := 'visible';
  NEW.hold_until := NULL;
  NEW.erased_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_insert" BEFORE INSERT ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_insert"();--> statement-breakpoint
CREATE FUNCTION "public"."media_holds_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.held_at := now();
  NEW.released_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_holds_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "media_holds_insert" BEFORE INSERT ON "public"."media_holds" FOR EACH ROW EXECUTE FUNCTION "public"."media_holds_insert"();--> statement-breakpoint
-- 3. The end of the author's appeal window and of the re-examination window: six calendar months after the person was
-- told. PostgreSQL clamps month arithmetic to the month's last day (31 August plus six months is 28 or 29 February), and
-- the UTC zone keeps the result independent of the session's. The contracts' appealDeadline computes the same.
CREATE FUNCTION "public"."appeal_deadline"(informed timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ((appeal_deadline.informed AT TIME ZONE 'UTC') + interval '6 months') AT TIME ZONE 'UTC'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."appeal_deadline"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."appeal_deadline"(timestamptz) TO korbat_api;--> statement-breakpoint
-- The attach trigger: every item lands in exactly one open case, as a database fact under concurrency. It runs as its
-- owner, since the API role holds no UPDATE on cases. In this order:
--   1. It forces the columns the API must not choose. suspect is the intake's "on the CSAM path, or a finding citing R2"; a
--      notice on the law alone has no rule, and suspect is then false, never null.
--   2. A re-examination is checked under a lock on its intake (FOR KEY SHARE: it waits for an erasure of the intake, which
--      takes the row FOR UPDATE), in a statement of its own after the lock, and against clock_timestamp(), never now(),
--      which is the transaction's start. It takes the target, the handle, the position and the lane of the item it
--      re-examines, whatever the insert supplied. A re-examination is not re-examined, except one about a post that is not
--      suspect and that a decision answered while nobody could open the post's images (decisions.unseen): that answer does
--      not spend the one request.
--   3. Without a case the item is answered at once and only as not_available: the CHECK intake_items_case holds the
--      same, null-safely, and the refusal here names it. With a case it takes the next number under the case's row lock;
--      a case that is closed, or that is about another target, matches no row, and the insert fails with
--      serialization_failure, so the intake's transaction is retried into a new case.
CREATE FUNCTION "public"."intake_items_attach"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  intake public.intakes;
  original public.intake_items;
BEGIN
  NEW.created_at := now();
  NEW.answered_by := NULL;
  NEW.outcome_sent_at := NULL;
  NEW.shown_outcome := NULL;
  NEW.revision_pending_at := NULL;
  NEW.revised_sent_at := NULL;
  NEW.erased_at := NULL;
  IF NEW.reexamines_item_id IS NOT NULL THEN
    PERFORM 1 FROM public.intakes n WHERE n.id = NEW.intake_id FOR KEY SHARE;
  END IF;
  -- A statement of its own: after the lock above it sees an erasure that committed while the lock waited.
  SELECT n.* INTO intake FROM public.intakes n WHERE n.id = NEW.intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'an intake item names an intake that does not exist' USING ERRCODE = '23503';
  END IF;
  NEW.reporter_account_id := intake.reporter_id;
  NEW.alleges_illegal := intake.alleges_illegal;
  NEW.suspect := intake.csam OR coalesce(intake.rule_id = 'R2', false);
  NEW.outcome_mail := CASE WHEN intake.contact_id IS NOT NULL OR (intake.reporter_id IS NOT NULL AND intake.alleges_illegal)
                           THEN 'pending'::public.delivery_state ELSE 'none'::public.delivery_state END;

  IF NEW.reexamines_item_id IS NOT NULL THEN
    SELECT o.* INTO original
      FROM public.intake_items o
      LEFT JOIN public.decisions d ON d.id = o.answered_by
     WHERE o.id = NEW.reexamines_item_id
       AND o.intake_id = NEW.intake_id
       AND (o.reexamines_item_id IS NULL OR (o.target_type = 'post' AND NOT o.suspect AND d.unseen))
       AND o.answered_by IS NOT NULL
       AND o.outcome IN ('no_violation', 'not_evident')
       AND o.outcome_sent_at IS NOT NULL
       AND clock_timestamp() < public.appeal_deadline(o.outcome_sent_at);
    IF NOT FOUND OR intake.erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'reexamination_not_open';
    END IF;
    NEW.target_type := original.target_type;
    NEW.target_id := original.target_id;
    NEW.named_handle := original.named_handle;
    NEW.position := original.position;
    NEW.lane := original.lane;
  END IF;
  IF NEW.target_type = 'post' THEN
    NEW.named_handle := NULL;
  END IF;

  IF NEW.case_id IS NULL THEN
    NEW.seq := NULL;
    IF NEW.outcome IS DISTINCT FROM 'not_available' THEN
      RAISE EXCEPTION 'an item without a case is stored only as not_available (intake_items_case)'
        USING ERRCODE = '23514', TABLE = 'intake_items', CONSTRAINT = 'intake_items_case';
    END IF;
    RETURN NEW;
  END IF;
  NEW.outcome := NULL;
  UPDATE public.cases c
     SET intake_seq = c.intake_seq + 1,
         lane = CASE WHEN c.answered_seq = c.intake_seq THEN NEW.lane ELSE least(c.lane, NEW.lane) END,
         oldest_open_at = coalesce(c.oldest_open_at, now())
   WHERE c.id = NEW.case_id AND c.closed_at IS NULL AND c.target_type = NEW.target_type AND c.target_id = NEW.target_id
  RETURNING c.intake_seq INTO NEW.seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_closed' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."intake_items_attach"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "intake_items_attach" BEFORE INSERT ON "public"."intake_items" FOR EACH ROW EXECUTE FUNCTION "public"."intake_items_attach"();--> statement-breakpoint
-- A post's card shows the images of the post it quotes, so a suspect item about a post that quotes another is a report
-- about both: the intake adds an item for the quoted post, at its origin's position plus 10. This constraint trigger holds
-- that rule at commit, so that no later intake path can forget the quoted post. It refuses (quote_item_missing) unless:
--   (a) a suspect item about a post, at a position up to 10, that is no re-examination and whose post quotes another, has
--       beside it in its intake an item on that post that is no re-examination;
--   (b) an item at a position above 10 that is no re-examination has, in its intake at its position minus 10, a suspect
--       item about a post that quotes the item's own target;
--   (c) a re-examination of a suspect item about a post, whose intake holds an added item on the post it quotes, leaves no
--       such added item open to re-examination: it is unanswered, or was not answered "no action", or is not released,
--       or its window has passed, or a re-examination of it exists, this transaction's included.
-- An item without a case (a link that names no row) passes. No retry repairs a missing item, so the code is a defect of the
-- caller, not one of the retried SQLSTATEs. It reads the post by its key and the intake's items through
-- intake_items_target_once, as its owner.
CREATE FUNCTION "public"."intake_items_quote"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  origin public.intake_items;
  quoted uuid;
BEGIN
  IF NEW.case_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.reexamines_item_id IS NULL THEN
    IF NEW.position <= 10 THEN
      IF NEW.suspect AND NEW.target_type = 'post' THEN
        SELECT p.quote_of_id INTO quoted FROM public.posts p WHERE p.id = NEW.target_id;
        IF quoted IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.intake_items i
           WHERE i.intake_id = NEW.intake_id AND i.target_type = 'post' AND i.target_id = quoted AND i.reexamines_item_id IS NULL
        ) THEN
          RAISE EXCEPTION 'quote_item_missing';
        END IF;
      END IF;
    ELSIF NEW.target_type <> 'post' OR NOT EXISTS (
      SELECT 1 FROM public.intake_items o
        JOIN public.posts p ON p.id = o.target_id
       WHERE o.intake_id = NEW.intake_id AND o.reexamines_item_id IS NULL AND o.position = NEW.position - 10
         AND o.suspect AND o.target_type = 'post' AND p.quote_of_id = NEW.target_id
    ) THEN
      RAISE EXCEPTION 'quote_item_missing';
    END IF;
    RETURN NULL;
  END IF;
  SELECT o.* INTO origin FROM public.intake_items o WHERE o.id = NEW.reexamines_item_id;
  IF FOUND AND origin.suspect AND origin.target_type = 'post' THEN
    SELECT p.quote_of_id INTO quoted FROM public.posts p WHERE p.id = origin.target_id;
    IF quoted IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.intake_items a
       WHERE a.intake_id = NEW.intake_id AND a.target_type = 'post' AND a.target_id = quoted AND a.reexamines_item_id IS NULL AND a.position > 10
         AND a.answered_by IS NOT NULL AND a.outcome IN ('no_violation', 'not_evident') AND a.outcome_sent_at IS NOT NULL
         AND clock_timestamp() < public.appeal_deadline(a.outcome_sent_at)
         AND NOT EXISTS (SELECT 1 FROM public.intake_items r WHERE r.reexamines_item_id = a.id)
    ) THEN
      RAISE EXCEPTION 'quote_item_missing';
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."intake_items_quote"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "intake_items_quote" AFTER INSERT ON "public"."intake_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."intake_items_quote"();--> statement-breakpoint
-- The one definition of "in force": every ledger row of a measure kind that no row reverses and, when its decision was taken
-- while deciding (interim), whose case is still open. A seal taken while deciding is a measure of the suspicion, not of
-- the case: it is in force while its case holds an unanswered suspect item that arrived no later than the seal's decision,
-- so it ends by itself when an admin answers the suspect items, also while another item keeps the case open, and a suspect
-- item that arrives after it ended never brings it back (the post is frozen again through the new item, and a person
-- seals again). The view runs with its reader's rights. It names no value of post_state, and every enum value it names
-- is created by this migration, so it means the same on a database upgraded from 0013 as on a fresh one.
CREATE VIEW "public"."measures_in_force" WITH (security_invoker = true) AS
SELECT a.id, a.kind, a.post_id, a.media_id, a.subject_account_id, d.id AS decision_id, d.kind AS decision_kind, d.case_id
  FROM public.decision_actions a
  JOIN public.decisions d ON d.id = a.decision_id
 WHERE a.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND (d.kind <> 'interim'
     OR CASE WHEN a.kind = 'seal_media'
          THEN EXISTS (SELECT 1 FROM public.intake_items i
                        WHERE i.case_id = d.case_id AND i.suspect AND i.answered_by IS NULL AND i.created_at <= d.decided_at)
          ELSE EXISTS (SELECT 1 FROM public.cases c WHERE c.id = d.case_id AND c.closed_at IS NULL)
        END);--> statement-breakpoint
-- 0001's default privileges cover views too; the API role reads this one and nothing more.
REVOKE ALL ON "public"."measures_in_force" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."measures_in_force" TO korbat_api;--> statement-breakpoint
-- The one definition of the freeze: a post is frozen while an open case about it, or about its author's account, holds an
-- unanswered suspect item, or a seal in force lists it. It reads no posts row, because inside a cascade from a deleted post
-- that row is already gone for the trigger's statement: the caller hands it the post and its author. Each of its three arms
-- is driven by an index (cases_one_open_per_target, then intake_items_suspect_open_idx only when a case was found;
-- seal_posts_post_idx), so a post nobody reported costs three index probes. In the database only post_frozen and the keep
-- trigger's function name it.
CREATE FUNCTION "public"."frozen_for"(post uuid, author uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'post' AND c.target_id = frozen_for.post)
    OR EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'account' AND c.target_id = frozen_for.author)
    OR EXISTS (
      SELECT 1 FROM public.seal_posts s
      JOIN public.measures_in_force m ON m.id = s.action_id
      WHERE s.post_id = frozen_for.post)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."frozen_for"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."frozen_for"(uuid, uuid) TO korbat_api;--> statement-breakpoint
-- That definition for the callers that have a post and not its author.
CREATE FUNCTION "public"."post_frozen"(post uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.frozen_for(post_frozen.post, (SELECT p.author_id FROM public.posts p WHERE p.id = post_frozen.post))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_frozen"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."post_frozen"(uuid) TO korbat_api;--> statement-breakpoint
-- Gate K: no image row of a frozen post, and no row a case's hold retains, is deleted, by any delete path present or
-- future. The function runs as its owner, so its read of the freeze depends on no grant or row policy of the deleting
-- role. It tests the row's own columns first, so the sweeper's deletes of uploads on no post never read the predicate: such
-- a row is retained only while a hold stands. For a row on a post it refuses to run outside READ COMMITTED
-- (read_committed_only), since under any other level its read would see the transaction's old snapshot. The row is
-- locked before a BEFORE DELETE row trigger fires, and the read below is a statement of its own, which takes a fresh
-- snapshot: a delete that waited for an intake's row locks therefore reads the suspect item that intake committed. A filter
-- inside the deleting statement would not, so no deleter relies on one. A retained row is skipped on a direct delete (the
-- trigger answers NULL, RETURNING omits the row, and no deletion is requested for its files); inside a cascade, where
-- skipping would silently break the foreign key, the delete is refused (restrict_violation). The image's owner stands for
-- the post's author: post_media_guard below makes them the same by construction.
CREATE FUNCTION "public"."post_media_keep"() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  retained boolean;
BEGIN
  IF OLD.post_id IS NULL THEN
    retained := coalesce(OLD.hold_until > now(), false);
  ELSE
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
    END IF;
    IF OLD.hold_until > now() THEN
      retained := true;
    ELSE
      SELECT public.frozen_for(OLD.post_id, OLD.owner_id) INTO retained;
    END IF;
  END IF;
  IF retained THEN
    IF pg_trigger_depth() > 1 THEN
      RAISE EXCEPTION 'post_media row % is retained', OLD.id USING ERRCODE = '23001';
    END IF;
    RETURN NULL;
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_keep"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_keep" BEFORE DELETE ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_keep"();--> statement-breakpoint
-- An image stays on its post, with the content it was posted with. For every role, the migrator included: an image never
-- leaves its post (so nothing detaches it into the sweeper's reach), an upload goes only onto a post of its owner, and the
-- owner never changes; with the insert trigger above, which takes no row that names a post, the owner of an attached row
-- is its post's author, which is what lets the keep trigger pass the owner as the author. And unless the migrator's own
-- functions run it: the alt text, the position, the size and the blurhash of an attached row never change, since on an
-- account's case the alt texts on the kept rows are the only copy of them (an erasure, which runs as the migrator, may
-- still blank what it erases). The function is plain: current_user is the role that ran the statement, and the API role
-- can neither become the migrator nor disable the trigger.
CREATE FUNCTION "public"."post_media_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF OLD.post_id IS NOT NULL THEN
    IF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
    IF current_user <> 'korbat_migrate' AND (NEW.alt_text IS DISTINCT FROM OLD.alt_text OR NEW.position IS DISTINCT FROM OLD.position
        OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height OR NEW.blurhash IS DISTINCT FROM OLD.blurhash) THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = NEW.post_id AND p.author_id IS DISTINCT FROM NEW.owner_id) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_guard" BEFORE UPDATE OF "post_id", "owner_id", "alt_text", "position", "width", "height", "blurhash" ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_guard"();--> statement-breakpoint
-- A hold keeps the image's row: post_media.hold_until is the latest end of the image's unreleased holds (infinity for a
-- hold without an end), and the keep trigger retains a row while that lies ahead. Three statements, in this order: lock
-- the image's row; then, in a statement of its own, read the holds, which under READ COMMITTED takes its snapshot after
-- the lock was granted and so sees every hold committed meanwhile; then write. One UPDATE whose subquery reads the holds is
-- not enough: a release that waits for a new hold's row lock re-checks only the image's row and keeps its subquery's old
-- snapshot, which left an image unheld under an unreleased hold.
CREATE FUNCTION "public"."media_holds_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  latest timestamptz;
BEGIN
  PERFORM 1 FROM public.post_media m WHERE m.id = NEW.media_id FOR NO KEY UPDATE;
  SELECT max(coalesce(h.until, 'infinity'::timestamptz)) INTO latest
    FROM public.media_holds h WHERE h.media_id = NEW.media_id AND h.released_at IS NULL;
  UPDATE public.post_media m SET hold_until = latest WHERE m.id = NEW.media_id;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_holds_apply"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "media_holds_apply" AFTER INSERT OR UPDATE ON "public"."media_holds" FOR EACH ROW EXECUTE FUNCTION "public"."media_holds_apply"();--> statement-breakpoint
-- 4. The auth tables. 0001's default privileges gave the auth role every write on new auth tables. A notifier's contact is
-- never re-encrypted or pointed at another address: the auth role stores, reads and deletes it, and moves only the day
-- it is forgotten. A suppression is inserted, read and deleted. Confirmations keep the default privileges. The staff
-- links are written only by `staff.js link` and `unlink`, as the migrator, and read only by migrator-owned definer
-- functions: the auth role holds nothing on them.
REVOKE UPDATE ON "auth"."notifier_contacts" FROM korbat_auth;--> statement-breakpoint
GRANT UPDATE ("forget_after") ON "auth"."notifier_contacts" TO korbat_auth;--> statement-breakpoint
REVOKE UPDATE ON "auth"."notifier_suppressions" FROM korbat_auth;--> statement-breakpoint
REVOKE ALL ON "auth"."staff_personal_accounts" FROM korbat_auth;--> statement-breakpoint
-- 5. The limits on staff: 60 decisions an hour and 300 a day, 400 case opens, 50 findings and 10 reveals a day. Every
-- reader falls back to these numbers when the row is missing.
INSERT INTO "public"."moderation_limits" ("id", "decisions_per_hour", "decisions_per_day", "case_opens_per_day", "findings_per_day", "reveals_per_day", "updated_at")
VALUES (1, 60, 300, 400, 50, 10, now());
