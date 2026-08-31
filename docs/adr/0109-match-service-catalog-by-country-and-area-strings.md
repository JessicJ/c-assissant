# Match Service Catalog by country and area strings

The first Execution Service Catalog will match locally applicable services by normalized country plus optional city or area strings. It will not use geographic polygons, administrative boundary databases, or live coverage checks because the first movement slice only needs deterministic, reviewable service selection for Manual Handoffs.

## Considered Options

- Use precise geographic coverage polygons. This would be more accurate, but it requires curated spatial data and maintenance.
- Use live provider coverage checks. This depends on provider APIs that may not exist or be available.
- Use country and area strings. This is simple and sufficient for first-slice validation.
