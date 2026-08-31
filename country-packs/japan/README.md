# Japan Country Pack V1

The Japan Country Pack is Landi's single-country preparation pack for a Tokyo travel demonstration. It is installed as one unit; its eight internal Skills use `japan-`-namespaced identities so they can coexist with the China Pack registry.

Arrival routing requires a saved Japan airport or station and accommodation coordinate. When either anchor is missing, transport preparation degrades explicitly and never substitutes Tokyo city centre as an airport; a matching Plan transport preference takes priority over a generic shortest-duration comparison.

Implemented capabilities include fail-closed country selection from a normalized Google country fact; minimized entry preparation using explicit nationality, travel purpose, stay length, dates, and passport-confirmation state; Plan-linked MOFA evidence; Japan-only digital, IC-card/payment, emergency, airport, and Tokyo food references; Google Maps route/accommodation facts; coverage-dependent Google Weather; and an `Asia/Tokyo` preparation timeline.

Missing identity facts return `needs_input`. Missing, stale, unlinked, cross-Pack, or hash-mismatched evidence cannot support a policy Task. Missing weather, accommodation, or route facts degrade without invention. Unknown or ambiguous destination country selects no Pack.

The existing scheduler automatically refreshes weather only for Reminders that explicitly request it. Entry-policy rechecks are explicit user Tasks and Reminders; a registry or content-hash change does not itself mean policy changed.

Not implemented: flight, hotel, restaurant, or ticket booking; price monitoring; payments; automatic ride hailing; passport document storage; visa eligibility decisions; or a general background official-source monitor.

See [Japan Pack V1](../../docs/japan-pack-v1.md).
