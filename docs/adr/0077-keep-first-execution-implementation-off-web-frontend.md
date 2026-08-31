# Keep first execution implementation off Web frontend

The first Travel Execution Capability slice will change backend domain and service code plus Telegram command and message behavior, but it will not change the Web frontend. Web already provides planning, Plan display, map context, and configuration; adding Web execution UI would expand scope before the Telegram execution loop is validated.

## Considered Options

- Add matching Web execution UI during the first slice. This could create a fuller workspace experience, but it duplicates interaction design and expands frontend scope.
- Keep the first implementation off Web frontend. This keeps the work focused on execution semantics and Telegram delivery.
