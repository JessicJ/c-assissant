# Use simple night window for first movement rules

The first Movement Action Card rules will treat local time from 20:00 through 06:00 as night. This gives transport recommendation a clear, testable safety signal without requiring destination-specific sunset times, seasons, or lighting conditions in the first slice.

## Considered Options

- Use precise sunset and local-light data. This could be more accurate, but it adds data dependencies and complexity.
- Use a simple local-time window. This is conservative and sufficient for first-slice transport recommendations.
