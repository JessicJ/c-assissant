# Make first /go user-initiated

The first `/go` implementation will produce Movement Action Cards only after explicit traveler invocation. Existing departure reminders may continue to operate, but proactive Movement Action Cards from reminders are outside the first slice because they add scheduling, route-refresh timing, notification strategy, and interruption-policy scope.

## Considered Options

- Push Movement Action Cards proactively before planned departures. This could be useful, but it broadens the feature into monitoring and notification orchestration.
- Make `/go` user-initiated first. This keeps the initial behavior predictable and easier to validate.
