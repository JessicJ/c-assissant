# Separate weather lookup from weather impact

Landi will distinguish Weather Lookup from Weather Impact Action Cards. Weather Lookup reports weather facts, while Weather Impact interprets those facts against the current plan or action and recommends a temporary Execution Adjustment without silently changing the Trip Blueprint or Execution Plan.

## Considered Options

- Treat `/weather` output as the weather execution card. This is simpler, but it only answers what the weather is.
- Add weather impact semantics. This makes weather useful for on-trip decisions such as transport choice, departure timing, outdoor stops, and whether a planned stop needs review.
