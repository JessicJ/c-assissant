# Keep first Execution Cards out of Web

Landi will not add new Web pages, Web configuration fields, Web execution controls, or per-step Execution Action Card records for the first Travel Execution Capability slice. Telegram owns the current on-trip execution loop, while the existing Web surface remains responsible for planning, Plan display, map context, and configuration.

## Considered Options

- Record every Execution Action Card in Web Inbox. This would preserve more history, but it expands Web into an execution timeline and conflicts with the narrower Web responsibility boundary.
- Keep first execution cards and new Web surfaces out of the slice. This keeps the first slice focused and lets Web stay in its existing planning, display, and configuration role.
