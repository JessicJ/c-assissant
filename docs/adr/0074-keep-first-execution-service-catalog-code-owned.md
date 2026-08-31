# Keep first Execution Service Catalog code-owned

The first Execution Service Catalog will be code-owned static configuration shipped with the application version rather than a database table, user setting, or operations console. This keeps first-slice service capability resolution deterministic, testable, and reviewable while the Travel Execution Capability is being validated.

## Considered Options

- Store the catalog in a database or settings UI. This would allow runtime edits, but it creates configuration governance and user-error risks before the service model is stable.
- Keep the catalog in code. This is less flexible but easier to validate, version, test, and rollback for the first slice.
