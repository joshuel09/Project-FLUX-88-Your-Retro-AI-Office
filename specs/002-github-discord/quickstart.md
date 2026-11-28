# Phase 3 Validation Guide

All validation runs in mock mode without GitHub or Discord credentials.

The worker schedules review reminders only when `review_reminder` is enabled in `DISCORD_NOTIFICATION_TEMPLATES`. `DISCORD_REMINDER_INTERVAL_HOURS` defaults to 24 and accepts 1–168 hours. `QUIET_HOURS` defaults to `22:00-07:00` and uses the worker host's local time. Scheduled records remain dashboard-visible and pending; Discord delivery still requires the exact owner-approved batch implemented by T010.

1. Start PostgreSQL and Redis using the repository quickstart, then apply migrations and seed data.
2. Run connector contract tests with injected mock GitHub and Discord providers.
3. In a disposable integration database, map a fake GitHub PR to a task, ingest a review comment, and verify it appears once with its source URL and untrusted provenance.
4. Repeat the same sync and restart the worker; verify one feedback row and no duplicate activity or notification.
5. Queue a notification during quiet hours, advance the test clock, and verify one delivery after quiet hours.
6. Send Discord interaction fixtures with a valid signature, invalid signature, stale timestamp, wrong owner, and wrong channel. Only the valid owner interaction may reach the existing approval service.
7. Attempt a write without an approval grant; verify denial and audit record. No test uses live credentials.

Exact package test commands will be added by the task owning each package and migration.
