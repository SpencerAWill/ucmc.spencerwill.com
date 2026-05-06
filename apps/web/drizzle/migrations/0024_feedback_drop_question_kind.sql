-- Drop the "question" feedback kind. Questions belong on Discord /
-- in person, not as a feedback channel that produces unanswered
-- GitHub issues. Any rows that already used the kind get reclassified
-- as "general" so they remain readable in the admin triage view; the
-- TypeScript enum no longer includes "question", but `text({ enum })`
-- in Drizzle is a TS-level narrowing only and emits no SQL CHECK
-- constraint, so this is purely a data migration.
UPDATE feedback SET kind = 'general' WHERE kind = 'question';
