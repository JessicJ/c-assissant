# Storage

Local SQLite persistence for the personal-instance workflow.

It stores the singleton Profile, current and historical Plans with Stages, Tasks and Reminders, Inbox items, minimized Runs, Telegram binding and delivery state, immutable SourceSnapshots, schema migrations, and other bounded workflow state. The database is created automatically on first Server start and is ignored by Git.

Schema compatibility checks, integrity reporting, and explicit private backups are implemented. Automatic destructive recovery, database encryption, and a user-approved retention policy remain future work.
