ALTER TABLE `ingest_log` ADD `generated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rejected_events` ADD `generated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `generated` integer DEFAULT false NOT NULL;