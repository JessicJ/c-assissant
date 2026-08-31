# Persist versioned Trip Blueprints

Landi persists each completed Trip Blueprint as an immutable, versioned record instead of discarding it after Plan compilation. This makes the researched place set and its evidence recoverable, allows deterministic recompilation after compiler or display failures, and avoids repeating costly Skill research merely because Landi's downstream structure failed.

## Consequences

Trip Blueprint versions and Plan versions have separate identities and lifecycles. Failed compilation must retain its input Blueprint, and recompiling the same version must not silently alter or reduce its researched content.
