These files preserve superseded manual or product test scenarios; they are not active regression suites.

- `email-review.test.ts.txt`: old public email capability confirmation. Active `apps/server/src/email-review.test.ts` and `email-review-retirement.test.ts` prove that missing, malformed and formerly valid capabilities receive 410 without touching business state. Web workspace confirmation tests cover active plan confirmation.
- `readonly-schema-admission.test.ts.txt`: manual acceptance of an explicitly pinned historical snapshot. It requires private historical evidence and has not been rerun in this source review. `scripts/readonly-mechanism.test.mjs` uses an isolated synthetic database and an exact test-module schema pin to verify the source mechanisms. Its `fixture_mechanism` evidence does not establish that the production historical snapshot is admitted. The unmodified production schema gate must reject the synthetic fixture.

`test:supplemental` runs the active replacement tests. No production admission gate or runtime readiness flag is enabled by these fixtures.

- `execution-test-mode.ts.txt`: retired, unreferenced local reminder-acceptance simulation helper. Both exported symbols had no active callers. Preserved verbatim as historical source; not compiled or counted as an active test. Formal email template preview remains active.
