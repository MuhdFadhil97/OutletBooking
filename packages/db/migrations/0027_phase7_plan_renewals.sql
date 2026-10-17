ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "renewal_notice_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "renewal_notice_stage" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('booking_new','booking_paid','payment_failed','booking_cancelled','walk_in','staff_joined','reminders_sent','trial_ending','trial_ended','plan_renewal_due','plan_grace','plan_ended'));