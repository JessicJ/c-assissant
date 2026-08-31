# Separate Local Transport Options from Route Modes

Landi will model traveler-facing Local Transport Options separately from provider-supported Route Modes. This lets the product recommend choices such as ride-hail car, ride-hail motorbike, private driver, scooter rental, or walking while still relying on stable route facts from generic walking, driving, and transit providers.

## Considered Options

- Add every local option as a route mode. This would make the domain look simple but would imply provider facts that Google or other route connectors may not actually supply.
- Keep route facts generic and map them into traveler-facing local options. This preserves factual routing boundaries while making the execution advice useful in places where travelers choose between cars, motorbikes, private drivers, or rentals.
