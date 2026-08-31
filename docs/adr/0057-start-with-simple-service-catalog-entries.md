# Start with simple Service Catalog Entries

The first Execution Service Catalog will use simple Service Catalog Entries matched to destination and Local Transport Option rather than a complex local mobility rules engine. This is enough to present Manual Handoffs for services such as Grab, Gojek, Bluebird, private drivers, walking, and scooter rental in the Bali Validation Scenario without pretending to know fine-grained live restrictions.

## Considered Options

- Build a detailed local rules engine for neighborhood restrictions, pickup rules, operating hours, and provider-specific exceptions. This would be more precise, but it requires live or highly curated local data that the first slice cannot guarantee.
- Start with simple entries. This keeps the first implementation deterministic and allows uncertainty to be handled through route facts, weather, and user confirmation.
