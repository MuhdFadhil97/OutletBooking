CREATE TABLE "payment_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"provider" text DEFAULT 'toyyibpay' NOT NULL,
	"secret_key_encrypted" text,
	"secret_key_last4" text,
	"category_code" text,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"last_error" text,
	"test_bill_code" text,
	"tested_at" timestamp with time zone,
	"connected_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_business_id_unique" UNIQUE("business_id"),
	CONSTRAINT "payment_accounts_provider_check" CHECK ("payment_accounts"."provider" IN ('toyyibpay')),
	CONSTRAINT "payment_accounts_status_check" CHECK ("payment_accounts"."status" IN ('not_connected','connected','error'))
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;