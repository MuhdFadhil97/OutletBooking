CREATE TABLE "billing_details" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_details_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"company_name" text NOT NULL,
	"ssm_no" text,
	"tin" text,
	"address" text,
	"receipt_email" "citext" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_details_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "billing_details" ADD CONSTRAINT "billing_details_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-written: the updated_at trigger every table has (docs/schema.sql section 8).
CREATE TRIGGER "billing_details_set_updated_at" BEFORE UPDATE ON "billing_details" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
