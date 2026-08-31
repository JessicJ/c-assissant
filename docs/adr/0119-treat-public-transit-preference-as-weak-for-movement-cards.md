# Treat public transit preference as weak for Movement Cards

Landi will treat the existing Plan `public_transit` preference as a weak preference for first-slice Movement Action Cards. When transit route facts are unavailable or unsuitable for the current destination and movement context, Landi may recommend a safer locally applicable option such as ride-hail car while briefly noting that the public-transit preference was considered.

## Considered Options

- Always honor `public_transit` as the primary recommendation. This respects the preference but may produce poor guidance where transit is unavailable or impractical.
- Treat it as weak in movement execution. This keeps preferences meaningful without overriding current feasibility and safety.
