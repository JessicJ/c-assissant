# Replace /uber command with /go

Landi will replace the provider-specific `/uber` command with the provider-neutral `/go` Movement Intent Command rather than keeping `/uber` as a visible or diagnostics movement entry. This avoids preserving a command that misrepresents destination-neutral execution and would be especially misleading in validation scenarios where Uber is not locally applicable.

## Considered Options

- Hide `/uber` from user help but keep it as a diagnostics or legacy path. This lowers migration risk, but it keeps a provider-specific movement workflow alive.
- Replace `/uber` with `/go`. This is a cleaner user-facing and test-facing boundary for the first Travel Execution Capability slice.
