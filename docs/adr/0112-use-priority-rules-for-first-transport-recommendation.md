# Use priority rules for first transport recommendation

The first Local Transport Recommendation implementation will use deterministic priority rules rather than a weighted scoring model. Simple rules for walking, ride-hail car, ride-hail motorbike, private driver, and rider-confirmed scooter rental are easier to explain, test, and tune for the first `/go` movement slice.

## Considered Options

- Use a weighted scoring model. This could handle tradeoffs more flexibly, but it is harder to explain and tune before real usage.
- Use priority rules. This keeps first-slice behavior predictable and testable.
