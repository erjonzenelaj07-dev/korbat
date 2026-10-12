DROP POLICY "appeals_api_all" ON "appeals" CASCADE;--> statement-breakpoint
DROP TABLE "appeals" CASCADE;--> statement-breakpoint
DROP POLICY "cases_api_all" ON "cases" CASCADE;--> statement-breakpoint
DROP TABLE "cases" CASCADE;--> statement-breakpoint
DROP POLICY "reports_api_all" ON "reports" CASCADE;--> statement-breakpoint
DROP TABLE "reports" CASCADE;--> statement-breakpoint
DROP POLICY "strikes_api_all" ON "strikes" CASCADE;--> statement-breakpoint
DROP TABLE "strikes" CASCADE;--> statement-breakpoint
DROP POLICY "transparency_api_all" ON "transparency_log" CASCADE;--> statement-breakpoint
DROP TABLE "transparency_log" CASCADE;--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "reputation";--> statement-breakpoint
DROP TYPE "public"."appeal_status";--> statement-breakpoint
DROP TYPE "public"."case_action";--> statement-breakpoint
DROP TYPE "public"."report_status";--> statement-breakpoint
DROP TYPE "public"."target_type";
