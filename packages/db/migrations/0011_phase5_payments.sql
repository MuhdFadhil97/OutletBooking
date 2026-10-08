CREATE TABLE "payment_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"provider" text DEFAULT 'toyyibpay' NOT NULL,
	"secret_key_encrypted" text,
	"secret_key_last4" text,
	"category_code" text,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"last_error" text,
	"tested_at" timestamp with time zone,
	"connected_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_business_id_unique" UNIQUE("business_id"),
	CONSTRAINT "payment_accounts_provider_check" CHECK ("payment_accounts"."provider" IN ('toyyibpay')),
	CONSTRAINT "payment_accounts_status_check" CHECK ("payment_accounts"."status" IN ('not_connected','connected','error'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"booking_id" integer,
	"subscription_id" integer,
	"purpose" text NOT NULL,
	"provider" text DEFAULT 'toyyibpay' NOT NULL,
	"method" text,
	"recorded_by_user_id" integer,
	"bill_code" text,
	"amount_sen" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transaction_ref" text,
	"paid_at" timestamp with time zone,
	"raw_callback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_bill_code_unique" UNIQUE("bill_code"),
	CONSTRAINT "payments_purpose_check" CHECK ("payments"."purpose" IN ('deposit','full_payment','balance','subscription')),
	CONSTRAINT "payments_provider_check" CHECK ("payments"."provider" IN ('toyyibpay','manual')),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" IN ('fpx','duitnow','card','cash','duitnow_qr','bank_transfer')),
	CONSTRAINT "payments_amount_sen_check" CHECK ("payments"."amount_sen" > 0),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('pending','paid','failed','expired','refunded')),
	CONSTRAINT "payments_target_check" CHECK (("payments"."booking_id" IS NOT NULL) <> ("payments"."subscription_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_booking_id_fkey" FOREIGN KEY ("business_id","booking_id") REFERENCES "public"."bookings"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_business_idx" ON "payments" USING btree ("business_id","created_at");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;