ALTER TYPE "auth"."auth_event_type" ADD VALUE 'passkey_added';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'passkey_removed';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'passkey_counter_regression';--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "aaguid" uuid;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "backup_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "uv_initialized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "created_device_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "suspect_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "handle" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "factors" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "passkey_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "webauthn_user_id" "bytea";--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD CONSTRAINT "passkeys_created_device_id_devices_id_fk" FOREIGN KEY ("created_device_id") REFERENCES "auth"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_passkey_id_passkeys_id_fk" FOREIGN KEY ("passkey_id") REFERENCES "auth"."passkeys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_handle_idx" ON "auth"."sessions" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_webauthn_user_id_idx" ON "auth"."users" USING btree ("webauthn_user_id") WHERE webauthn_user_id is not null;
