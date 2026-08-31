# Do not learn long-term preferences from first card feedback

Landi will not automatically save long-term transport or execution preferences from first-slice Execution Card Feedback. Feedback may create a Session-scoped Execution Preference for the current interaction, but updating the traveler Profile or Plan preference requires a separate explicit confirmation.

## Considered Options

- Learn preferences implicitly from repeated card choices. This could personalize future cards, but it turns lightweight feedback into durable profile mutation.
- Keep feedback session-scoped. This preserves privacy and reviewability while the execution card behavior is still being proven.
