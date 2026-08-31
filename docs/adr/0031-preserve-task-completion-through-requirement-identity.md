# Preserve Task completion through Requirement Identity

Action Requirements retain stable identities across Blueprint Revisions while their meaning and completion condition remain unchanged. The Plan Compiler uses that identity to carry completed Task state into a Replacement Draft; a new identity is created only when the requirement materially changes or the traveler explicitly asks to perform it again.

## Consequences

Task IDs may remain Plan-version-specific, but completion reconciliation does not depend on translated titles or descriptions. Compiler audits record carried, changed, reopened, and newly introduced requirements.
