# food-nearby

Turn current Amap nearby-place facts into a bounded China Pack result for the active Plan.

- Require only Plan-scoped party size before showing specific places.
- Preserve Amap provider order; do not invent an independent ranking.
- Return at most five candidates and retain observed time.
- Do not infer opening hours, table availability, foreigner suitability, menu, price, quality, reservation, order, payment, visit, or completion.
- Every map action is an external handoff whose completion stays unknown.
