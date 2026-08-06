# Storage

Local SQLite persistence for the first personal-instance workflow.

It currently stores the singleton Profile, the current Plan and its Stages/Tasks, plus Inbox items. The database is created automatically on first Server start and is ignored by Git.

This is not yet the final storage model: Reminder, Event, Run, Confirmation, SourceSnapshot, retention, backup, encryption, and migrations remain future work.
