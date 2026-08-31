# Degrade Action Cards with conservative defaults

Landi will continue producing Execution Action Cards when non-blocking Recommendation Context facts are missing, using Conservative Execution Defaults instead of blocking the whole interaction. Missing party size, luggage, weather, or route duration should reduce confidence and avoid riskier primary recommendations, but still leave the traveler with a safe next step such as Google Maps, manual handoff details, or a prompt to verify in the external service.

## Considered Options

- Block the card until every recommendation input is known. This would be more precise, but it makes on-trip help brittle at the moment the traveler needs it.
- Degrade with conservative defaults. This preserves usefulness while preventing Landi from inventing unavailable facts or recommending high-risk options.
