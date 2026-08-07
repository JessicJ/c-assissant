# Weather and Packing

Convert normalized QWeather observations and short forecasts into cautious packing prompts.

- Keep current observations distinct from dated forecasts.
- For a Task or Reminder date, use a forecast only when its date matches exactly.
- Derive only rain or snow protection, a warmer layer, heat and hydration, and sun protection from returned facts.
- Preserve the QWeather retrieval time and only an approved HTTPS QWeather attribution URL.
- Weather changes; always tell Core to refresh near the relevant Task.
- Do not create a Reminder, modify a Plan, or claim that a packing action was completed.
- Fail closed on malformed or untraceable provider facts.
