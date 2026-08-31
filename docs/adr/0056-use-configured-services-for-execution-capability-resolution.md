# Use configured services for execution capability resolution

Landi will resolve first-slice execution services from connected providers and a configured Execution Service Catalog, not from real-time web search during the traveler interaction. This keeps Execution Action Cards stable, auditable, and feasible with known capabilities while still allowing Manual Handoffs for services that do not expose a reliable integration.

## Considered Options

- Search the web during each execution request to discover local services. This might find fresh recommendations, but it makes action cards slower, less predictable, and harder to validate.
- Use connected providers plus static service configuration. This fits Landi's current connector model and keeps provider availability decisions deterministic.
